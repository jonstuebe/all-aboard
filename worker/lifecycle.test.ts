import { env } from 'cloudflare:workers'
import { runDurableObjectAlarm } from 'cloudflare:test'
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { isViewerTurn } from '../src/domain/clientView'
import { ClientMessage } from '../src/protocol'
import type { Env } from './env'
import {
  DELETE_AFTER_MS,
  FINISHED_TTL_MS,
  REASON_FINISHED,
  REASON_IDLE_GAME,
  REASON_IDLE_LOBBY,
  WARN_AFTER_MS,
  decodeRoom,
} from './room'
import {
  connect,
  createGame,
  fetchMenu,
  makeDevice,
  playUntilOver,
  startFriendGame,
  tableView,
} from './testClient'
import { readTombstone } from './tombstone'

const bindings = env as unknown as Env
const HOUR = 60 * 60 * 1000

const game = (code: string) => bindings.GAMES.getByName(code)

const advance = async (code: string, ms: number): Promise<void> => {
  await game(code).testAdvanceClock(ms)
  await runDurableObjectAlarm(game(code))
}

const room = async (code: string) => {
  const json = await game(code).testRoomJson()
  return json === null ? Option.none() : Option.some(decodeRoom(json))
}

describe('server-side bots', () => {
  test('a person and a bot play a whole game; the bot moves on its own', async () => {
    const hostDevice = makeDevice('host')
    const code = await createGame(hostDevice, 'Ada')
    const host = await connect(hostDevice, code)
    host.send(ClientMessage.AddBot())
    await host.waitFor(
      m => m._tag === 'Snapshot' && m.snapshot._tag === 'Lobby' && m.snapshot.seats.length === 2,
    )
    host.send(ClientMessage.StartGame())
    await host.waitFor(m => m._tag === 'Snapshot' && m.snapshot._tag === 'Table')

    await playUntilOver([host])
    const final = Option.getOrThrow(tableView(host.latest()))
    expect(final.phase._tag).toBe('GameOver')
    expect(final.log.some(entry => entry.playerIndex === 1)).toBe(true)
    expect((await fetchMenu(hostDevice)).stats.gamesPlayed).toBe(1)
    host.close()
  })
})

describe('lifecycle alarms', () => {
  test('an idle lobby warns the host at 48 hours and is deleted at 72', async () => {
    const hostDevice = makeDevice('host')
    const code = await createGame(hostDevice, 'Ada')

    await advance(code, WARN_AFTER_MS - HOUR)
    expect(Option.getOrThrow(await room(code)).maybeWarnedAt).toEqual(Option.none())

    await advance(code, HOUR)
    expect(Option.isSome(Option.getOrThrow(await room(code)).maybeWarnedAt)).toBe(true)

    await advance(code, DELETE_AFTER_MS - WARN_AFTER_MS)
    expect(Option.isNone(await room(code))).toBe(true)
    expect(Option.getOrThrow(await readTombstone(bindings, code)).reason).toBe(
      REASON_IDLE_LOBBY,
    )
    const visitor = await connect(makeDevice('visitor'), code)
    const gone = visitor.latest()
    expect(gone._tag === 'Gone' && gone.reason).toBe(REASON_IDLE_LOBBY)
    visitor.close()

    const menu = await fetchMenu(hostDevice)
    expect(menu.games[0]!.status).toBe('Gone')
    expect(menu.games[0]!.maybeReason).toEqual(Option.some(REASON_IDLE_LOBBY))
  })

  test('a game in progress is deleted after 72 hours with no move', async () => {
    const { code, host, guest } = await startFriendGame()
    await advance(code, WARN_AFTER_MS)
    const warned = Option.getOrThrow(await room(code))
    expect(Option.isSome(warned.maybeWarnedAt)).toBe(true)

    await advance(code, DELETE_AFTER_MS - WARN_AFTER_MS)
    const gone = await host.waitFor(
      m => m._tag === 'Snapshot' && m.snapshot._tag === 'Gone',
      'gone snapshot',
    )
    expect(gone._tag === 'Snapshot' && gone.snapshot._tag === 'Gone' && gone.snapshot.reason).toBe(
      REASON_IDLE_GAME,
    )
    for (const client of [host, guest]) {
      const entry = (await fetchMenu(client.device)).games[0]!
      expect(entry.status).toBe('Gone')
      expect(entry.maybeReason).toEqual(Option.some(REASON_IDLE_GAME))
    }
    host.close()
    guest.close()
  })

  test('a move resets the clock and clears the warning', async () => {
    const { code, host, guest } = await startFriendGame()
    await advance(code, WARN_AFTER_MS + HOUR)
    expect(Option.isSome(Option.getOrThrow(await room(code)).maybeWarnedAt)).toBe(true)

    const mover = Option.exists(tableView(host.latest()), isViewerTurn) ? host : guest
    mover.send(ClientMessage.TakeAction({ action: { _tag: 'DrewFromDeck' } }))
    await mover.waitFor(
      m => m._tag === 'Snapshot' && m.snapshot._tag === 'Table' && m.snapshot.view.turnNumber >= 0 && m.snapshot.view.log.length > 1,
    )
    const touched = Option.getOrThrow(await room(code))
    expect(touched.maybeWarnedAt).toEqual(Option.none())

    await advance(code, WARN_AFTER_MS - HOUR)
    expect(Option.isSome(await room(code))).toBe(true)
    expect(Option.getOrThrow(await room(code)).maybeWarnedAt).toEqual(Option.none())
    host.close()
    guest.close()
  })

  test('a finished game is deleted one week after it ends', async () => {
    const { code, host, guest } = await startFriendGame()
    await playUntilOver([host, guest])

    await advance(code, FINISHED_TTL_MS - HOUR)
    expect(Option.isSome(await room(code))).toBe(true)

    await advance(code, HOUR)
    expect(Option.isNone(await room(code))).toBe(true)
    expect(Option.getOrThrow(await readTombstone(bindings, code)).reason).toBe(REASON_FINISHED)
    const stats = (await fetchMenu(host.device)).stats
    expect(stats.gamesPlayed).toBe(1)
    host.close()
    guest.close()
  })
})
