import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { ClientMessage, type GameSnapshot } from '../src/protocol'
import {
  connect,
  createGame,
  makeDevice,
  playUntilOver,
  startFriendGame,
} from './testClient'

const watchTable = (snapshot: GameSnapshot) =>
  snapshot._tag === 'WatchTable' ? snapshot : undefined

describe('a table screen', () => {
  test('sees the lobby without taking a seat', async () => {
    const hostDevice = makeDevice('host')
    const code = await createGame(hostDevice, 'Ada')
    const screen = await connect(makeDevice('screen'), code, true)
    const lobby = screen.latest()
    expect(lobby._tag).toBe('WatchLobby')
    expect(lobby._tag === 'WatchLobby' && lobby.seats.map(s => s.name)).toEqual(
      ['Ada'],
    )
  })

  test('only watches: it cannot act', async () => {
    const code = await createGame(makeDevice('host'), 'Ada')
    const screen = await connect(makeDevice('screen'), code, true)
    screen.send(ClientMessage.JoinLobby({ name: 'Sneak', tone: 2 }))
    const reply = await screen.waitFor(m => m._tag === 'Rejected', 'rejection')
    expect(reply._tag === 'Rejected' && reply.reason).toContain('only watches')
  })

  test('follows the game with no hands, then reveals tickets at the end', async () => {
    const { code, host, guest } = await startFriendGame()
    const screen = await connect(makeDevice('screen'), code, true)
    const during = watchTable(screen.latest())
    expect(during).toBeDefined()
    expect(during?.view.viewerIndex).toBe(-1)
    expect(
      Array.every(during?.view.players ?? [], p => p.hand.length === 0),
    ).toBe(true)
    expect(
      Array.every(during?.view.players ?? [], p => p.ticketIds.length === 0),
    ).toBe(true)
    expect(during?.revealedTickets).toEqual([])

    await playUntilOver([host, guest])
    const over = await screen.waitFor(
      m =>
        m._tag === 'Snapshot' &&
        m.snapshot._tag === 'WatchTable' &&
        m.snapshot.view.phase._tag === 'GameOver',
      'game over on the table screen',
    )
    const final =
      over._tag === 'Snapshot' ? watchTable(over.snapshot) : undefined
    expect(final?.revealedTickets.length).toBe(2)
    expect(
      Array.every(final?.revealedTickets ?? [], tickets => tickets.length > 0),
    ).toBe(true)
    expect(
      Array.every(final?.view.players ?? [], p => p.hand.length === 0),
    ).toBe(true)
  })

  test('a seated phone opening the watch page still sees only public cards', async () => {
    const { code, host } = await startFriendGame()
    const screen = await connect(host.device, code, true)
    const view = watchTable(screen.latest())?.view
    expect(view?.viewerIndex).toBe(-1)
    expect(Array.every(view?.players ?? [], p => p.hand.length === 0)).toBe(
      true,
    )
  })
})
