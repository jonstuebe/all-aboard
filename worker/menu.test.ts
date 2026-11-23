import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { isViewerTurn } from '../src/domain/clientView'
import { ClientMessage } from '../src/protocol'
import {
  api,
  connect,
  createGame,
  fetchMenu,
  makeDevice,
  playUntilOver,
  startFriendGame,
  tableView,
} from './testClient'

const sampleResult = {
  score: 40,
  rank: 1,
  isWinner: true,
  seatCount: 3,
  longestRoute: 9,
  ticketsCompleted: 2,
}

describe('PlayerDO menu and stats', () => {
  test('the menu shows a lobby, then whose turn it is, then the result', async () => {
    const { code, host, guest } = await startFriendGame()

    const hostView = Option.getOrThrow(tableView(host.latest()))
    const [mover, waiter] = isViewerTurn(hostView) ? [host, guest] : [guest, host]
    const moverMenu = await fetchMenu(mover.device)
    const waiterMenu = await fetchMenu(waiter.device)
    expect(Array.map(moverMenu.games, g => [g.code, g.status])).toEqual([
      [code, 'YourTurn'],
    ])
    const waiting = waiterMenu.games[0]!
    expect(waiting.status).toBe('Waiting')
    expect(Option.isSome(waiting.maybeCurrentName)).toBe(true)
    expect(waiting.seatNames).toEqual(['Ada', 'Bea'])

    await playUntilOver([host, guest])

    const finished = await fetchMenu(host.device)
    expect(finished.games[0]!.status).toBe('Finished')
    expect(Option.isSome(finished.games[0]!.maybeResult)).toBe(true)
    expect(finished.stats.gamesPlayed).toBe(1)

    const guestStats = (await fetchMenu(guest.device)).stats
    expect(guestStats.gamesPlayed).toBe(1)
    const hostStats = finished.stats
    expect(hostStats.wins + guestStats.wins).toBeGreaterThanOrEqual(1)
    expect(hostStats.longestRoute).toBeGreaterThanOrEqual(0)

    host.close()
    guest.close()
  })

  test('a lobby appears on the menu for everyone seated', async () => {
    const hostDevice = makeDevice('host')
    const guestDevice = makeDevice('guest')
    const code = await createGame(hostDevice, 'Ada')
    const guest = await connect(guestDevice, code)
    guest.send(ClientMessage.JoinLobby({ name: 'Bea', tone: 3 }))
    await guest.waitFor(
      m => m._tag === 'Snapshot' && m.snapshot._tag === 'Lobby' && m.snapshot.isViewerSeated,
    )
    expect((await fetchMenu(hostDevice)).games[0]!.status).toBe('Lobby')
    expect((await fetchMenu(guestDevice)).games[0]!.status).toBe('Lobby')

    guest.send(ClientMessage.LeaveGame())
    await guest.waitFor(
      m => m._tag === 'Snapshot' && m.snapshot._tag === 'Lobby' && !m.snapshot.isViewerSeated,
    )
    expect((await fetchMenu(guestDevice)).games).toEqual([])
    guest.close()
  })

  test('local bot results count once, however often they are posted', async () => {
    const device = makeDevice('solo')
    const post = () =>
      api(device, '/api/me/results', {
        method: 'POST',
        body: JSON.stringify({
          results: [
            { id: 'local-abc123', result: sampleResult },
            { id: 'local-def456', result: { ...sampleResult, isWinner: false, rank: 2, score: 20, longestRoute: 14 } },
          ],
        }),
      })
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(200)
    const { stats } = await fetchMenu(device)
    expect(stats).toEqual({
      gamesPlayed: 2,
      wins: 1,
      totalScore: 60,
      longestRoute: 14,
      ticketsCompleted: 4,
    })
  })

  test('an emptied lobby is deleted and its link explains why', async () => {
    const hostDevice = makeDevice('host')
    const code = await createGame(hostDevice, 'Ada')
    const host = await connect(hostDevice, code)
    host.send(ClientMessage.LeaveGame())
    await host.waitFor(m => m._tag === 'Snapshot' && m.snapshot._tag === 'Gone')

    const again = await connect(makeDevice('visitor'), code)
    const gone = again.latest()
    expect(gone._tag === 'Gone' && gone.reason).toBe('Everyone left the lobby.')
    // NOTE: Leaving a lobby drops it from your menu; only games show "Left".
    expect((await fetchMenu(hostDevice)).games).toEqual([])
    again.close()
  })
})
