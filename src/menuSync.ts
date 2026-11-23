import { Effect, Option, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { BrowserCrypto } from '@effect/platform-browser'

import { Device, authHeaders } from './device'
import { SeatResult } from './domain/results'
import { Message } from './message'
import { LocalResult, Menu, decodeMenu } from './protocol'

// NOTE: The main menu comes from this device's PlayerDO. Bot-only games are
// played offline, so their results wait in localStorage until the next time
// the menu loads, and are posted just before it is fetched.

export const MenuState = defineTaggedUnion({
  Loading: {},
  Loaded: { menu: Menu },
  Offline: { maybeMenu: Schema.Option(Menu) },
})
export type MenuState = typeof MenuState.Type

const QUEUE_KEY = 'allAboard.pendingResults'

const PendingResults = Schema.Array(LocalResult)
const PendingResultsJson = Schema.fromJsonString(
  Schema.toCodecJson(PendingResults),
)
const decodePending = Schema.decodeUnknownOption(PendingResultsJson)
const encodePending = Schema.encodeSync(PendingResultsJson)

const readPending = Effect.sync((): ReadonlyArray<LocalResult> => {
  try {
    return Option.getOrElse(
      Option.flatMap(
        Option.fromNullishOr(localStorage.getItem(QUEUE_KEY)),
        decodePending,
      ),
      () => [],
    )
  } catch {
    return []
  }
})

const writePending = (results: ReadonlyArray<LocalResult>) =>
  Effect.sync(() => {
    try {
      if (results.length === 0) {
        localStorage.removeItem(QUEUE_KEY)
      } else {
        localStorage.setItem(QUEUE_KEY, encodePending(results))
      }
    } catch {
      // NOTE: Without storage the result is simply not counted.
    }
  })

export const QueueLocalResult = Command.define('QueueLocalResult', {
  args: { result: SeatResult },
  messages: [Message.CompletedQueueLocalResult],
  execute: ({ result }) =>
    Effect.gen(function* () {
      const id = yield* SecureRandom.SecureRandom.use(random =>
        random.uuidV4(),
      ).pipe(Effect.provide(BrowserCrypto.layerSecureRandom))
      const pending = yield* readPending
      yield* writePending([...pending, { id: `local-${id}`, result }])
      return Message.CompletedQueueLocalResult()
    }),
})

const AcceptedResults = Schema.Struct({ accepted: Schema.Array(Schema.String) })

const flushPending = (device: Device) =>
  Effect.gen(function* () {
    const pending = yield* readPending
    if (pending.length === 0) {
      return
    }
    const response = yield* Effect.tryPromise(() =>
      fetch('/api/me/results', {
        method: 'POST',
        headers: { ...authHeaders(device), 'content-type': 'application/json' },
        body: JSON.stringify({ results: pending }),
      }),
    )
    const body = yield* Effect.tryPromise(() => response.json())
    const accepted: ReadonlyArray<string> = Option.match(
      Schema.decodeUnknownOption(AcceptedResults)(body),
      { onNone: () => [], onSome: decoded => decoded.accepted },
    )
    const stillPending = (yield* readPending).filter(
      ({ id }) => !accepted.includes(id),
    )
    yield* writePending(stillPending)
  }).pipe(Effect.catch(() => Effect.void))

export const FetchMenu = Command.define('FetchMenu', {
  args: { device: Device },
  messages: [Message.SucceededFetchMenu, Message.FailedFetchMenu],
  execute: ({ device }) =>
    Effect.gen(function* () {
      yield* flushPending(device)
      const response = yield* Effect.tryPromise(() =>
        fetch('/api/me', { headers: authHeaders(device) }),
      )
      const text = yield* Effect.tryPromise(() => response.text())
      return Option.match(decodeMenu(text), {
        onNone: () => Message.FailedFetchMenu(),
        onSome: menu => Message.SucceededFetchMenu({ menu }),
      })
    }).pipe(Effect.catch(() => Effect.succeed(Message.FailedFetchMenu()))),
})

export const menuAfterFailure = (state: MenuState): MenuState =>
  MenuState.Offline({
    maybeMenu:
      state._tag === 'Loaded'
        ? Option.some(state.menu)
        : state._tag === 'Offline'
          ? state.maybeMenu
          : Option.none(),
  })
