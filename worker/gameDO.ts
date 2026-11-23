import { DurableObject } from 'cloudflare:workers'
import { Option, Result } from 'effect'

import {
  ClientMessage,
  GameSnapshot,
  ServerMessage,
  decodeClientMessage,
  encodeGameSnapshot,
  encodeMenuEntry,
  encodePushNotice,
  encodeSeatResult,
  type PushNotice,
  encodeServerMessage,
} from '../src/protocol'
import type { Env } from './env'
import {
  AlarmOutcome,
  type Room,
  applyClientMessage,
  createRoom,
  decodeRoom,
  encodeRoom,
  finishedResults,
  hasHumans,
  menuEntryFor,
  nextAlarmAt,
  pingAvailableAt,
  pingNotice,
  pingTarget,
  pushesForChange,
  warningNotice,
  REASON_EVERYONE_LEFT,
  resultKey,
  runAlarm,
  seatedDeviceIds,
  snapshotFor,
} from './room'
import { writeTombstone } from './tombstone'

// NOTE: One GameDO per friend game, addressed by its invite code. The Room
// (seats, owners, the current Model) is saved as one row after every change,
// and every accepted message is appended to an action log, so a game can be
// replayed from its seed for debugging.

export const VERIFIED_DEVICE_HEADER = 'x-verified-device'
export const GAME_CODE_HEADER = 'x-game-code'
export const GONE_REASON_HEADER = 'x-gone-reason'

type SocketAttachment = Readonly<{ deviceId: string }>

const randomSeed = (): number => {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return ((buffer[0] ?? 1) % 2_147_483_646) + 1
}

