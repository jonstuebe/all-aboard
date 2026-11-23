import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Device, authHeaders } from './device'
import { Message } from './message'
import { NotificationStatus } from './notificationStatus'
import { PushConfig } from './protocol'

// NOTE: The PWA side of notifications. The service worker is registered on
// every launch (it also caches the app so bot games work offline). Push is
// only turned on from a tap, because browsers (and iOS especially) refuse a
// permission prompt that doesn't come from one.

export { NotificationStatus }

const SERVICE_WORKER_URL = '/sw.js'

const isSupported = (): boolean =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent)

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && navigator.standalone === true)

const registration = Effect.tryPromise(() =>
  navigator.serviceWorker.register(SERVICE_WORKER_URL),
)

const currentStatus = Effect.gen(function* () {
  if (!('serviceWorker' in navigator)) {
    return NotificationStatus.Unsupported()
  }
  yield* registration
  if (!isSupported()) {
    // NOTE: iOS only exposes push to a home-screen-installed PWA (16.4+).
    return isIos() && !isStandalone()
      ? NotificationStatus.NeedsInstall()
      : NotificationStatus.Unsupported()
  }
  if (Notification.permission === 'denied') {
    return NotificationStatus.Blocked()
  }
  const ready = yield* Effect.tryPromise(() => navigator.serviceWorker.ready)
  const subscription = yield* Effect.tryPromise(() =>
    ready.pushManager.getSubscription(),
  )
  return subscription !== null && Notification.permission === 'granted'
    ? NotificationStatus.On()
    : NotificationStatus.Off()
}).pipe(Effect.catch(() => Effect.succeed(NotificationStatus.Unsupported())))

export const CheckNotifications = Command.define('CheckNotifications', {
  messages: [Message.CheckedNotifications],
  execute: currentStatus.pipe(
    Effect.map(status => Message.CheckedNotifications({ status })),
  ),
})

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const decodePushConfig = Schema.decodeUnknownEffect(PushConfig)

const subscribe = (device: Device) =>
  Effect.gen(function* () {
    const permission = yield* Effect.tryPromise(() =>
      Notification.requestPermission(),
    )
    if (permission === 'denied') {
      return NotificationStatus.Blocked()
    }
    if (permission !== 'granted') {
      return NotificationStatus.Off()
    }
    const configResponse = yield* Effect.tryPromise(() =>
      fetch('/api/push-key'),
    )
    if (!configResponse.ok) {
      return NotificationStatus.Failed({
        reason: 'This server can’t send notifications yet.',
      })
    }
    const { publicKey } = yield* decodePushConfig(
      yield* Effect.tryPromise(() => configResponse.json()),
    )
    const ready = yield* Effect.tryPromise(() => navigator.serviceWorker.ready)
    const subscription = yield* Effect.tryPromise(() =>
      ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(publicKey),
      }),
    )
    const saved = yield* Effect.tryPromise(() =>
      fetch('/api/me/push', {
        method: 'POST',
        headers: { ...authHeaders(device), 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      }),
    )
    return saved.ok
      ? NotificationStatus.On()
      : NotificationStatus.Failed({
          reason: 'Couldn’t save this device for notifications.',
        })
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        NotificationStatus.Failed({
          reason: 'Couldn’t turn on notifications.',
        }),
      ),
    ),
  )

export const EnableNotifications = Command.define('EnableNotifications', {
  args: { device: Device },
  messages: [Message.CheckedNotifications],
  execute: ({ device }) =>
    subscribe(device).pipe(
      Effect.map(status => Message.CheckedNotifications({ status })),
    ),
})

// VIEW

const note = (text: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class('notify-note')], [text])

export const notificationsView = (
  status: NotificationStatus,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('notify-card')],
    NotificationStatus.match<ReadonlyArray<Html>>(status, {
      Checking: () => [],
      Unsupported: () => [],
      NeedsInstall: () => [
        note(
          'To get “your turn” alerts on iPhone, tap Share, then Add to Home Screen, and open All Aboard from there.',
          h,
        ),
      ],
      Off: () => [
        h.button(
          [
            h.Class('btn btn-cream'),
            h.Type('button'),
            h.OnClick(Message.ClickedEnableNotifications()),
          ],
          ['Turn on notifications'],
        ),
        note(
          'Get told when it’s your turn, when someone pings you, and the final scores.',
          h,
        ),
      ],
      Working: () => [note('Turning on notifications…', h)],
      On: () => [note('Notifications are on for this device.', h)],
      Blocked: () => [
        note(
          'Notifications are blocked for this site. Allow them in your browser settings.',
          h,
        ),
      ],
      Failed: ({ reason }) => [
        h.button(
          [
            h.Class('btn btn-cream'),
            h.Type('button'),
            h.OnClick(Message.ClickedEnableNotifications()),
          ],
          ['Try again'],
        ),
        note(reason, h),
      ],
    }),
  )
