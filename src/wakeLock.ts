import { Effect, Schema } from 'effect'
import { ManagedResource } from 'foldkit'

// NOTE: A table screen sits on a table for a whole game, so it holds a screen
// wake lock while it watches. Browsers without the API, or that refuse it,
// just let the screen sleep as usual.

export const ScreenWakeLock =
  ManagedResource.tag<WakeLockSentinel>()('ScreenWakeLock')

export const WakeLockRequirements = Schema.Option(
  Schema.Struct({ code: Schema.String }),
)

export const acquireWakeLock = () =>
  Effect.tryPromise({
    try: () => navigator.wakeLock.request('screen'),
    catch: () => new Error('Wake lock refused.'),
  })

export const releaseWakeLock = (sentinel: WakeLockSentinel) =>
  Effect.promise(() => sentinel.release()).pipe(
    Effect.catchCause(() => Effect.void),
  )
