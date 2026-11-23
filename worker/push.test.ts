import { runDurableObjectAlarm } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { PlayerAction } from '../src/domain/game'
import {
  ClientMessage,
  type PushNotice,
  decodePushNotice,
} from '../src/protocol'
import type { Env } from './env'
import { TEST_PUSH_ORIGIN } from './playerDO'
import {
  encryptPayload,
  fromBase64Url,
  toBase64Url,
  vapidAuthorization,
} from './push'
import { WARN_AFTER_MS } from './room'
import {
  type Device,
  api,
  createGame,
  makeDevice,
  nextMessage,
  playUntilOver,
  startFriendGame,
} from './testClient'

const bindings = env as unknown as Env
const encoder = new TextEncoder()

// HELPERS

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((offset, part) => {
    out.set(part, offset)
    return offset + part.length
  }, 0)
  return out
}

const hmac = async (key: Uint8Array, data: Uint8Array) =>
  new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
      data,
    ),
  )

const hkdf = async (
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
) =>
  (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(
    0,
    length,
  )

// NOTE: A browser's side of RFC 8291, written independently of push.ts so the
// round trip actually checks the encryption.
const makeBrowserSubscription = async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair
  const publicRaw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  )
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const decrypt = async (body: Uint8Array): Promise<string> => {
    const salt = body.slice(0, 16)
    const keyLength = body[20] ?? 0
    const serverPublic = body.slice(21, 21 + keyLength)
    const ciphertext = body.slice(21 + keyLength)
    const serverKey = await crypto.subtle.importKey(
      'raw',
      serverPublic,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    )
    const secret = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: serverKey,
        } as unknown as SubtleCryptoDeriveKeyAlgorithm,
        pair.privateKey,
        256,
      ),
    )
    const ikm = await hkdf(
      auth,
      secret,
      concat(encoder.encode('WebPush: info\0'), publicRaw, serverPublic),
      32,
    )
    const cek = await hkdf(
      salt,
      ikm,
      encoder.encode('Content-Encoding: aes128gcm\0'),
      16,
    )
    const nonce = await hkdf(
      salt,
      ikm,
      encoder.encode('Content-Encoding: nonce\0'),
      12,
    )
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, [
          'decrypt',
        ]),
        ciphertext,
      ),
    )
    expect(plain[plain.length - 1]).toBe(2)
    return new TextDecoder().decode(plain.slice(0, -1))
  }
  return { p256dh: toBase64Url(publicRaw), auth: toBase64Url(auth), decrypt }
}

const subscribe = async (device: Device): Promise<void> => {
  const browser = await makeBrowserSubscription()
  const response = await api(device, '/api/me/push', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: `${TEST_PUSH_ORIGIN}/${device.deviceId}`,
      keys: { p256dh: browser.p256dh, auth: browser.auth },
    }),
  })
  expect(response.status).toBe(200)
}

const outbox = async (device: Device): Promise<ReadonlyArray<PushNotice>> =>
  (await bindings.PLAYERS.getByName(device.deviceId).testOutbox()).map(json =>
    Option.getOrThrow(decodePushNotice(json)),
  )

const waitForNotice = async (
  device: Device,
  prefix: string,
): Promise<PushNotice> => {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const found = (await outbox(device)).find(notice =>
      notice.tag.startsWith(prefix),
    )
    if (found !== undefined) {
      return found
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`no ${prefix} push for ${device.deviceId}`)
}

// TESTS

describe('web push encoding', () => {
  test('a browser can decrypt the aes128gcm payload', async () => {
    const browser = await makeBrowserSubscription()
    const body = await encryptPayload(
      {
        endpoint: 'https://push.example/x',
        p256dh: browser.p256dh,
        auth: browser.auth,
      },
      '{"hello":"world"}',
    )
    expect(await browser.decrypt(body)).toBe('{"hello":"world"}')
  })

  test('the VAPID header is an ES256 JWT for the push origin, signed by our key', async () => {
    const keys = {
      publicKey: bindings.VAPID_PUBLIC_KEY ?? '',
      privateKey: bindings.VAPID_PRIVATE_KEY ?? '',
      subject: 'mailto:test@example.invalid',
    }
    const header = await vapidAuthorization(
      'https://push.example/abc',
      keys,
      1_000,
    )
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, head = '', claims = '', signature = '', k = ''] = match ?? []
    expect(k).toBe(keys.publicKey)
    expect(
      JSON.parse(new TextDecoder().decode(fromBase64Url(claims))),
    ).toMatchObject({
      aud: 'https://push.example',
      sub: 'mailto:test@example.invalid',
    })
    const verifyKey = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      fromBase64Url(signature),
      encoder.encode(`${head}.${claims}`),
    )
    expect(valid).toBe(true)
  })
})

describe('pings', () => {
  test('a ping reaches the player to move, once an hour, and never the pinger', async () => {
    const { host, guest } = await startFriendGame()
    await subscribe(host.device)
    await subscribe(guest.device)

    // NOTE: The host moves first, so the host can't ping.
    const hostReply = nextMessage(host, 'host ping reply')
    host.send(ClientMessage.Ping())
    expect((await hostReply)._tag).toBe('Rejected')

    const first = nextMessage(guest, 'first ping reply')
    guest.send(ClientMessage.Ping())
    expect((await first)._tag).toBe('Snapshot')
    const notice = await waitForNotice(host.device, 'ping-')
    expect(notice.title).toBe('Bea pinged you')

    const second = nextMessage(guest, 'second ping reply')
    guest.send(ClientMessage.Ping())
    const reply = await second
    expect(reply._tag).toBe('Rejected')
    expect(
      (await outbox(host.device)).filter(n => n.tag.startsWith('ping-')),
    ).toHaveLength(1)
    expect(await outbox(guest.device)).toHaveLength(0)
    host.close()
    guest.close()
  })
})

describe('game pushes', () => {
  test('your-turn goes only to a player who is not connected', async () => {
    const { host, guest } = await startFriendGame()
    await subscribe(guest.device)
    guest.close()
    await new Promise(resolve => setTimeout(resolve, 50))

    host.send(ClientMessage.TakeAction({ action: PlayerAction.DrewTicket() }))
    const turn = await waitForNotice(guest.device, 'turn-')
    expect(turn.title).toBe('Your turn')
    host.close()
  })

  test('every player gets the final scores when the game ends', async () => {
    const { host, guest } = await startFriendGame()
    await subscribe(host.device)
    await subscribe(guest.device)
    await playUntilOver([host, guest])
    const [hostFinal, guestFinal] = await Promise.all([
      waitForNotice(host.device, 'final-'),
      waitForNotice(guest.device, 'final-'),
    ])
    expect(hostFinal.body).toContain('Ada')
    expect(guestFinal.body).toContain('Bea')
    host.close()
    guest.close()
  })

  test('the 48-hour warning reaches the host of an idle lobby', async () => {
    const hostDevice = makeDevice('host')
    const code = await createGame(hostDevice, 'Ada')
    await subscribe(hostDevice)
    await bindings.GAMES.getByName(code).testAdvanceClock(WARN_AFTER_MS)
    await runDurableObjectAlarm(bindings.GAMES.getByName(code))
    const warning = await waitForNotice(hostDevice, 'warning-')
    expect(warning.body).toContain('24 hours')
  })
})
