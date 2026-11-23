# Prototype notes: home screen

A throwaway branch for choosing a home-screen design. Not for merging; the
winner was rebuilt cleanly on `home-wizard`.

## The question

What should the home screen look like? It is the card where you enter your
name and either start a game with friends, start a game with bots (2–5
players), or join with an invite code, above the menu (your games,
notifications and stats). The owner views it at phone width (~390px).

Every variant ran on the real home route with the real Model and Messages,
picked with `?variant=` and a dev-only switcher pill.

## Rounds

**Round 1: five styles** (`119ca10`)

- A, Departure board: a split-flap station board.
- B, Printed ticket: a cream ticket you fill in.
- C, Brass control panel: a dial and big push buttons.
- D, Timetable poster: a letterpress poster.
- E, Luggage tags: a travel poster with coloured tags.

The owner's feedback:

- A: loved the idea, but it was too technical and dense.
- B: easier to read, but it wasn't clear what was tappable.
- C: disliked, and dropped.
- D: good, but it had the same tappability problem as B.
- E: no comment.

**Round 2: affordances** (`4bfe3ed`)

A, B and D were redone to one set of rules:

- raised, verb-labelled buttons at least 44px tall;
- inset fields with a label above;
- a segmented 2–5 control;
- nothing decorative shaped like a button.

A was softened into a warm walnut board. F was added as a hybrid of B's paper
and A's departure rows. The verdict: B (Printed ticket) was the favourite
look.

**Round 3: layouts in B's look** (`12e3bec`)

- G, Ticket book tabs: Friends, Bots and Join tabs, with one section shown.
- H, Hero ticket: a big friends ticket, then a smaller bots slip and a thin
  code strip.
- I, Ticket carousel: three tickets you swipe through.

The owner liked H best.

**Round 4: refining H, and J** (`906af94`, `3601f27`)

- H lost the red header strip, and every container now shares one column
  width.
- Stats show only after a finished game.
- J, Ticket wizard, asks one question per step:
  1. Name, skipped when the device remembers one.
  2. How to play: with friends, with bots, or with an invite code.
  3. Players, or the invite code.

## Verdict

**J (Ticket wizard) won. H (Hero ticket) was the runner-up.**

Why J:

- Each screen asks one thing, so it is the shortest and calmest on a phone.
- A returning player who is already remembered lands straight on "How do
  you want to play?", one tap from a game.
- "Playing as … · Change" keeps the name visible without a field on every
  visit.

Why H came second: it shows everything at once with a clear hierarchy, but
on a phone that makes it the longest screen, and it shows the name field
every time.
