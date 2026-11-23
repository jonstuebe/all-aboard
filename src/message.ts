import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { TurnStep } from './model'

export const Message = defineMessageUnion({
  CompletedRollSeed: { seed: Schema.Number },
  ClickedDeck: {},
  ClickedMarketCard: { slot: Schema.Number },
  ClickedRoute: { routeId: Schema.String },
  ClickedDrawTicket: {},
  ClickedPass: {},
  ClickedNewGame: {},
  ClickedMenu: {},
  ClickedPing: {},
  ClickedLeaveGame: {},
  ClickedRematch: {},
  HoveredRoute: { routeId: Schema.String },
  UnhoveredRoute: {},
  PressedKey: { key: Schema.String },
  CompletedWaitForBot: {
    gameId: Schema.Number,
    turnNumber: Schema.Number,
    step: TurnStep,
  },
})
export type Message = typeof Message.Type
