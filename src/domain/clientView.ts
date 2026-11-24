import { Array, Option, Schema, pipe } from 'effect'

import { Claim, type Model, Phase, PlayerKind, type TurnStep } from '../model'
import { Card, ROUTES, maybeRouteById } from './board'
import {
  type Payment,
  countCards,
  findPayment,
  isRouteClosedFor,
  isTicketComplete,
  ticketsToKeep,
} from './game'

// NOTE: A ClientView is everything one seat is allowed to know. It never holds
// rngState (which predicts every future draw), the deck or ticket-pile order,
// or another seat's cards and tickets. Both the server and the local bot table
// build one from a full Model, so the view has a single rendering path.

export const ClientPlayer = Schema.Struct({
  name: Schema.String,
  kind: PlayerKind,
  tone: Schema.Number,
  hand: Schema.Array(Card),
  handCount: Schema.Number,
  trains: Schema.Number,
  routePoints: Schema.Number,
  ticketIds: Schema.Array(Schema.String),
  ticketCount: Schema.Number,
  offeredTicketIds: Schema.Array(Schema.String),
  isPickingTickets: Schema.Boolean,
})
export type ClientPlayer = typeof ClientPlayer.Type

export const ClientLogEntry = Schema.Struct({
  id: Schema.Number,
  playerIndex: Schema.Number,
  text: Schema.String,
})
export type ClientLogEntry = typeof ClientLogEntry.Type

export const ClientView = Schema.Struct({
  viewerIndex: Schema.Number,
  phase: Phase,
  players: Schema.Array(ClientPlayer),
  currentPlayerIndex: Schema.Number,
  deckCount: Schema.Number,
  discardCount: Schema.Number,
  market: Schema.Array(Schema.Option(Card)),
  ticketPileCount: Schema.Number,
  claims: Schema.Array(Claim),
  maybeFinalTurnsLeft: Schema.Option(Schema.Number),
  turnNumber: Schema.Number,
  log: Schema.Array(ClientLogEntry),
})
export type ClientView = typeof ClientView.Type

// PROJECTION

export const projectView = (model: Model, viewerIndex: number): ClientView => ({
  viewerIndex,
  phase: model.phase,
  players: Array.map(model.players, (player, playerIndex) => {
    const isViewer = playerIndex === viewerIndex
    return {
      name: player.name,
      kind: player.kind,
      tone: player.tone,
      hand: isViewer ? player.hand : [],
      handCount: player.hand.length,
      trains: player.trains,
      routePoints: player.routePoints,
      ticketIds: isViewer ? player.ticketIds : [],
      ticketCount: player.ticketIds.length,
      offeredTicketIds: isViewer ? player.offeredTicketIds : [],
      isPickingTickets: Array.isReadonlyArrayNonEmpty(player.offeredTicketIds),
    }
  }),
  currentPlayerIndex: model.currentPlayerIndex,
  deckCount: model.deck.length,
  discardCount: model.discard.length,
  market: model.market,
  ticketPileCount: model.ticketPile.length,
  claims: model.claims,
  maybeFinalTurnsLeft: model.maybeFinalTurnsLeft,
  turnNumber: model.turnNumber,
  log: Array.map(model.log, entry => ({
    id: entry.id,
    playerIndex: entry.playerIndex,
    text:
      entry.playerIndex === viewerIndex
        ? Option.getOrElse(entry.maybeSelfText, () => entry.text)
        : entry.text,
  })),
})

// QUERIES

export const maybeTurnStep = (view: ClientView): Option.Option<TurnStep> =>
  Phase.match<Option.Option<TurnStep>>(view.phase, {
    Dealing: () => Option.none(),
    Playing: ({ step }) => Option.some(step),
    GameOver: () => Option.none(),
  })

export const viewer = (view: ClientView): Option.Option<ClientPlayer> =>
  Array.get(view.players, view.viewerIndex)

export const currentPlayer = (view: ClientView): Option.Option<ClientPlayer> =>
  Array.get(view.players, view.currentPlayerIndex)

export const isViewerTurn = (view: ClientView): boolean =>
  Option.isSome(maybeTurnStep(view)) &&
  !Option.contains(maybeTurnStep(view), 'ChoosingStartTickets') &&
  view.currentPlayerIndex === view.viewerIndex &&
  Option.exists(viewer(view), player => player.kind === 'Human')

export const marketCardAt = (
  view: ClientView,
  slot: number,
): Option.Option<Card> => pipe(view.market, Array.get(slot), Option.flatten)

export const canDrawFromDeck = (view: ClientView): boolean =>
  view.deckCount > 0 || view.discardCount > 0

export const canTakeMarketCard = (
  view: ClientView,
  slot: number,
  step: TurnStep,
): boolean =>
  Option.match(marketCardAt(view, slot), {
    onNone: () => false,
    onSome: card => !(step === 'DrawingSecondCard' && card === 'Wild'),
  })

export const maybeRouteOwner = (
  view: ClientView,
  routeId: string,
): Option.Option<number> =>
  pipe(
    view.claims,
    Array.findFirst(claim => claim.routeId === routeId),
    Option.map(claim => claim.playerIndex),
  )

export const maybeViewerPayment = (
  view: ClientView,
  routeId: string,
): Option.Option<Payment> =>
  Option.flatMap(viewer(view), player =>
    Option.flatMap(maybeRouteById(routeId), route =>
      Option.isSome(maybeRouteOwner(view, routeId)) ||
      isRouteClosedFor(view, view.viewerIndex, route) ||
      player.trains < route.length
        ? Option.none()
        : findPayment(player.hand, route),
    ),
  )

export const isViewerTicketComplete = (
  view: ClientView,
  ticketId: string,
): boolean => isTicketComplete(view, view.viewerIndex, ticketId)

export const viewerHasAnyMove = (view: ClientView): boolean =>
  canDrawFromDeck(view) ||
  Array.some(view.market, Option.isSome) ||
  view.ticketPileCount > 0 ||
  Array.some(ROUTES, route => Option.isSome(maybeViewerPayment(view, route.id)))

export { countCards }

// NOTE: The tickets the viewer is choosing between right now, with how many
// they must keep. None when there is nothing to pick.
export const maybeViewerTicketOffer = (
  view: ClientView,
): Option.Option<
  Readonly<{ ticketIds: ReadonlyArray<string>; minimum: number }>
> =>
  Option.flatMap(maybeTurnStep(view), step =>
    Option.flatMap(viewer(view), player =>
      Array.isReadonlyArrayNonEmpty(player.offeredTicketIds)
        ? Option.some({
            ticketIds: player.offeredTicketIds,
            minimum: ticketsToKeep(step, player.offeredTicketIds.length),
          })
        : Option.none(),
    ),
  )
