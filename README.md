# All Aboard

A small train route-building game built with [Foldkit](https://foldkit.dev): Elm-style architecture on Effect. You play against two bots. Collect colored train cards, claim routes between cities, and connect the cities on your destination tickets before the trains run out.

## Run it

```bash
bun install
bun run dev
```

Then open http://localhost:5188. The dev server listens on every network interface and accepts `*.ts.net` hostnames, so it's also reachable at `http://<your-machine>.<tailnet>.ts.net:5188` over Tailscale.

Other scripts: `bun run test` (Vitest), `bun run typecheck`, `bun run lint`, `bun run build`.

### Playing with friends (local multiplayer)

Friend games run against a local Cloudflare Worker (`worker/`). Nothing is deployed.

```bash
bun run dev:vars        # once: writes local Web Push keys to .dev.vars (gitignored)
bun run dev:worker      # wrangler dev on 127.0.0.1:8790
PORT=5199 bun run dev   # Vite; proxies /api and the game WebSocket to the worker
```

Open the app in two browser profiles: start a game with friends in one and join with its invite code in the other. Games with only bots still run entirely on the device and work offline. The design and build notes are in `docs/multiplayer-plan.md`.

## How to play

On your turn, do one of these:

- **Draw two cards.** Take them from the face-up market or the deck. A face-up wild counts as your whole turn, and it can't be your second card.
- **Claim a route.** Tap or click a route that glows orange. Pay with cards that match its color, or any single color for a gray route. Wilds fill gaps.
- **Take a destination ticket.**

Route points: 1 car is 1 point, 2 cars 2, 3 cars 4, 4 cars 7. When a player has 2 or fewer trains left, everyone gets one last turn. At the end, each connected ticket adds its points and each unconnected ticket subtracts them.

Keyboard: `D` draws from the deck, `1` to `5` take a market card, `T` takes a ticket, and `Enter` claims a focused route.

## Code map

| File | Role |
| --- | --- |
| `src/model.ts` | Model schema: players, deck, market, claims, phase (`Dealing`, `Playing`, `GameOver`) |
| `src/message.ts` | Every Message the app reacts to |
| `src/main.ts` | `init`, `update`, Commands (`RollSeed`, `WaitForBot`), Subscriptions (keyboard shortcuts) |
| `src/domain/board.ts` | Cities, routes, tickets, deck composition |
| `src/domain/game.ts` | Pure rules: drawing, paying for and claiming routes, tickets, turn order, final round, scoring |
| `src/domain/bot.ts` | Bot strategy: shortest paths for its tickets, then claim or draw what it needs |
| `src/domain/rng.ts` | Seeded PRNG, so `update` stays pure. The seed comes from a Command. |
| `src/view.ts`, `src/styles.css` | SVG board and the panels around it |

Bots go through the same `applyAction` as the human player. When a bot's turn starts, `update` returns a `WaitForBot` Command. Its result Message triggers the bot's move, which is checked against the game, turn and step so a stale timer can't act.
