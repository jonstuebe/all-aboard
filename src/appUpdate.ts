import { Duration, Effect, Option, Stream } from 'effect'
import { Command, Dom } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './message'

// NOTE: A home-screen app never reloads by itself, so a new deploy would sit
// unseen. Each build stamps its id into the bundle (__BUILD_ID__) and into
// /version.json (vite.config.ts). When the app comes back to the foreground,
// and every few minutes while it's open, it reads /version.json; a different
// id shows a banner offering to reload. The service worker is network first,
// so the reload gets the new build. The dev server has no version.json and
// never checks.

declare const __BUILD_ID__: string | undefined

const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

export const VERSION_PATH = '/version.json'

const CHECK_INTERVAL = Duration.minutes(5)

const fetchLatestBuildId: Effect.Effect<Option.Option<string>> =
  Effect.tryPromise(async () => {
    const response = await fetch(VERSION_PATH, { cache: 'no-store' })
    if (!response.ok) {
      return Option.none()
    }
    const body: unknown = await response.json()
    return typeof body === 'object' &&
      body !== null &&
      'id' in body &&
      typeof body.id === 'string'
      ? Option.some(body.id)
      : Option.none()
  }).pipe(Effect.catch(() => Effect.succeed(Option.none<string>())))

const isNewer = (latest: Option.Option<string>): boolean =>
  Option.exists(latest, id => id !== BUILD_ID)

const foregrounded = Dom.streamFromEventFilterMap({
  target: document,
  type: 'visibilitychange',
  filterMapEvent: () =>
    document.visibilityState === 'visible' ? Option.some(true) : Option.none(),
})

/** Emits once when a newer build is live, then stops. */
export const appUpdateStream: Stream.Stream<Message> =
  BUILD_ID === 'dev'
    ? Stream.empty
    : Stream.merge(Stream.tick(CHECK_INTERVAL), foregrounded).pipe(
        Stream.mapEffect(() => fetchLatestBuildId),
        Stream.filter(isNewer),
        Stream.take(1),
        Stream.map(() => Message.FoundAppUpdate()),
      )

export const ReloadApp = Command.define('ReloadApp', {
  messages: [Message.CompletedReloadApp],
  execute: Effect.sync(() => location.reload()).pipe(
    Effect.as(Message.CompletedReloadApp()),
  ),
})

/** The banner along the bottom of every screen once a new build is live. */
export const appUpdateView = (
  isUpdateReady: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  isUpdateReady
    ? h.div(
        [h.Class('update-toast'), h.Role('status')],
        [
          h.span([h.Class('update-toast-text')], ['A new version is ready']),
          h.button(
            [
              h.Class('btn btn-green btn-compact update-toast-reload'),
              h.Type('button'),
              h.OnClick(Message.ClickedReloadApp()),
            ],
            ['Refresh'],
          ),
          h.button(
            [
              h.Class('update-toast-dismiss'),
              h.Type('button'),
              h.AriaLabel('Not now'),
              h.OnClick(Message.DismissedAppUpdate()),
            ],
            ['×'],
          ),
        ],
      )
    : h.empty
