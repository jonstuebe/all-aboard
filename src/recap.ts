import { Array, Duration, Effect, Number, Option, Schema, pipe } from 'effect'
import { Command } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { type Route, type Ticket, routeById, ticketById } from './domain/board'
import type { ClientView } from './domain/clientView'
import { isTicketComplete } from './domain/game'
import { longestRoute } from './domain/results'
import { Message } from './message'
import type { Standing } from './model'

// NOTE: The end-of-game show on a table screen. When a game ends, the screen
// tours the players from last place to first, spotlighting each one's routes
// and tickets, then settles on the final scores. Anyone can tap a player to
// replay their spotlight. The tour only exists on the watching device, so it
// lives beside the socket state and never reaches the server.

// MODEL

export const RecapStage = defineTaggedUnion({
  Idle: {},
  Touring: { position: Schema.Number },
  Spotlight: { playerIndex: Schema.Number },
  Scoreboard: {},
})
export type RecapStage = typeof RecapStage.Type

export const Recap = Schema.Struct({
  stage: RecapStage,
  run: Schema.Number,
})
export type Recap = typeof Recap.Type

export const idleRecap: Recap = { stage: RecapStage.Idle(), run: 0 }

const REVEAL_TIME = Duration.seconds(7)

// COMMAND

export const WaitForRecap = Command.define('WaitForRecap', {
  args: { run: Schema.Number, position: Schema.Number },
  messages: [Message.CompletedWaitForRecap],
  execute: ({ run, position }) =>
    Effect.sleep(REVEAL_TIME).pipe(
      Effect.as(Message.CompletedWaitForRecap({ run, position })),
    ),
})

// NOTE: Fullscreen needs a user gesture, so it is only ever asked for from a
// click. Browsers that refuse (or lack the API) just stay windowed.
export const RequestFullscreen = Command.define('RequestFullscreen', {
  messages: [Message.CompletedRequestFullscreen],
  execute: Effect.tryPromise(() =>
    document.fullscreenElement === null
      ? document.documentElement.requestFullscreen()
      : document.exitFullscreen(),
  ).pipe(
    Effect.catch(() => Effect.void),
    Effect.as(Message.CompletedRequestFullscreen()),
  ),
})

// TRANSITIONS

export type RecapStep = Readonly<{
  recap: Recap
  commands?: ReadonlyArray<ReturnType<typeof WaitForRecap>>
}>

const tourAt = (run: number, position: number): RecapStep => ({
  recap: { stage: RecapStage.Touring({ position }), run },
  commands: [WaitForRecap({ run, position })],
})

export const startTour = (recap: Recap): RecapStep => tourAt(recap.run + 1, 0)

export const continueTour = (
  recap: Recap,
  run: number,
  position: number,
  playerCount: number,
): RecapStep => {
  const isCurrentStop =
    recap.run === run &&
    recap.stage._tag === 'Touring' &&
    recap.stage.position === position
  if (!isCurrentStop) {
    return { recap }
  }
  return position + 1 < playerCount
    ? tourAt(run, position + 1)
    : { recap: { stage: RecapStage.Scoreboard(), run } }
}

export const spotlight = (recap: Recap, playerIndex: number): Recap => ({
  stage: RecapStage.Spotlight({ playerIndex }),
  run: recap.run + 1,
})

export const showScoreboard = (recap: Recap): Recap => ({
  stage: RecapStage.Scoreboard(),
  run: recap.run + 1,
})

// QUERIES

// NOTE: Last place first, so the tour builds to the winner.
export const revealOrder = (
  standings: ReadonlyArray<Standing>,
): ReadonlyArray<number> =>
  pipe(
    standings,
    Array.map(standing => standing.playerIndex),
    Array.reverse,
  )

