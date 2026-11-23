# All Aboard: Multiplayer Plan

Status: design agreed with the owner, 2026-11-23. Not started.

## Goals

- Two modes: **Play with friends** and **Play with bots**. Both support 2–5 players.
- Async turns with no timer. Players wait on each other and can ping.
- Installable PWA with push notifications for "your turn," pings, warnings, and final scores.
- Invite codes. Backend on Cloudflare Workers and Durable Objects.
- No sign-in, ever. Identity is per device.

## UX

### Main menu

- **Your turn**: games waiting on you.
- **Waiting on others**: games in progress, with a Ping button on each one.
- **Lobbies** (the "pending invites"): lobbies you created or joined that haven't started.
- **Past games**: finished games, kept for one week. Games you left show "Left."
- **Stats**: games played, wins, win rate, average score, longest route, tickets completed. Bot games count.
- Buttons for **New game with friends** and **New game with bots**.

### Lobby (friend games)

- Shows the invite code (e.g. `TRAIN-4K7`) and a share link (Web Share API).
- Players appear live as they join. Each joiner enters a name (prefilled from the last one used on this device) and picks a colour for this game only. Colours already taken are greyed out. Colours never stick to a player.
- The host can add bots, remove anyone, and start whenever there are at least 2 seats (bots count). Maximum 5 seats.
- After Start, seats are locked. Opening the link shows "This game already started," and that person sits it out.

### In game

- No turn timer.
- **Ping**: sends the current player a push. Limit: once an hour per pinger per game, enforced on the server. The button shows how long until you can ping again.
- **Leave game**: a bot takes the seat. It keeps the player's name with a bot badge, plus their hand and tickets. The player who left gets no further notifications from that game. If no humans remain, the game ends quietly.

### Game over

- Every human still in the game gets a push with the final scores.
- The results screen plays a celebration animation, to be built by a Fable agent.
- **Rematch**: the finished game becomes a lobby with the same seats. Each human taps Ready (bots are always ready), then the host starts a new shuffle whenever they choose.

### Deletion

- **In-progress game or unstarted lobby**: 72 hours with no move is the limit. At 48 hours, the player whose turn it is gets a warning push ("…will be deleted in 24 hours"); for a lobby, the host gets it. At 72 hours the game is deleted.
- **Finished game**: deleted one week after it ends.
- Opening a deleted game, by link or from the menu, shows "This game no longer exists" and the reason (e.g. "removed after 3 days with no moves").

## Technical design

### What the current code already gives us

- `applyAction(model, PlayerAction)` in `src/domain/game.ts` is pure, so the server can run the exact same rules and be the only authority.
- `PlayerAction` is a small, Schema-tagged union, so validating it on the wire is cheap.
- Seeded RNG (`src/domain/rng.ts`) means a game is `seed + action log`, and it can be replayed. Use this for storage, reconnects, and debugging.
- `decideBotAction` already feeds `applyAction`, so bots move to the server unchanged.

### Architecture

- **Worker**: HTTP routing, static PWA assets, and Web Push sending (VAPID).
- **`GameDO`**: one per friend game, addressed by its invite code. It holds:
  - Phase (`Lobby` → `Playing` → `Finished` → `RematchLobby`).
  - Seats: name, colour, kind (Human/Bot/LeftToBot), and the device ID that owns the seat.
  - Seed, action log, and periodic snapshots in DO SQLite.
  - Ping timestamps per (pinger, target).
  - One alarm that covers bot moves (a 1–2 second delay), the 48-hour warning, 72-hour deletion, and one-week deletion.
  - Hibernatable WebSockets for live updates while the app is open.
- **`PlayerDO`** (or a D1 table): one per device ID. It holds the menu index (game codes, phase, whose turn), push subscriptions, and stats. Stats live here so they survive after a game is deleted.
- **Tombstones**: a deleted game leaves `code → { reason, deletedAt }` in KV or D1, so old links explain themselves.
- **Bot-only games** run on the device, as today, and work offline. Each finished result is queued locally and posted to `PlayerDO` stats when the device is next online.

### Identity

- On first launch, the app generates a random device ID and secret and keeps them in localStorage/IndexedDB. Every request is authenticated with them.
- Joining a game binds a seat to the device ID. Losing or clearing the device loses its games. The owner accepts this trade-off.

### Hidden information

- Never send the full `Model` to a client. The server builds a per-seat `ClientView`:
  - The seat's own hand and tickets.
  - Other players' card counts, ticket counts, trains, and claims.
  - The market, discard count, and deck/ticket-pile counts.
- **Never** send `rngState`, `deck` order, or `ticketPile` order. With the seeded RNG, `rngState` predicts every future draw.
- The view code renders from `ClientView`, and bot-only local games build one from their local `Model` as well. That keeps one rendering path.

