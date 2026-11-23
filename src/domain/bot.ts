import { Array, Option, Order, Result, pipe } from 'effect'

import type { Model, TurnStep } from '../model'
import {
  CARD_COLORS,
  type Card,
  type CardColor,
  MARKET_SIZE,
  ROUTES,
  type Route,
  ticketById,
} from './board'
import {
  PlayerAction,
  actAs,
  applyAction,
  canDrawFromDeck,
  canTakeMarketCard,
  countCards,
  currentPlayer,
  isTicketComplete,
  marketCardAt,
  maybeClaimPayment,
  maybeRouteOwner,
  maybeSeatPickingTickets,
  maybeTurnStep,
  playerAt,
  ticketsToKeep,
} from './game'

type PathNode = Readonly<{
  cityId: string
  cost: number
  routes: ReadonlyArray<Route>
}>

const routeCost = (
  model: Model,
  playerIndex: number,
  route: Route,
): Option.Option<number> =>
  Option.match(maybeRouteOwner(model, route.id), {
    onNone: () => Option.some(route.length),
    onSome: owner => (owner === playerIndex ? Option.some(0) : Option.none()),
  })

const otherEnd = (route: Route, cityId: string): Option.Option<string> =>
  route.from === cityId
    ? Option.some(route.to)
    : route.to === cityId
      ? Option.some(route.from)
      : Option.none()

const byCost = Order.mapInput(Order.Number, (node: PathNode) => node.cost)

const shortestPath = (
  model: Model,
  playerIndex: number,
  from: string,
  to: string,
): Option.Option<ReadonlyArray<Route>> => {
  const search = (
    frontier: ReadonlyArray<PathNode>,
    settled: ReadonlyArray<string>,
  ): Option.Option<ReadonlyArray<Route>> =>
    Array.match(Array.sort(frontier, byCost), {
      onEmpty: () => Option.none(),
      onNonEmpty: ([closest, ...rest]) => {
        if (closest.cityId === to) {
          return Option.some(closest.routes)
        }
        if (Array.contains(settled, closest.cityId)) {
          return search(rest, settled)
        }
        const expansions: ReadonlyArray<PathNode> = Array.getSomes(
          Array.map(ROUTES, route =>
            pipe(
              otherEnd(route, closest.cityId),
              Option.filter(next => !Array.contains(settled, next)),
              Option.flatMap(next =>
                Option.map(routeCost(model, playerIndex, route), cost => ({
                  cityId: next,
                  cost: closest.cost + cost,
                  routes: Array.append(closest.routes, route),
                })),
              ),
            ),
          ),
        )
        return search(
          Array.appendAll(rest, expansions),
          Array.append(settled, closest.cityId),
        )
      },
    })
  return search([{ cityId: from, cost: 0, routes: [] }], [])
}

const neededRoutes = (model: Model): ReadonlyArray<Route> => {
  const playerIndex = model.currentPlayerIndex
  const player = currentPlayer(model)
  return pipe(
    player.ticketIds,
    Array.filter(ticketId => !isTicketComplete(model, playerIndex, ticketId)),
    Array.flatMap(ticketId => {
      const ticket = ticketById(ticketId)
      return Option.getOrElse(
        shortestPath(model, playerIndex, ticket.from, ticket.to),
        () => [],
      )
    }),
    Array.filter(route => Option.isNone(maybeRouteOwner(model, route.id))),
    Array.dedupeWith((self, that) => self.id === that.id),
  )
}

// NOTE: Trains still to lay to finish a ticket, counting routes the seat
// already owns as free. A ticket the seat can't reach at all costs the most.
const ticketCost = (
  model: Model,
  playerIndex: number,
  ticketId: string,
): number => {
  const ticket = ticketById(ticketId)
  return Option.match(
    shortestPath(model, playerIndex, ticket.from, ticket.to),
    {
      onNone: () => Number.MAX_SAFE_INTEGER,
      onSome: routes =>
        Array.reduce(routes, 0, (sum, route) =>
          Option.isSome(maybeRouteOwner(model, route.id))
            ? sum
            : sum + route.length,
        ),
    },
  )
}

type TicketChoice = Readonly<{ ticketId: string; cost: number; points: number }>

// NOTE: A bot keeps the fewest tickets it must, cheapest to finish first
// (ties go to more points), plus any it has already connected.
export const chooseTicketsToKeep = (
  model: Model,
  playerIndex: number,
  step: TurnStep,
): ReadonlyArray<string> => {
  const offered = playerAt(model, playerIndex).offeredTicketIds
  const ranked = pipe(
    offered,
    Array.map((ticketId): TicketChoice => ({
      ticketId,
      cost: ticketCost(model, playerIndex, ticketId),
      points: ticketById(ticketId).points,
    })),
    Array.sort(
      Order.combine(
        Order.mapInput(Order.Number, (entry: TicketChoice) => entry.cost),
        Order.flip(
          Order.mapInput(Order.Number, (entry: TicketChoice) => entry.points),
        ),
      ),
    ),
  )
  const minimum = ticketsToKeep(step, offered.length)
  return Array.map(
    Array.filter(ranked, (entry, index) => index < minimum || entry.cost === 0),
    entry => entry.ticketId,
  )
}

const mostHeldColor = (hand: ReadonlyArray<Card>): CardColor =>
  pipe(
    CARD_COLORS,
    Array.sort(
      Order.flip(
        Order.mapInput(Order.Number, (color: CardColor) =>
          countCards(hand, color),
        ),
      ),
    ),
    Array.head,
    Option.getOrElse((): CardColor => 'Red'),
  )

