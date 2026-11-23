import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ClientView } from './domain/clientView'
import { PlayerAction } from './domain/game'
import { SeatResult, Stats } from './domain/results'

// NOTE: Everything that crosses the wire between the app and the Worker is
// declared here, once, as a Schema. Both sides decode what they receive, so a
// malformed or hostile message is rejected before it reaches the rules.

export const CODE_PATTERN = /^TRAIN-[A-Z2-9]{3,5}$/
export const NAME_MAX_LENGTH = 20

export const normalizeCode = (raw: string): string => {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '')
  return cleaned.startsWith('TRAIN-') ? cleaned : `TRAIN-${cleaned}`
}

export const isValidCode = (code: string): boolean => CODE_PATTERN.test(code)

// LOBBY

export const LobbySeat = Schema.Struct({
  seatIndex: Schema.Number,
  name: Schema.String,
  tone: Schema.Number,
  kind: Schema.Literals(['Human', 'Bot']),
  isYou: Schema.Boolean,
  isHost: Schema.Boolean,
  isReady: Schema.Boolean,
})
export type LobbySeat = typeof LobbySeat.Type

// SNAPSHOT

// NOTE: WatchLobby and WatchTable go only to a table screen: a device that
// opened /g/CODE/watch and holds no seat in what it sees. It gets public
// information only. Each seat's tickets are revealed once the game is over.

export const GameSnapshot = defineTaggedUnion({
  Lobby: {
    code: Schema.String,
    seats: Schema.Array(LobbySeat),
    isRematch: Schema.Boolean,
    isViewerSeated: Schema.Boolean,
    isViewerHost: Schema.Boolean,
  },
  Table: {
    code: Schema.String,
    view: ClientView,
    maybePingAvailableAt: Schema.Option(Schema.Number),
    canPing: Schema.Boolean,
  },
  WatchLobby: {
    code: Schema.String,
    seats: Schema.Array(LobbySeat),
    isRematch: Schema.Boolean,
  },
  WatchTable: {
    code: Schema.String,
    view: ClientView,
    revealedTickets: Schema.Array(Schema.Array(Schema.String)),
  },
  Closed: { code: Schema.String, reason: Schema.String },
  Gone: { code: Schema.String, reason: Schema.String },
})
export type GameSnapshot = typeof GameSnapshot.Type

// CLIENT -> SERVER

export const ClientMessage = defineTaggedUnion({
  JoinLobby: { name: Schema.String, tone: Schema.Number },
  ChangeTone: { tone: Schema.Number },
  AddBot: {},
  RemoveSeat: { seatIndex: Schema.Number },
  StartGame: {},
  TakeAction: { action: PlayerAction },
  Ping: {},
  LeaveGame: {},
  MarkReady: { isReady: Schema.Boolean },
  OpenRematch: {},
})
export type ClientMessage = typeof ClientMessage.Type

// SERVER -> CLIENT

export const ServerMessage = defineTaggedUnion({
  Snapshot: { snapshot: GameSnapshot },
  Rejected: { reason: Schema.String },
})
export type ServerMessage = typeof ServerMessage.Type

export const ClientMessageJson = Schema.fromJsonString(
  Schema.toCodecJson(ClientMessage),
)
export const ServerMessageJson = Schema.fromJsonString(
  Schema.toCodecJson(ServerMessage),
)

export const GameSnapshotJson = Schema.fromJsonString(
  Schema.toCodecJson(GameSnapshot),
)
export const encodeGameSnapshot = Schema.encodeSync(GameSnapshotJson)
export const decodeGameSnapshot = Schema.decodeUnknownOption(GameSnapshotJson)

export const encodeClientMessage = Schema.encodeSync(ClientMessageJson)
export const decodeClientMessage = Schema.decodeUnknownOption(ClientMessageJson)
export const encodeServerMessage = Schema.encodeSync(ServerMessageJson)
export const decodeServerMessage = Schema.decodeUnknownOption(ServerMessageJson)

// HTTP

export const CreateGameRequest = Schema.Struct({
  name: Schema.String,
})
export type CreateGameRequest = typeof CreateGameRequest.Type

export const CreateGameResponse = Schema.Struct({ code: Schema.String })
export type CreateGameResponse = typeof CreateGameResponse.Type

export const DEVICE_ID_HEADER = 'x-device-id'
export const DEVICE_SECRET_HEADER = 'x-device-secret'
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

// MENU

export const MenuStatus = Schema.Literals([
  'YourTurn',
  'Waiting',
  'Lobby',
  'Finished',
  'Left',
  'Gone',
])
export type MenuStatus = typeof MenuStatus.Type

export const MenuEntry = Schema.Struct({
  code: Schema.String,
  status: MenuStatus,
  seatNames: Schema.Array(Schema.String),
  maybeCurrentName: Schema.Option(Schema.String),
  updatedAt: Schema.Number,
  maybeResult: Schema.Option(SeatResult),
  maybeReason: Schema.Option(Schema.String),
  maybePingAvailableAt: Schema.Option(Schema.Number),
})
export type MenuEntry = typeof MenuEntry.Type

export const Menu = Schema.Struct({
  games: Schema.Array(MenuEntry),
  stats: Stats,
})
export type Menu = typeof Menu.Type

export const MenuEntryJson = Schema.fromJsonString(
  Schema.toCodecJson(MenuEntry),
)
export const encodeMenuEntry = Schema.encodeSync(MenuEntryJson)
export const decodeMenuEntry = Schema.decodeUnknownOption(MenuEntryJson)

export const MenuJson = Schema.fromJsonString(Schema.toCodecJson(Menu))
export const encodeMenu = Schema.encodeSync(MenuJson)
export const decodeMenu = Schema.decodeUnknownOption(MenuJson)

// NOTE: A finished bot-only game, posted when the device is next online. The
// id is made on the device, so posting the same result twice counts once.
export const LocalResult = Schema.Struct({
  id: Schema.String,
  result: SeatResult,
})
export type LocalResult = typeof LocalResult.Type

export const LocalResultsRequest = Schema.Struct({
  results: Schema.Array(LocalResult),
})
export type LocalResultsRequest = typeof LocalResultsRequest.Type

export const SeatResultJson = Schema.fromJsonString(
  Schema.toCodecJson(SeatResult),
)
export const encodeSeatResult = Schema.encodeSync(SeatResultJson)
export const decodeSeatResult = Schema.decodeUnknownOption(SeatResultJson)

export const PAST_GAME_TTL_MS = 7 * 24 * 60 * 60 * 1000

// PUSH

export const PushNotice = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  tag: Schema.String,
})
export type PushNotice = typeof PushNotice.Type

export const PushNoticeJson = Schema.fromJsonString(PushNotice)
export const encodePushNotice = Schema.encodeSync(PushNoticeJson)
export const decodePushNotice = Schema.decodeUnknownOption(PushNoticeJson)

export const PushSubscriptionRequest = Schema.Struct({
  endpoint: Schema.String,
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
})
export type PushSubscriptionRequest = typeof PushSubscriptionRequest.Type

export const PushConfig = Schema.Struct({ publicKey: Schema.String })
export type PushConfig = typeof PushConfig.Type

export const PING_COOLDOWN_MS = 60 * 60 * 1000
