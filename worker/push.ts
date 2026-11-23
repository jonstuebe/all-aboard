// NOTE: Web Push from a Worker with WebCrypto only: a VAPID JWT (RFC 8292)
// signs each request, and the payload is encrypted with aes128gcm (RFC 8291)
// for the browser's push subscription keys.

export type PushSubscriptionKeys = Readonly<{
  endpoint: string
  p256dh: string
  auth: string
}>

export type VapidKeys = Readonly<{
  publicKey: string
  privateKey: string
  subject: string
}>

const encoder = new TextEncoder()

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  parts.reduce((offset, part) => {
    out.set(part, offset)
    return offset + part.length
  }, 0)
  return out
}

const hmac = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data))
}

// NOTE: HKDF with a single SHA-256 block, which is all RFC 8291 needs.
const hkdf = async (
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> => {
  const prk = await hmac(salt, ikm)
  const okm = await hmac(prk, concat(info, new Uint8Array([1])))
  return okm.slice(0, length)
}

// VAPID

const vapidPrivateKey = (keys: VapidKeys): Promise<CryptoKey> => {
  const publicBytes = fromBase64Url(keys.publicKey)
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(publicBytes.slice(1, 33)),
      y: toBase64Url(publicBytes.slice(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

export const vapidAuthorization = async (
  endpoint: string,
  keys: VapidKeys,
  nowSeconds: number,
): Promise<string> => {
  const header = toBase64Url(
    encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })),
  )
  const claims = toBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSeconds + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  )
  const unsigned = `${header}.${claims}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await vapidPrivateKey(keys),
    encoder.encode(unsigned),
  )
  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${keys.publicKey}`
}

// ENCRYPTION (RFC 8291)

const RECORD_SIZE = 4096

export const encryptPayload = async (
  subscription: PushSubscriptionKeys,
  payload: string,
): Promise<Uint8Array> => {
  const uaPublic = fromBase64Url(subscription.p256dh)
  const authSecret = fromBase64Url(subscription.auth)
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const serverKeys = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', serverKeys.publicKey)) as ArrayBuffer,
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // NOTE: workers-types names this field `$public`; the runtime reads `public`.
      {
        name: 'ECDH',
        public: uaKey,
      } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      serverKeys.privateKey,
      256,
    ),
  )
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
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
  const contentKey = await crypto.subtle.importKey(
    'raw',
    cek,
    'AES-GCM',
    false,
    ['encrypt'],
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      contentKey,
      concat(encoder.encode(payload), new Uint8Array([2])),
    ),
  )
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, ciphertext)
}

export type PushOutcome = 'Sent' | 'Expired' | 'Failed'

export const sendPush = async (
  subscription: PushSubscriptionKeys,
  payload: string,
  keys: VapidKeys,
  send: (request: Request) => Promise<Response> = request => fetch(request),
): Promise<PushOutcome> => {
  const body = await encryptPayload(subscription, payload)
  const request = new Request(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(
        subscription.endpoint,
        keys,
        Math.floor(Date.now() / 1000),
      ),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 60 * 60),
      Urgency: 'normal',
    },
    body,
  })
  try {
    const response = await send(request)
    if (response.status === 404 || response.status === 410) {
      return 'Expired'
    }
    return response.ok ? 'Sent' : 'Failed'
  } catch {
    return 'Failed'
  }
}
