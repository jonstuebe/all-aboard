import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'

import { TurnStep } from './model'
import { NotificationStatus } from './notificationStatus'
import { Menu, ServerMessage } from './protocol'
import { SoundSetting } from './soundSetting'
import { DockTab } from './table'

export const Message = defineMessageUnion({
  // ROUTING
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigate: {},

  // HOME
  UpdatedNameInput: { value: Schema.String },
  CompletedSavePlayerName: {},
  ClickedSeatCount: { count: Schema.Number },
  DraggedSeatCount: { count: Schema.Number },
  ClickedNewBotGame: {},
  ClickedNewFriendGame: {},
  SucceededCreateGame: { code: Schema.String },
  FailedCreateGame: { reason: Schema.String },
  UpdatedJoinCode: { value: Schema.String },
  SubmittedJoinCode: {},
  ClickedWatchCode: {},
  SubmittedName: {},
  ClickedPlayWithBots: {},
  ClickedHaveInviteCode: {},
  ClickedWizardBack: {},
  ClickedChangeName: {},
  SucceededFetchMenu: { menu: Menu },
  FailedFetchMenu: {},
  CompletedQueueLocalResult: {},
  ClickedMenuPing: { code: Schema.String },
  CompletedMenuPing: { maybeReason: Schema.Option(Schema.String) },
  ClickedDeleteGame: { code: Schema.String },
  ClickedCancelDeleteGame: {},
  ClickedConfirmDeleteGame: { code: Schema.String },
  CompletedDeleteGame: { maybeReason: Schema.Option(Schema.String) },
  TickedClock: { now: Schema.Number },

  // CONFIRM DIALOG
  CompletedShowConfirmDialog: {},
  CompletedCloseConfirmDialog: {},

  // NOTIFICATIONS
  CheckedNotifications: { status: NotificationStatus },
  ClickedEnableNotifications: {},

  // TABLE
  CompletedRollSeed: { seed: Schema.Number },
  ClickedDeck: {},
  ClickedMarketCard: { slot: Schema.Number },
  ClickedRoute: { routeId: Schema.String },
  ClickedDrawTicket: {},
  ToggledOfferedTicket: { ticketId: Schema.String },
  ClickedKeepTickets: { ticketIds: Schema.Array(Schema.String) },
  ClickedPass: {},
  ClickedNewGame: {},
  ClickedMenu: {},
  ClickedPing: {},
  ClickedLeaveGame: {},
  ConfirmedLeaveGame: {},
  CancelledLeaveGame: {},
  ClickedRematch: {},
  HoveredRoute: { routeId: Schema.String },
  UnhoveredRoute: {},
  ClickedDockTab: { tab: DockTab },
  DraggedDockTab: { tab: DockTab },
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
  ClickedCopyCode: {},
  CompletedCopyCode: { didCopy: Schema.Boolean },

  // TABLE SCREEN
  CompletedWaitForRecap: { run: Schema.Number, position: Schema.Number },
  ClickedRecapPlayer: { playerIndex: Schema.Number },
  ClickedRecapScores: {},
  ClickedReplayRecap: {},
  ClickedFullscreen: {},
  CompletedRequestFullscreen: {},
  AcquiredWakeLock: {},
  ReleasedWakeLock: {},
  FailedWakeLock: {},
  ClickedSound: { setting: SoundSetting },
  CompletedPlaySounds: {},
  AcquiredAudio: {},
  ReleasedAudio: {},
  FailedAudio: {},

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