export const maybeSpotlitPlayer = (
  recap: Recap,
  standings: ReadonlyArray<Standing>,
): Option.Option<number> =>
  RecapStage.match<Option.Option<number>>(recap.stage, {
    Idle: () => Option.none(),
    Scoreboard: () => Option.none(),
    Spotlight: ({ playerIndex }) => Option.some(playerIndex),
    Touring: ({ position }) => Array.get(revealOrder(standings), position),
  })

export type TicketOutcome = Readonly<{ ticket: Ticket; isComplete: boolean }>

export type PlayerRecap = Readonly<{
  playerIndex: number
  place: number
  standing: Standing
  routes: ReadonlyArray<Route>
  tickets: ReadonlyArray<TicketOutcome>
  longest: number
}>

export const playerRecap = (
  view: ClientView,
  revealedTickets: ReadonlyArray<ReadonlyArray<string>>,
  standings: ReadonlyArray<Standing>,
  playerIndex: number,
): Option.Option<PlayerRecap> =>
  pipe(
    standings,
    Array.findFirst(standing => standing.playerIndex === playerIndex),
    Option.map(standing => ({
      playerIndex,
      place:
        1 +
        Array.filter(standings, other => other.total > standing.total).length,
      standing,
      routes: pipe(
        view.claims,
        Array.filter(claim => claim.playerIndex === playerIndex),
        Array.map(claim => routeById(claim.routeId)),
      ),
      tickets: pipe(
        Option.getOrElse(Array.get(revealedTickets, playerIndex), () => []),
        Array.map(ticketId => ({
          ticket: ticketById(ticketId),
          isComplete: isTicketComplete(view, playerIndex, ticketId),
        })),
      ),
      longest: longestRoute(view, playerIndex),
    })),
  )

export type Award = Readonly<{
  title: string
  playerIndices: ReadonlyArray<number>
  detail: string
}>

const leaders = (
  values: ReadonlyArray<Readonly<{ playerIndex: number; value: number }>>,
): Option.Option<
  Readonly<{ value: number; playerIndices: ReadonlyArray<number> }>
> =>
  pipe(
    Array.map(values, entry => entry.value),
    Array.reduce(0, Number.max),
    best =>
      best <= 0
        ? Option.none()
        : Option.some({
            value: best,
            playerIndices: pipe(
              values,
              Array.filter(entry => entry.value === best),
              Array.map(entry => entry.playerIndex),
            ),
          }),
  )

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

export const awards = (
  view: ClientView,
  revealedTickets: ReadonlyArray<ReadonlyArray<string>>,
  standings: ReadonlyArray<Standing>,
): ReadonlyArray<Award> => {
  const recaps = Array.getSomes(
    Array.map(standings, standing =>
      playerRecap(view, revealedTickets, standings, standing.playerIndex),
    ),
  )
  const award = (
    title: string,
    valueOf: (recap: PlayerRecap) => number,
    detail: (value: number) => string,
  ): Option.Option<Award> =>
    Option.map(
      leaders(
        Array.map(recaps, recap => ({
          playerIndex: recap.playerIndex,
          value: valueOf(recap),
        })),
      ),
      ({ value, playerIndices }) => ({
        title,
        playerIndices,
        detail: detail(value),
      }),
    )
  return Array.getSomes([
    award(
      'Longest trail',
      recap => recap.longest,
      value => plural(value, 'car', 'cars'),
    ),
    award(
      'Most tickets punched',
      recap => recap.standing.completedTickets,
      value => plural(value, 'ticket', 'tickets'),
    ),
    award(
      'Biggest single claim',
      recap =>
        pipe(
          Array.map(recap.routes, route => route.length),
          Array.reduce(0, Number.max),
        ),
      value => `${plural(value, 'car', 'cars')} at once`,
    ),
    award(
      'Most routes built',
      recap => recap.routes.length,
      value => plural(value, 'route', 'routes'),
    ),
    award(
      'Most route points',
      recap => recap.standing.routePoints,
      value => `${value} pts from track`,
    ),
  ])
}
