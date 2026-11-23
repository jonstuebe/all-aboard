import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ClientView } from './domain/clientView'
import { PlayerAction } from './domain/game'

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