const wantedColors = (
  model: Model,
  routes: ReadonlyArray<Route>,
): ReadonlyArray<CardColor> => {
  const hand = currentPlayer(model).hand
  return Array.dedupe(
    Array.map(routes, route =>
      route.color === 'Gray' ? mostHeldColor(hand) : route.color,
    ),
  )
}

const longestFirst = Order.flip(
  Order.mapInput(Order.Number, (route: Route) => route.length),
)

const MARKET_SLOTS = Array.range(0, MARKET_SIZE - 1)

const chooseDraw = (
  model: Model,
  step: TurnStep,
  colors: ReadonlyArray<CardColor>,
): PlayerAction => {
  const maybeWantedSlot = Array.findFirst(MARKET_SLOTS, slot =>
    pipe(
      marketCardAt(model, slot),
      Option.exists(card => card !== 'Wild' && Array.contains(colors, card)),
    ),
  )
  const maybeWildSlot =
    step === 'ChoosingAction'
      ? Array.findFirst(MARKET_SLOTS, slot =>
          Option.contains(marketCardAt(model, slot), 'Wild'),
        )
      : Option.none()
  const maybeAnySlot = Array.findFirst(MARKET_SLOTS, slot =>
    canTakeMarketCard(model, slot, step),
  )

  return pipe(
    maybeWantedSlot,
    Option.orElse(() => maybeWildSlot),
    Option.map(slot => PlayerAction.TookMarketCard({ slot })),
    Option.orElse(() =>
      canDrawFromDeck(model)
        ? Option.some(PlayerAction.DrewFromDeck())
        : Option.none(),
    ),
    Option.orElse(() =>
      Option.map(maybeAnySlot, slot => PlayerAction.TookMarketCard({ slot })),
    ),
    Option.getOrElse(() => PlayerAction.Passed()),
  )
}

const LOW_TRAINS = 5
const BIG_HAND = 10
const TICKET_TRAIN_MINIMUM = 7

const chooseOpeningAction = (model: Model): PlayerAction => {
  const playerIndex = model.currentPlayerIndex
  const player = currentPlayer(model)
  const needed = neededRoutes(model)
  const affordable = Array.filter(ROUTES, route =>
    Option.isSome(maybeClaimPayment(model, playerIndex, route.id)),
  )
  const neededAffordable = pipe(
    affordable,
    Array.filter(route => Array.some(needed, wanted => wanted.id === route.id)),
    Array.sort(longestFirst),
  )
  const claimAction = (routes: ReadonlyArray<Route>) =>
    Option.map(Array.head(routes), route =>
      PlayerAction.ClaimedRoute({ routeId: route.id }),
    )

  const shouldTakeTicket =
    Array.isReadonlyArrayEmpty(needed) &&
    Array.isReadonlyArrayNonEmpty(model.ticketPile) &&
    player.trains >= TICKET_TRAIN_MINIMUM

  const shouldDumpCards =
    Array.isReadonlyArrayEmpty(needed) ||
    player.trains <= LOW_TRAINS ||
    player.hand.length >= BIG_HAND

  const canDraw =
    canDrawFromDeck(model) ||
    Array.some(MARKET_SLOTS, slot =>
      canTakeMarketCard(model, slot, 'ChoosingAction'),
    )

  return pipe(
    claimAction(neededAffordable),
    Option.orElse(() =>
      shouldTakeTicket ? Option.some(PlayerAction.DrewTicket()) : Option.none(),
    ),
    Option.orElse(() =>
      shouldDumpCards || !canDraw
        ? claimAction(Array.sort(affordable, longestFirst))
        : Option.none(),
    ),
    Option.orElse(() =>
      canDraw
        ? Option.some(
            chooseDraw(model, 'ChoosingAction', wantedColors(model, needed)),
          )
        : Option.none(),
    ),
    Option.orElse(() =>
      Array.isReadonlyArrayNonEmpty(model.ticketPile)
        ? Option.some(PlayerAction.DrewTicket())
        : Option.none(),
    ),
    Option.getOrElse(() => PlayerAction.Passed()),
  )
}

export const decideBotAction = (model: Model): PlayerAction =>
  Option.match(maybeTurnStep(model), {
    onNone: () => PlayerAction.Passed(),
    onSome: step =>
      step === 'KeepingTickets' || step === 'ChoosingStartTickets'
        ? PlayerAction.KeptTickets({
            ticketIds: chooseTicketsToKeep(
              model,
              model.currentPlayerIndex,
              step,
            ),
          })
        : step === 'DrawingSecondCard'
          ? chooseDraw(model, step, wantedColors(model, neededRoutes(model)))
          : chooseOpeningAction(model),
  })

const FALLBACK_ACTIONS: ReadonlyArray<PlayerAction> = [
  PlayerAction.DrewFromDeck(),
  PlayerAction.DrewTicket(),
  PlayerAction.Passed(),
]

// NOTE: A bot must never stall a game. If its chosen action is rejected, it
// falls back to the simplest legal moves, and as a last resort the turn is
// left unchanged so the caller can see nothing happened.
export const playBotStep = (model: Model): Model =>
  Option.match(maybeSeatPickingTickets(model), {
    onSome: seatIndex =>
      Result.getOrElse(
        actAs(
          model,
          seatIndex,
          PlayerAction.KeptTickets({
            ticketIds: chooseTicketsToKeep(
              model,
              seatIndex,
              'ChoosingStartTickets',
            ),
          }),
        ),
        () => model,
      ),
    onNone: () => playTurnStep(model),
  })

const playTurnStep = (model: Model): Model =>
  pipe(
    Array.prepend(FALLBACK_ACTIONS, decideBotAction(model)),
    Array.findFirst(action => Result.getSuccess(applyAction(model, action))),
    Option.getOrElse(() => model),
  )
