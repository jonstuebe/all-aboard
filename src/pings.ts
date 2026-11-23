import { Effect, Option, Schema } from 'effect'
import { Command } from 'foldkit'

import { Device, authHeaders } from './device'
import { Message } from './message'
import { PingStatus } from './table'

// NOTE: The table's Ping button. The server says whether pinging makes sense
// and when it next may; the client only counts down to that time.
export const pingStatus = (
  table: Readonly<{
    canPing: boolean
    maybePingAvailableAt: Option.Option<number>
  }>,
  isPinging: boolean,
  now: number,
): PingStatus => {
  if (!table.canPing) {
    return PingStatus.Hidden()
  }
  if (isPinging) {
    return PingStatus.Sending()
  }
  const availableAt = Option.getOrElse(table.maybePingAvailableAt, () => 0)
  const minutesLeft = Math.ceil((availableAt - now) / 60_000)
  return minutesLeft > 0
    ? PingStatus.Waiting({ minutesLeft })
    : PingStatus.Ready()
}

// NOTE: The menu's Ping button pings over HTTP, since there is no socket open
// on the menu.
export const PingGameFromMenu = Command.define('PingGameFromMenu', {
  args: { code: Schema.String, device: Device },
  messages: [Message.CompletedMenuPing],
  execute: ({ code, device }) =>
    Effect.tryPromise(async () => {
      const response = await fetch(
        `/api/games/${encodeURIComponent(code)}/ping`,
        {
          method: 'POST',
          headers: authHeaders(device),
        },
      )
      return response.ok
        ? Option.none<string>()
        : Option.some('That ping didn’t go through.')
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(Option.some('Couldn’t reach the game server.')),
      ),
      Effect.map(maybeReason => Message.CompletedMenuPing({ maybeReason })),
    ),
})
