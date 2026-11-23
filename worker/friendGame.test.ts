import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { isViewerTurn } from '../src/domain/clientView'
import { PlayerAction } from '../src/domain/game'
import { ClientMessage, type GameSnapshot } from '../src/protocol'
import {
  type TestClient,
  api,
  chooseAction,
  connect,
  createGame,
  keepStartTickets,
  makeDevice,
  nextMessage,
  tableView,
} from './testClient'

const isTable = (snapshot: GameSnapshot) => snapshot._tag === 'Table'

const playUntilOver = async (clients: ReadonlyArray<TestClient>) => {
  const maxMoves = 2000
  const loop = async (movesLeft: number): Promise<number> => {
    if (movesLeft === 0) {
      throw new Error('game did not finish')
    }
    const views = Array.getSomes(
      Array.map(clients, client => tableView(client.latest())),
    )
    if (Array.some(views, view => view.phase._tag === 'GameOver')) {
      return maxMoves - movesLeft
    }
    const maybeActor = Array.findFirst(clients, client =>
      Option.exists(tableView(client.latest()), isViewerTurn),
    )
    if (Option.isNone(maybeActor)) {
      throw new Error('nobody can move')
    }
    const actor = maybeActor.value
    const view = Option.getOrThrow(tableView(actor.latest()))
    const reply = nextMessage(actor, 'reply to action')
    actor.send(ClientMessage.TakeAction({ action: chooseAction(view) }))
    const message = await reply
    if (message._tag === 'Rejected') {
      const fallback = nextMessage(actor, 'reply to fallback')
      actor.send(ClientMessage.TakeAction({ action: PlayerAction.Passed() }))
      const second = await fallback
      expect(second._tag).toBe('Snapshot')
    }
    await Promise.all(
      Array.map(clients, client =>
        client.messages.length > 0 ? Promise.resolve() : nextMessage(client),
      ),
    )
    return loop(movesLeft - 1)
  }
  return loop(maxMoves)
}

describe('a friend game over WebSocket', () => {
  test('two devices join by invite code, play, and reach game over', async () => {
    const hostDevice = makeDevice('host')
    const guestDevice = makeDevice('guest')
    const code = await createGame(hostDevice, 'Ada')
    expect(code).toMatch(/^TRAIN-[A-Z2-9]{3}$/)

    const host = await connect(hostDevice, code)
    const guest = await connect(guestDevice, code)

    const guestLobby = guest.latest()
    expect(guestLobby._tag).toBe('Lobby')
    expect(guestLobby._tag === 'Lobby' && guestLobby.isViewerSeated).toBe(false)

    guest.send(ClientMessage.JoinLobby({ name: 'Bea', tone: 0 }))
    const taken = await guest.waitFor(
      m => m._tag === 'Rejected',
      'tone rejection',
    )
    expect(taken._tag === 'Rejected' && taken.reason).toContain('colour')

    guest.send(ClientMessage.JoinLobby({ name: '  Bea  ', tone: 1 }))
    await host.waitFor(
      m =>
        m._tag === 'Snapshot' &&
        m.snapshot._tag === 'Lobby' &&
        m.snapshot.seats.length === 2,
      'host sees guest',
    )
    const lobby = guest.latest()
    expect(
      lobby._tag === 'Lobby' && Array.map(lobby.seats, s => s.name),
    ).toEqual(['Ada', 'Bea'])

    guest.send(ClientMessage.StartGame())
    const notHost = await guest.waitFor(
      m => m._tag === 'Rejected' && m.reason.includes('host'),
      'non-host start rejection',
    )
    expect(notHost._tag).toBe('Rejected')

    host.send(ClientMessage.StartGame())
    await host.waitFor(
      m => m._tag === 'Snapshot' && isTable(m.snapshot),
      'host table',
    )
    await guest.waitFor(
      m => m._tag === 'Snapshot' && isTable(m.snapshot),
      'guest table',
    )
    await keepStartTickets([host, guest])

    const latecomer = await connect(makeDevice('late'), code)
    const closed = latecomer.latest()
    expect(closed._tag === 'Closed' && closed.reason).toBe(
      'This game already started.',
    )
    latecomer.close()

    const hostView = Option.getOrThrow(tableView(host.latest()))
    const guestView = Option.getOrThrow(tableView(guest.latest()))
    expect(hostView.players[1]!.hand).toEqual([])
    expect(guestView.players[0]!.hand).toEqual([])
    expect(guestView.players[0]!.handCount).toBe(4)
    expect(JSON.stringify(host.messages)).not.toContain('rngState')

    const [waiting] = isViewerTurn(hostView) ? [guest] : [host]
    waiting!.send(
      ClientMessage.TakeAction({ action: PlayerAction.DrewFromDeck() }),
    )
    const outOfTurn = await waiting!.waitFor(
      m => m._tag === 'Rejected' && m.reason.includes('not your turn'),
      'out-of-turn rejection',
    )
    expect(outOfTurn._tag).toBe('Rejected')

    const moves = await playUntilOver([host, guest])
    expect(moves).toBeGreaterThan(10)

    const final = Option.getOrThrow(tableView(host.latest()))
    expect(final.phase._tag).toBe('GameOver')

    const response = await api(guestDevice, `/api/games/${code}`)
    const body: { _tag: string } = await response.json()
    expect(body._tag).toBe('Table')

    host.close()
    guest.close()
  })

  test('a foreign device cannot act or pass itself off as a seat', async () => {
    const hostDevice = makeDevice('host')
    const code = await createGame(hostDevice, 'Ada')
    const host = await connect(hostDevice, code)
    const guest = await connect(makeDevice('guest'), code)
    guest.send(ClientMessage.JoinLobby({ name: 'Bea', tone: 2 }))
    await host.waitFor(
      m =>
        m._tag === 'Snapshot' &&
        m.snapshot._tag === 'Lobby' &&
        m.snapshot.seats.length === 2,
    )
    host.send(ClientMessage.StartGame())
    await host.waitFor(m => m._tag === 'Snapshot' && isTable(m.snapshot))

    const stranger = await connect(makeDevice('stranger'), code)
    stranger.send(
      ClientMessage.TakeAction({ action: PlayerAction.DrewFromDeck() }),
    )
    const rejected = await stranger.waitFor(m => m._tag === 'Rejected')
    expect(rejected._tag === 'Rejected' && rejected.reason).toContain('seat')

    const wrongSecret = await api(
      { deviceId: hostDevice.deviceId, secret: 'secret-not-the-real-one-000' },
      `/api/games/${code}`,
    )
    expect(wrongSecret.status).toBe(401)

    const garbage = nextMessage(host)
    host.send(
      ClientMessage.TakeAction({
        action: PlayerAction.TookMarketCard({ slot: 99 }),
      }),
    )
    expect((await garbage)._tag).toBe('Rejected')
    stranger.close()
    host.close()
    guest.close()
  })
})
