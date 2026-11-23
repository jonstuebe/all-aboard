# Product

> Direction change: the owner rejected the flat transit-map look. The UI is now deliberately skeuomorphic: an engraved paper map of the United States, track with ties and rails, train-car cards, wood, brass, leather and ticket stubs. Where the sections below say otherwise (Brand Personality, the first two Anti-references), this note wins.

## Register

product

## Users

One person playing a short game, about ten minutes, against two computer opponents. They often play on a phone held in portrait, reaching the dev server over Tailscale. Sometimes they play on a laptop. They want to tell at a glance whose turn it is, which routes they can afford, and how close each ticket is.

## Product Purpose

All Aboard is a lean prototype of a train route-building game. Players collect colored train cards, claim routes between cities, and connect the cities on their destination tickets. It exists to prove out the game loop and the Foldkit architecture, with all rules, turns and bots living in Model, update, Commands and Subscriptions. It succeeds if a full game plays cleanly from start to final scores and reads clearly on a phone.

## Brand Personality

Crisp, legible, quietly playful. It should feel like a well-made transit map and a station departure board: confident linework, signal colors with a job to do, and no decoration for its own sake. The pleasure comes from the board filling in with your color.

## Anti-references

- Skeuomorphic board-game chrome: wood grain, felt, parchment maps, fake paper textures.
- Cream, sand or parchment backgrounds.
- Casino or mobile-gacha styling: glossy gradients, bouncy motion, confetti on every action.
- Copying any existing commercial board game's map, art, name or look.

## Design Principles

1. The board is the interface. Claimable routes, ownership and tickets should be readable on the map itself before you look at any panel.
2. Color always has a second cue. Every card and route color pairs with a glyph, and every player pairs with a marker and a name.
3. Whose turn it is should never be in doubt. Bot moves are paced and narrated, so the player can follow what changed.
4. Explain refusals. When an action can't be taken, say why in plain words. Never fail silently.
5. Phone first. Every action is reachable with a thumb in portrait.

## Accessibility & Inclusion

- WCAG 2.2 AA contrast for text and essential graphics.
- Colorblind-safe: never rely on color alone. Cards and routes carry glyphs, and players carry initials.
- Respect `prefers-reduced-motion`: no pulsing or sliding when it is set.
- Keyboard support: routes are focusable, and shortcuts cover the deck (D), tickets (T) and market slots (1 to 5).

_Assumed defaults: the requester was asked about mood, anti-references and accessibility needs but hadn't answered when this was written. Revise these sections when they do._
