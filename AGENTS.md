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