export class GameDO extends DurableObject<Env> {
  private maybeRoom: Option.Option<Room> = Option.none()
  private clockOffsetMs = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.migrate()
      this.load()
    })
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql
    sql.exec(
      'CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)',
    )
    sql.exec(
      'CREATE TABLE IF NOT EXISTS actions (seq INTEGER PRIMARY KEY AUTOINCREMENT, generation INTEGER NOT NULL, at INTEGER NOT NULL, device_id TEXT, json TEXT NOT NULL)',
    )
    sql.exec(
      'CREATE TABLE IF NOT EXISTS clock (id INTEGER PRIMARY KEY CHECK (id = 1), offset_ms INTEGER NOT NULL)',
    )
  }

  private load(): void {
    const sql = this.ctx.storage.sql
    const row = sql
      .exec<{ json: string }>('SELECT json FROM room WHERE id = 1')
      .toArray()[0]
    this.maybeRoom =
      row === undefined ? Option.none() : Option.some(decodeRoom(row.json))
    const clock = sql
      .exec<{ offset_ms: number }>('SELECT offset_ms FROM clock WHERE id = 1')
      .toArray()[0]
    this.clockOffsetMs = clock?.offset_ms ?? 0
  }

  protected now(): number {
    return Date.now() + this.clockOffsetMs
  }

  private botDelayMs(): number {
    const parsed = Number(this.env.BOT_DELAY_MS ?? '1500')
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1500
  }

  // NOTE: Alarms are set in real time; the test clock offset only shifts
  // what "now" means inside the room.
  private async scheduleAlarm(room: Room): Promise<void> {
    const at = nextAlarmAt(room, this.botDelayMs()) - this.clockOffsetMs
    await this.ctx.storage.setAlarm(Math.max(at, Date.now()))
  }

  async alarm(): Promise<void> {
    await Option.match(this.maybeRoom, {
      onNone: async () => undefined,
      onSome: async room =>
        AlarmOutcome.match(runAlarm(room, this.now(), this.botDelayMs()), {
          Unchanged: async () => this.scheduleAlarm(room),
          Updated: async ({ room: next }) => {
            this.save(next)
            this.logAction(next, Option.none(), { _tag: 'BotMove' })
            await this.afterChange(Option.some(room), next)
          },
          Warned: async ({ room: next, deviceIds }) => {
            this.save(next)
            await this.warn(next, deviceIds)
            await this.scheduleAlarm(next)
          },
          Deleted: async ({ reason }) => this.deleteGame(reason),
        }),
    })
  }

  // NOTE: Sends the 48-hour warning. Push delivery arrives with Web Push.
  protected async warn(
    room: Room,
    deviceIds: ReadonlyArray<string>,
  ): Promise<void> {
    await Promise.all(
      deviceIds.map(deviceId => this.push(deviceId, warningNotice(room))),
    )
  }

  // TEST HOOKS

  // NOTE: Only with TEST_HOOKS set (vitest). Moves this game's clock forward
  // so lifecycle alarms can be tested without waiting days.
  async testAdvanceClock(ms: number): Promise<number> {
    if (this.env.TEST_HOOKS !== '1') {
      throw new Error('Test hooks are off.')
    }
    this.clockOffsetMs += ms
    this.ctx.storage.sql.exec(
      'INSERT INTO clock (id, offset_ms) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET offset_ms = excluded.offset_ms',
      this.clockOffsetMs,
    )
    return this.now()
  }

  async testRoomJson(): Promise<string | null> {
    if (this.env.TEST_HOOKS !== '1') {
      throw new Error('Test hooks are off.')
    }
    return Option.match(this.maybeRoom, {
      onNone: () => null,
      onSome: encodeRoom,
    })
  }

  protected save(room: Room): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO room (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json',
      encodeRoom(room),
    )
    this.maybeRoom = Option.some(room)
  }

  protected logAction(
    room: Room,
    maybeDeviceId: Option.Option<string>,
    entry: unknown,
  ): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO actions (generation, at, device_id, json) VALUES (?, ?, ?, ?)',
      room.generation,
      this.now(),
      Option.getOrNull(maybeDeviceId),
      JSON.stringify(entry),
    )
  }

  // RPC

  async create(
    code: string,
    hostDeviceId: string,
    hostName: string,
  ): Promise<boolean> {
    if (Option.isSome(this.maybeRoom)) {
      return false
    }
    const room = createRoom(code, hostDeviceId, hostName, this.now())
    this.save(room)
    await this.afterChange(Option.none(), room)
    return true
  }

  async snapshotJson(code: string, deviceId: string): Promise<string> {
    return encodeGameSnapshot(await this.snapshot(code, deviceId))
  }

  private async snapshot(
    code: string,
    deviceId: string,
    goneReason = 'This game doesn’t exist.',
  ): Promise<GameSnapshot> {
    return Option.match(this.maybeRoom, {
      onSome: room => snapshotFor(room, deviceId),
      onNone: () => GameSnapshot.Gone({ code, reason: goneReason }),
    })
  }

  async exists(): Promise<boolean> {
    return Option.isSome(this.maybeRoom)
  }

  // WEBSOCKET

  async fetch(request: Request): Promise<Response> {
    const deviceId = request.headers.get(VERIFIED_DEVICE_HEADER)
    const code = request.headers.get(GAME_CODE_HEADER) ?? ''
    if (deviceId === null || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    const attachment: SocketAttachment = { deviceId }
    server.serializeAttachment(attachment)
    const goneReason = request.headers.get(GONE_REASON_HEADER) ?? undefined
    this.send(
      server,
      ServerMessage.Snapshot({
        snapshot: await this.snapshot(code, deviceId, goneReason),
      }),
    )
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(
    socket: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = this.attachmentOf(socket)
    if (attachment === null || typeof raw !== 'string') {
      return
    }
    await Option.match(decodeClientMessage(raw), {
      onNone: async () =>
        this.send(
          socket,
          ServerMessage.Rejected({ reason: 'That message wasn’t understood.' }),
        ),
      onSome: message => this.handle(socket, attachment.deviceId, message),
    })
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const isValidCode =
      code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)
    try {
      socket.close(isValidCode ? code : 1000, isValidCode ? reason : undefined)
    } catch {
      // NOTE: The socket may already be closed on our side.
    }
  }

  private attachmentOf(socket: WebSocket): SocketAttachment | null {
    const value: unknown = socket.deserializeAttachment()
    return typeof value === 'object' &&
      value !== null &&
      'deviceId' in value &&
      typeof value.deviceId === 'string'
      ? { deviceId: value.deviceId }
      : null
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(encodeServerMessage(message))
    } catch {
      // NOTE: A socket that closed mid-broadcast is cleaned up by the runtime.
    }
  }

  private async handle(
    socket: WebSocket,
    deviceId: string,
    message: ClientMessage,
  ): Promise<void> {
    const result = await this.applyMessage(deviceId, message)
    Result.match(result, {
      onFailure: reason =>
        this.send(socket, ServerMessage.Rejected({ reason })),
      onSuccess: () => undefined,
    })
  }

  // NOTE: The one path every client message takes, from a socket or HTTP.
  private async applyMessage(
    deviceId: string,
    message: ClientMessage,
  ): Promise<Result.Result<Room, string>> {
    return Option.match(this.maybeRoom, {
      onNone: async () => Result.fail('This game doesn’t exist.'),
      onSome: async room => {
        const result = applyClientMessage(room, deviceId, message, {
          now: this.now(),
          seed: randomSeed(),
        })
        if (Result.isSuccess(result)) {
          const next = result.success
          this.save(next)
          this.logAction(next, Option.some(deviceId), message)
          await this.afterChange(Option.some(room), next)
          if (message._tag === 'Ping') {
            await this.sendPing(next, deviceId)
          }
        }
        return result
      },
    })
  }

  async pingFrom(deviceId: string): Promise<string | null> {
    return Result.match(
      await this.applyMessage(deviceId, ClientMessage.Ping()),
      {
        onFailure: reason => reason,
        onSuccess: () => null,
      },
    )
  }

  // PUSH

  private async push(deviceId: string, notice: PushNotice): Promise<void> {
    await this.env.PLAYERS.getByName(deviceId).notify(encodePushNotice(notice))
  }

  private hasOpenSocket(deviceId: string): boolean {
    return this.ctx
      .getWebSockets()
      .some(socket => this.attachmentOf(socket)?.deviceId === deviceId)
  }

  private async sendPing(room: Room, fromDeviceId: string): Promise<void> {
    const fromName = Option.match(
      Option.flatMap(
        Option.fromNullishOr(
          room.seats.find(seat =>
            Option.contains(seat.maybeDeviceId, fromDeviceId),
          ),
        ),
        seat => Option.some(seat.name),
      ),
      { onNone: () => 'Someone', onSome: name => name },
    )
    await Option.match(pingTarget(room), {
      onNone: async () => undefined,
      onSome: deviceId => this.push(deviceId, pingNotice(room, fromName)),
    })
  }

  protected broadcast(room: Room): void {
    this.ctx.getWebSockets().forEach(socket => {
      const attachment = this.attachmentOf(socket)
      if (attachment !== null) {
        this.send(
          socket,
          ServerMessage.Snapshot({
            snapshot: snapshotFor(room, attachment.deviceId),
          }),
        )
      }
    })
  }

  // NOTE: Keeps every seated device's menu in step with the room, records
  // each human's result once when a game ends, and drops the menu entry of
  // anyone removed from a lobby.
  protected async syncPlayers(
    maybeBefore: Option.Option<Room>,
    after: Room,
  ): Promise<void> {
    const afterDevices = seatedDeviceIds(after)
    const removedDevices = Option.match(maybeBefore, {
      onNone: () => [],
      onSome: before =>
        seatedDeviceIds(before).filter(
          deviceId => !afterDevices.includes(deviceId),
        ),
    })
    await Promise.all([
      ...afterDevices.map(deviceId =>
        Option.match(
          menuEntryFor(after, deviceId, pingAvailableAt(after, deviceId)),
          {
            onNone: async () => undefined,
            onSome: entry =>
              this.env.PLAYERS.getByName(deviceId).upsertGame(
                encodeMenuEntry(entry),
              ),
          },
        ),
      ),
      ...removedDevices.map(deviceId =>
        this.env.PLAYERS.getByName(deviceId).removeGame(after.code),
      ),
      ...finishedResults(maybeBefore, after).map(([deviceId, result]) =>
        this.env.PLAYERS.getByName(deviceId).recordResult(
          resultKey(after),
          encodeSeatResult(result),
        ),
      ),
    ])
  }

  protected async afterChange(
    maybeBefore: Option.Option<Room>,
    after: Room,
  ): Promise<void> {
    await this.syncPlayers(maybeBefore, after)
    this.broadcast(after)
    await Promise.all(
      pushesForChange(maybeBefore, after)
        .filter(
          ([deviceId, notice]) =>
            !(notice.tag.startsWith('turn-') && this.hasOpenSocket(deviceId)),
        )
        .map(([deviceId, notice]) => this.push(deviceId, notice)),
    )
    // NOTE: With no people left, a lobby closes and a game in progress ends
    // quietly: deleted with no final-score push and no stats.
    if (!hasHumans(after) && after.phase !== 'Finished') {
      await this.deleteGame(
        after.phase === 'Playing' ? REASON_EVERYONE_LEFT : 'Everyone left the lobby.',
      )
    } else {
      await this.scheduleAlarm(after)
    }
  }

  // DELETION

  // NOTE: Removes the game for good. A tombstone in KV keeps the reason, every
  // seated device's menu shows it, and open sockets get a Gone snapshot.
  protected async deleteGame(reason: string): Promise<void> {
    await Option.match(this.maybeRoom, {
      onNone: async () => undefined,
      onSome: async room => {
        const now = this.now()
        await writeTombstone(this.env, room.code, { reason, deletedAt: now })
        await Promise.all(
          seatedDeviceIds(room).map(deviceId =>
            this.env.PLAYERS.getByName(deviceId).markGone(
              room.code,
              reason,
              now,
            ),
          ),
        )
        const gone = ServerMessage.Snapshot({
          snapshot: GameSnapshot.Gone({ code: room.code, reason }),
        })
        this.ctx.getWebSockets().forEach(socket => {
          this.send(socket, gone)
          try {
            socket.close(1000, 'deleted')
          } catch {
            // NOTE: Already closed.
          }
        })
        const offset = this.clockOffsetMs
        await this.ctx.storage.deleteAlarm()
        await this.ctx.storage.deleteAll()
        this.maybeRoom = Option.none()
        this.migrate()
        if (offset !== 0) {
          this.ctx.storage.sql.exec(
            'INSERT INTO clock (id, offset_ms) VALUES (1, ?)',
            offset,
          )
        }
      },
    })
  }
}
