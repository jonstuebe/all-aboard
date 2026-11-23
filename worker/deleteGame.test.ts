import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { ClientMessage } from '../src/protocol'
import {
  type Device,
  api,
  connect,
  createGame,
  fetchMenu,
  makeDevice,
  playUntilOver,
  startFriendGame,
  tableView,
} from './testClient'

const remove = (device: Device, code: string) =>
  api(device, `/api/games/${code}`, { method: 'DELETE' })

describe('deleting a game from your list', () => {
  test('the host deleting a lobby closes it for everyone', async () => {
    const hostDevice = makeDevice('host')
    const guestDevice = makeDevice('guest')
    const code = await createGame(hostDevice, 'Ada')
    const guest = await connect(guestDevice, code)
    guest.send(ClientMessage.JoinLobby({ name: 'Bea', tone: 3 }))
    await guest.waitFor(
      m =>
        m._tag === 'Snapshot' &&
        m.snapshot._tag === 'Lobby' &&
        m.snapshot.isViewerSeated,
    )

    expect((await remove(hostDevice, code)).status).toBe(200)

    await guest.waitFor(
      m => m._tag === 'Snapshot' && m.snapshot._tag === 'Gone',
    )
    expect((await fetchMenu(hostDevice)).games).toEqual([])
    const guestEntry = (await fetchMenu(guestDevice)).games[0]!
    expect(guestEntry.status).toBe('Gone')
    expect(guestEntry.maybeReason).toEqual(
      Option.some('The host closed this lobby.'),
    )
    guest.close()
  })

  test('a guest deleting a lobby only gives up their seat', async () => {
    const hostDevice = makeDevice('host')
    const guestDevice = makeDevice('guest')
    const code = await createGame(hostDevice, 'Ada')
    const guest = await connect(guestDevice, code)
    guest.send(ClientMessage.JoinLobby({ name: 'Bea', tone: 3 }))
    await guest.waitFor(
      m =>
        m._tag === 'Snapshot' &&
        m.snapshot._tag === 'Lobby' &&
        m.snapshot.isViewerSeated,
    )

    expect((await remove(guestDevice, code)).status).toBe(200)

    expect((await fetchMenu(guestDevice)).games).toEqual([])
    const hostEntry = (await fetchMenu(hostDevice)).games[0]!
    expect(hostEntry.status).toBe('Lobby')
    expect(hostEntry.seatNames).toEqual(['Ada'])
    guest.close()
  })

  test('deleting a game in progress leaves it, and later moves do not bring it back', async () => {
    const { code, host, guest } = await startFriendGame()

    expect((await remove(guest.device, code)).status).toBe(200)
    expect((await fetchMenu(guest.device)).games).toEqual([])

    // NOTE: A bot now plays the guest's seat; the host plays on to the end.
    await playUntilOver([host])
    expect((await fetchMenu(host.device)).games[0]!.status).toBe('Finished')
    expect((await fetchMenu(guest.device)).games).toEqual([])
    expect(Option.isSome(tableView(host.latest()))).toBe(true)
    host.close()
    guest.close()
  })

  test('deleting a finished game only takes it off your list', async () => {
    const { code, host, guest } = await startFriendGame()
    await playUntilOver([host, guest])

    expect((await remove(host.device, code)).status).toBe(200)

    expect((await fetchMenu(host.device)).games).toEqual([])
    expect((await fetchMenu(guest.device)).games[0]!.status).toBe('Finished')
    expect((await fetchMenu(host.device)).stats.gamesPlayed).toBe(1)
    host.close()
    guest.close()
  })
})