### Code changes in the domain

- `applyAction` assumes the actor is `currentPlayerIndex`. The server must check that the sending device owns that seat.
- Move `maybeHoveredRouteId` and `maybeNotice` out of the game `Model` into client UI state. Rejected-move notices go only to the actor.
- Replace the hardcoded `SEATS` with seats from the lobby (2–5, with names, colours, and kinds).
- Tune the board and rules for 2–5 players. For example, double routes might open only at 4 or more players, and there need to be enough cards and trains for 5. This needs a playtest pass.
- Add a way for a seat to change from human to bot mid-game.

### Push notifications

- Service worker plus the Web Push API. Subscriptions are stored per device in `PlayerDO`.
- Events that push: your turn, ping, 48-hour deletion warning, final scores.
- iOS only allows push from a home-screen-installed PWA (16.4+), so onboarding needs an "Add to Home Screen" step, and the permission prompt has to come from a tap.
- Devices that left a game are excluded from all of its pushes.

### Live updates

- While a game screen is open, the client keeps a WebSocket to `GameDO` and receives a fresh `ClientView` after each action. Snapshots are enough for v1; per-seat events (for animations) can come later.
- When the app opens, it fetches the menu from `PlayerDO` and the state of any open game from its `GameDO`.

## Suggested build order

1. Domain refactor: configurable seats (2–5), a `ClientView` projection, UI state split out of `Model`, and the actor check.
2. A Worker plus `GameDO` with lobby, start, and actions over WebSocket. Friend games playable in the browser.
3. `PlayerDO`, the main menu, stats, and tombstones.
4. Alarms: bots on the server, the 48h/72h/one-week lifecycle.
5. PWA manifest, service worker, Web Push, and pings.
6. Leaving the game (hand-off to a bot), rematch flow, final-score push.
7. Final-score celebration animation (Fable agent).
8. Balance pass for 2–5 players.

## Constraints and coordination

- Read `AGENTS.md` and `FOLDKIT.md` first. Never call `Math.random` in `update`.
- Another agent is editing `src/view.ts` and `src/styles.css` on `main`. Coordinate before touching them, especially for the animation.
- The dev server runs on port 5188 and is exposed to `*.ts.net` for Tailscale previews.

## Build notes (steps 1–6)

Choices made where this plan was silent. Each is the simplest option consistent with it.

- **Identity**: a random device ID and secret, made on first launch and kept in localStorage. The device's `PlayerDO` stores a hash of the secret the first time it sees it (trust on first use). There is no sign-in, so clearing site data starts a new identity.
- **Invite codes**: `TRAIN-XXX` style. The code is the `GameDO` name and the `/g/<code>` URL.
- **Storage**: `GameDO` keeps the room as one JSON row plus an action log in its SQLite storage. `PlayerDO` keeps the menu, stats, recorded results and push subscriptions. Tombstones go in KV (`TOMBSTONES`).
- **Live updates**: hibernatable WebSockets. Every change sends each socket its own snapshot (lobby, table `ClientView`, closed or gone). There is no delta protocol.
- **Alarms**: one alarm per game, set to the earliest of the next bot move (`BOT_DELAY_MS`, 1.5 s locally), the 48-hour warning, 72-hour deletion and one-week cleanup.
- **Stats**: recorded once per finished game, keyed by code and round, for people still in it. A player who left gets no result. Bot-only results post when the menu next loads.
- **Push**: sent from the Worker with WebCrypto only (VAPID JWT and aes128gcm), with no Node libraries. "Your turn" is skipped while that device has the game open on a socket. Expired subscriptions (404/410) are dropped. `bun run dev:vars` writes local VAPID keys to the gitignored `.dev.vars`.
- **Pings**: also available from the menu's "Waiting on others" rows, over HTTP (`POST /api/games/<code>/ping`). The same once-an-hour limit applies.
- **Service worker**: network-first for everything except `/api`, so an online visit always gets the latest build and the cache only serves offline launches (bot games). The notification permission is asked only from a tap on "Turn on notifications". On iOS outside a home-screen install, the card explains Add to Home Screen instead.
- **Leave game**: asks for a second tap ("A bot will take your seat"). The seat keeps its device so the leaver's menu shows "Left". If the last person leaves a game in progress, it is deleted with the reason "Everyone left this game." There is no final-score push and no stats.
- **Rematch**: any person still in the finished game can open it. Their seat starts ready, bots are always ready, and the host's seat always counts. Seats whose player left stay as bots under the same name. Players who aren't ready when the host starts are left out of the new game. The host role passes to the first remaining person if the host left.
- **Not built here**: step 7 (celebration) and step 8 (balance), as agreed.
