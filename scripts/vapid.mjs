import { webcrypto } from 'node:crypto'

// NOTE: Makes a VAPID key pair for Web Push: the public key as an uncompressed
// P-256 point and the private key as its `d`, both base64url.
export const generateVapidKeys = async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const raw = new Uint8Array(
    await webcrypto.subtle.exportKey('raw', pair.publicKey),
  )
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
  return {
    publicKey: Buffer.from(raw).toString('base64url'),
    privateKey: jwk.d,
  }
}
