import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Card } from './domain/board'

export const PlayerKind = Schema.Literals(['Human', 'Bot', 'LeftToBot'])
export type PlayerKind = typeof PlayerKind.Type

export const MIN_SEATS = 2
export const MAX_SEATS = 5
export const TONE_COUNT = 5

export const SeatConfig = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(['Human', 'Bot']),
  tone: Schema.Number,
})
export type SeatConfig = typeof SeatConfig.Type

export const Player = Schema.Struct({
  name: Schema.String,
  kind: PlayerKind,
  tone: Schema.Number,
  hand: Schema.Array(Card),
  trains: Schema.Number,
  routePoints: Schema.Number,
  ticketIds: Schema.Array(Schema.String),
})
export type Player = typeof Player.Type

export const Claim = Schema.Struct({
  routeId: Schema.String,
  playerIndex: Schema.Number,
})
export type Claim = typeof Claim.Type

export const TurnStep = Schema.Literals(['ChoosingAction', 'DrawingSecondCard'])
export type TurnStep = typeof TurnStep.Type

export const Standing = Schema.Struct({
  playerIndex: Schema.Number,
  routePoints: Schema.Number,
  ticketPoints: Schema.Number,
  completedTickets: Schema.Number,
  failedTickets: Schema.Number,
  total: Schema.Number,
})
export type Standing = typeof Standing.Type

export const Phase = defineTaggedUnion({
  Dealing: {},
  Playing: { step: TurnStep },
  GameOver: { standings: Schema.Array(Standing) },
})
export type Phase = typeof Phase.Type

export const LogEntry = Schema.Struct({
  id: Schema.Number,
  playerIndex: Schema.Number,
  text: Schema.String,
  maybeSelfText: Schema.Option(Schema.String),
})
export type LogEntry = typeof LogEntry.Type

export const Model = Schema.Struct({
  gameId: Schema.Number,
  phase: Phase,
  rngState: Schema.Number,
  players: Schema.Array(Player),
  currentPlayerIndex: Schema.Number,
  deck: Schema.Array(Card),
  discard: Schema.Array(Card),
  market: Schema.Array(Schema.Option(Card)),
  ticketPile: Schema.Array(Schema.String),
  claims: Schema.Array(Claim),
  maybeFinalTurnsLeft: Schema.Option(Schema.Number),
  turnNumber: Schema.Number,
  log: Schema.Array(LogEntry),
  nextLogId: Schema.Number,
})
export type Model = typeof Model.Type
