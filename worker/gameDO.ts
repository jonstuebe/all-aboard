import { DurableObject } from 'cloudflare:workers'
import { Option, Result } from 'effect'

import {
  type ClientMessage,
  GameSnapshot,
  ServerMessage,
  decodeClientMessage,
  encodeGameSnapshot,
  encodeServerMessage,
} from '../src/protocol'
import type { Env } from './env'
import {
  type Room,
  applyClientMessage,
  createRoom,
  decodeRoom,
  encodeRoom,
  snapshotFor,
} from './room'

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

  async create(code: string, hostDeviceId: string, hostName: string): Promise<boolean> {
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

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = this.attachmentOf(socket)
    if (attachment === null || typeof raw !== 'string') {
      return
    }
    await Option.match(decodeClientMessage(raw), {
      onNone: async () =>
        this.send(socket, ServerMessage.Rejected({ reason: 'That message wasn’t understood.' })),
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
    await Option.match(this.maybeRoom, {
      onNone: async () =>
        this.send(socket, ServerMessage.Rejected({ reason: 'This game doesn’t exist.' })),
      onSome: async room =>
        Result.match(
          applyClientMessage(room, deviceId, message, {
            now: this.now(),
            seed: randomSeed(),
          }),
          {
            onFailure: async reason =>
              this.send(socket, ServerMessage.Rejected({ reason })),
            onSuccess: async next => {
              this.save(next)
              this.logAction(next, Option.some(deviceId), message)
              await this.afterChange(Option.some(room), next)
            },
          },
        ),
    })
  }

  protected broadcast(room: Room): void {
    this.ctx.getWebSockets().forEach(socket => {
      const attachment = this.attachmentOf(socket)
      if (attachment !== null) {
        this.send(
          socket,
          ServerMessage.Snapshot({ snapshot: snapshotFor(room, attachment.deviceId) }),
        )
      }
    })
  }

  protected async afterChange(
    _maybeBefore: Option.Option<Room>,
    after: Room,
  ): Promise<void> {
    this.broadcast(after)
  }
}
