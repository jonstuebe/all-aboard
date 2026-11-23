# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: false

## Project Notes

Domain vocabulary, deployment steps, local conventions that differ from Foldkit's defaults: write them here.

- Game rules live in `src/domain/game.ts` as pure `Model -> Model` functions. Human Messages and bot decisions both go through `applyAction(model, PlayerAction)`.
- Randomness: the seed comes from the `RollSeed` Command, and all shuffles thread `model.rngState` through `src/domain/rng.ts`. Never call `Math.random` in `update`.
- `Array.makeBy(0, ...)` returns one element (Effect normalizes `n` up to 1). Use the `repeatCard` helper in game.ts for counts that can be zero.
- Design context lives in `PRODUCT.md` (impeccable skill).
- The dev server runs on port 5188 (5173 is taken on this machine) and is exposed to `*.ts.net` for Tailscale previews.
- All illustration (train cars, track, pieces, depots, the US map backdrop) is static SVG markup in `src/art.ts`, set through `h.InnerHTML` and styled only from `src/styles.css`. The map is projected from longitude/latitude with the same formula that places the cities in `src/domain/board.ts`; move a city and the backdrop still lines up.
- Multiplayer: `worker/` is the Cloudflare Worker (`GameDO` per game, `PlayerDO` per device). It runs the same `applyAction` and sends each seat only its `ClientView`. Develop locally with `bun run dev:worker`. A push to `main` deploys production to https://all-aboard.jonstuebe.com through Cloudflare's Git integration (Workers Builds, set up in the dashboard). The VAPID keys live as Worker secrets on Cloudflare, not in the repo or GitHub. Don't run `wrangler deploy` by hand unless asked. Worker tests run in `@cloudflare/vitest-plugin` as part of `bun run test`.
- Package manager is Bun (versions pinned in `mise.toml`; Node is still the runtime for Vite/Vitest). Use `bun install` / `bun add`, and `bun run test` for Vitest (plain `bun test` starts Bun's own test runner, which is wrong here). Don't add a `package-lock.json`.
- Table screen: `/g/CODE/watch` opens a watch-only view for an iPad or laptop (`src/screens/watch.ts`, `src/watch.css`). Its socket connects with `?watch=1`, so the GameDO tags it as a watcher, sends it `WatchLobby`/`WatchTable` snapshots built from `projectView(game, -1)` (no hands), rejects anything it sends, and reveals every seat's tickets only at GameOver. The end-of-game tour (`src/recap.ts`) runs only on the watching device.
