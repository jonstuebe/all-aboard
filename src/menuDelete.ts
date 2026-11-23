import { Array, Effect, Option, Schema } from 'effect'
import { Command } from 'foldkit'

import { Device, authHeaders } from './device'
import { MenuState } from './menuSync'
import { Message } from './message'
import type { MenuStatus } from './protocol'

// NOTE: Deleting a game from the menu. The server decides what that means for
// the game itself (see removalFor in worker/room.ts); the menu drops the row
// straight away and refetches once the server answers.

export const DeleteGameFromMenu = Command.define('DeleteGameFromMenu', {
  args: { code: Schema.String, device: Device },
  messages: [Message.CompletedDeleteGame],
  execute: ({ code, device }) =>
    Effect.tryPromise(async () => {
      const response = await fetch(`/api/games/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        headers: authHeaders(device),
      })
      return response.ok
        ? Option.none<string>()
        : Option.some('That game couldn’t be deleted.')
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(Option.some('Couldn’t reach the game server.')),
      ),
      Effect.map(maybeReason => Message.CompletedDeleteGame({ maybeReason })),
    ),
})

/** The menu without one game, for dropping a deleted row before the server answers. */
export const withoutGame = (state: MenuState, code: string): MenuState =>
  MenuState.match<MenuState>(state, {
    Loading: () => state,
    Loaded: ({ menu }) =>
      MenuState.Loaded({
        menu: {
          ...menu,
          games: Array.filter(menu.games, entry => entry.code !== code),
        },
      }),
    Offline: () => state,
  })

/** What the confirm step says, since deleting means something different per game. */
export const deletePrompt = (status: MenuStatus): string => {
  switch (status) {
    case 'Lobby':
      return 'Delete this lobby? If you opened it, it closes for everyone.'
    case 'YourTurn':
    case 'Waiting':
      return 'Leave this game? A bot takes your seat.'
    case 'Finished':
    case 'Left':
    case 'Gone':
      return 'Remove this game from your list?'
  }
}
