import { env } from 'cloudflare:workers'
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { PlayerAction } from '../src/domain/game'
import {
  ClientMessage,
  type GameSnapshot,
  decodePushNotice,
} from '../src/protocol'
import type { Env } from './env'
import { TEST_PUSH_ORIGIN } from './playerDO'
import { REASON_EVERYONE_LEFT } from './room'
import {
  type Device,
  type TestClient,
  api,
  fetchMenu,
  nextMessage,
  playUntilOver,
  startFriendGame,
  tableView,
} from './testClient'
import { readTombstone } from './tombstone'

const bindings = env as unknown as Env

// NOTE: The test outbox records a push without encrypting for a real
// browser, so any well-formed P-256 point works as the subscription key.
const subscribe = async (device: Device): Promise<void> => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  )
  const b64 = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  const response = await api(device, '/api/me/push', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: `${TEST_PUSH_ORIGIN}/${device.deviceId}`,
      keys: {
        p256dh: b64(raw),
        auth: b64(crypto.getRandomValues(new Uint8Array(16))),
      },
    }),
  })
  expect(response.status).toBe(200)
}

const pushTags = async (device: Device): Promise<ReadonlyArray<string>> =>
  (await bindings.PLAYERS.getByName(device.deviceId).testOutbox()).map(
    json => Option.getOrThrow(decodePushNotice(json)).tag,
  )

const isSnapshot =
  (tag: GameSnapshot['_tag']) =>
  (message: { _tag: string; snapshot?: GameSnapshot }) =>
    message._tag === 'Snapshot' && message.snapshot?._tag === tag

const waitForLatest = async (
  client: TestClient,
  predicate: (snapshot: GameSnapshot) => boolean,
  label: string,
): Promise<GameSnapshot> => {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    if (predicate(client.latest())) {
      return client.latest()
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const leave = async (client: TestClient): Promise<void> => {
  const reply = nextMessage(client, 'leave reply')
  client.send(ClientMessage.LeaveGame())
  expect((await reply)._tag).toBe('Snapshot')
}

describe('leaving a game', () => {
  test('a bot takes the seat with its name, hand and tickets; the leaver is cut off', async () => {
    const { host, guest } = await startFriendGame()
    await subscribe(host.device)
    await subscribe(guest.device)
    const before = Option.getOrThrow(tableView(host.latest()))
    const guestBefore = Option.getOrThrow(tableView(guest.latest()))

    await leave(guest)
    expect(guest.latest()).toMatchObject({
      _tag: 'Closed',
      reason: 'You left this game.',
    })

    const after = Option.getOrThrow(
      tableView(
        await waitForLatest(
          host,
          snapshot =>
            Option.exists(
              tableView(snapshot),
              view => view.players[1]?.kind === 'Bot',
            ),
          'bot hand-off',
        ),
      ),
    )
    const [, seatBefore] = before.players
    const [, seatAfter] = after.players
    expect(seatAfter?.name).toBe(seatBefore?.name)
    expect(seatAfter?.handCount).toBe(seatBefore?.handCount)
    expect(seatAfter?.ticketCount).toBe(guestBefore.players[1]?.ticketCount)

    // NOTE: The leaver can no longer act, even on what was their seat.
    const rejected = nextMessage(guest, 'reply to a move after leaving')
    guest.send(ClientMessage.TakeAction({ action: PlayerAction.DrewTicket() }))
    expect((await rejected)._tag).toBe('Rejected')

    await playUntilOver([host])
    const menu = await fetchMenu(guest.device)
    expect(menu.games.find(entry => entry.status === 'Left')).toBeDefined()
    expect(menu.stats.gamesPlayed).toBe(0)
    expect((await fetchMenu(host.device)).stats.gamesPlayed).toBe(1)

    // NOTE: Only the person still in the game hears about the final scores.
    const started = Date.now()
    while (
      !(await pushTags(host.device)).some(tag => tag.startsWith('final-'))
    ) {
      if (Date.now() - started > 10_000) {
        throw new Error('no final-score push for the host')
      }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(await pushTags(guest.device)).toEqual([])
    host.close()
    guest.close()
  })

  test('when every person leaves, the game ends quietly and is deleted', async () => {
    const { code, host, guest } = await startFriendGame()
    await subscribe(host.device)
    await leave(guest)
    host.send(ClientMessage.LeaveGame())
    await host.waitFor(isSnapshot('Gone'), 'gone')
    expect(Option.getOrThrow(await readTombstone(bindings, code)).reason).toBe(
      REASON_EVERYONE_LEFT,
    )
    expect(await pushTags(host.device)).toEqual([])
    expect((await fetchMenu(host.device)).stats.gamesPlayed).toBe(0)
    host.close()
    guest.close()
  })
})

describe('rematch', () => {
  test('the finished game becomes a lobby with the same seats; ready players start a new deal', async () => {
    const { host, guest } = await startFriendGame()
    await playUntilOver([host, guest])
    const finished = Option.getOrThrow(tableView(host.latest()))

    guest.send(ClientMessage.OpenRematch())
    const lobby = {
      snapshot: await waitForLatest(
        host,
        snapshot => snapshot._tag === 'Lobby' && snapshot.isRematch,
        'rematch lobby',
      ),
    }
    expect(lobby).toMatchObject({
      snapshot: {
        isRematch: true,
        seats: [{ name: 'Ada' }, { name: 'Bea', isReady: true }],
      },
    })

    // NOTE: Nobody new can take a seat in a rematch.
    guest.send(ClientMessage.MarkReady({ isReady: false }))
    await waitForLatest(
      host,
      snapshot =>
        snapshot._tag === 'Lobby' && snapshot.seats[1]?.isReady === false,
      'guest not ready',
    )
    const tooFew = nextMessage(host, 'start with too few ready')
    host.send(ClientMessage.StartGame())
    expect((await tooFew)._tag).toBe('Rejected')

    guest.send(ClientMessage.MarkReady({ isReady: true }))
    await waitForLatest(
      host,
      snapshot =>
        snapshot._tag === 'Lobby' && snapshot.seats[1]?.isReady === true,
      'guest ready',
    )
    host.send(ClientMessage.StartGame())
    const fresh = Option.getOrThrow(
      tableView(
        await waitForLatest(
          host,
          snapshot => snapshot._tag === 'Table',
          'new deal',
        ),
      ),
    )
    expect(fresh.phase._tag).not.toBe('GameOver')
    expect(fresh.players.map(player => player.name)).toEqual(['Ada', 'Bea'])
    expect(fresh.claims).toHaveLength(0)
    expect(finished.claims.length).toBeGreaterThan(0)
    host.close()
    guest.close()
  })

  test('a seat whose player left stays a bot in the rematch and is always ready', async () => {
    const { host, guest } = await startFriendGame()
    await leave(guest)
    await playUntilOver([host])
    host.send(ClientMessage.OpenRematch())
    const lobby = {
      snapshot: await waitForLatest(
        host,
        snapshot => snapshot._tag === 'Lobby' && snapshot.isRematch,
        'rematch lobby',
      ),
    }
    expect(lobby).toMatchObject({
      snapshot: {
        seats: [{ name: 'Ada' }, { name: 'Bea', kind: 'Bot', isReady: true }],
      },
    })
    host.send(ClientMessage.StartGame())
    await waitForLatest(host, snapshot => snapshot._tag === 'Table', 'new deal')
    host.close()
    guest.close()
  })
})
