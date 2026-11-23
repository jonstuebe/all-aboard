import { Effect, Option, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'

import { BrowserCrypto } from '@effect/platform-browser'

import { DEVICE_ID_HEADER, DEVICE_SECRET_HEADER } from './protocol'

// NOTE: Identity is per device: a random ID and secret made on first launch
// and kept in localStorage. There is no sign-in. It reaches the Model through
// Flags, and Commands that talk to the server take it as an argument.

const DEVICE_KEY = 'allAboard.device'
const NAME_KEY = 'allAboard.name'

export const Device = Schema.Struct({
  deviceId: Schema.String,
  secret: Schema.String,
})
export type Device = typeof Device.Type

const DeviceJson = Schema.fromJsonString(Device)

const toHex = (buffer: Uint8Array): string =>
  Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('')

const randomToken = (bytes: number): Effect.Effect<string> =>
  SecureRandom.SecureRandom.use(random => random.randomBytes(bytes)).pipe(
    Effect.map(toHex),
    Effect.provide(BrowserCrypto.layerSecureRandom),
  )

const readStorage = (key: string): Option.Option<string> => {
  try {
    return Option.fromNullishOr(localStorage.getItem(key))
  } catch {
    return Option.none()
  }
}

const writeStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // NOTE: Private windows can refuse storage; the device then lasts one visit.
  }
}

const makeDevice: Effect.Effect<Device> = Effect.gen(function* () {
  const device: Device = {
    deviceId: `d-${yield* randomToken(12)}`,
    secret: yield* randomToken(24),
  }
  return device
}).pipe(
  Effect.tap(device =>
    Effect.sync(() => writeStorage(DEVICE_KEY, JSON.stringify(device))),
  ),
)

// NOTE: Runs once, at startup, as part of Flags. If storage is refused (some
// private windows) the device lasts for this page load only.
export const loadDevice: Effect.Effect<Device> = Effect.suspend(() =>
  Option.match(
    Option.flatMap(
      readStorage(DEVICE_KEY),
      Schema.decodeUnknownOption(DeviceJson),
    ),
    { onSome: Effect.succeed, onNone: () => makeDevice },
  ),
)

export const loadPlayerName: Effect.Effect<string> = Effect.sync(() =>
  Option.getOrElse(readStorage(NAME_KEY), () => ''),
)

export const savePlayerName = (name: string): Effect.Effect<void> =>
  Effect.sync(() => writeStorage(NAME_KEY, name))

export const authHeaders = (device: Device): Record<string, string> => ({
  [DEVICE_ID_HEADER]: device.deviceId,
  [DEVICE_SECRET_HEADER]: device.secret,
})

export const socketUrl = (device: Device, code: string): string => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query = new URLSearchParams({
    device: device.deviceId,
    secret: device.secret,
  })
  return `${protocol}//${location.host}/api/games/${encodeURIComponent(code)}/ws?${query.toString()}`
}
