import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'

import { TurnStep } from './model'
import { Menu, ServerMessage } from './protocol'

export const Message = defineMessageUnion({
  // ROUTING
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigate: {},

  // HOME
  UpdatedNameInput: { value: Schema.String },
  CompletedSavePlayerName: {},
  ClickedSeatCount: { count: Schema.Number },
  ClickedNewBotGame: {},
  ClickedNewFriendGame: {},
  SucceededCreateGame: { code: Schema.String },
  FailedCreateGame: { reason: Schema.String },
  UpdatedJoinCode: { value: Schema.String },
  SubmittedJoinCode: {},
  SucceededFetchMenu: { menu: Menu },
  FailedFetchMenu: {},
  CompletedQueueLocalResult: {},
  ClickedMenuPing: { code: Schema.String },

  // TABLE
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

  // LOBBY
  UpdatedJoinName: { value: Schema.String },
  ClickedTone: { tone: Schema.Number },
  SubmittedJoinLobby: {},
  ClickedAddBot: {},
  ClickedRemoveSeat: { seatIndex: Schema.Number },
  ClickedStartGame: {},
  ClickedLeaveLobby: {},
  ClickedReady: { isReady: Schema.Boolean },
  ClickedShareInvite: {},
  CompletedShareInvite: {},

  // SOCKET
  ConnectedGameSocket: {},
  ReleasedGameSocket: {},
  FailedConnectGameSocket: { error: Schema.String },
  DisconnectedGameSocket: {},
  CompletedWaitToReconnect: { code: Schema.String, attempt: Schema.Number },
  ReceivedServerMessage: { message: ServerMessage },
  CompletedSendClientMessage: {},
  FailedSendClientMessage: { reason: Schema.String },
})
export type Message = typeof Message.Type
