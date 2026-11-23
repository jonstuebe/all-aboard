import { Array, Option, Result, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { projectView } from '../src/domain/clientView'
import { BOT_NAMES, actAs, newGame } from '../src/domain/game'
import { MAX_SEATS, MIN_SEATS, Model, type SeatConfig, TONE_COUNT } from '../src/model'
import {
  type ClientMessage,
  ClientMessage as ClientMessageUnion,
  GameSnapshot,
  type LobbySeat,
  NAME_MAX_LENGTH,
} from '../src/protocol'

// NOTE: A Room is everything a GameDO stores about one friend game: the lobby
// seats, which device owns each seat, the current game Model, and lifecycle
// timestamps. Every change goes through a pure function here; the Durable
// Object only loads, saves, and talks to the network.

export const RoomPhase = Schema.Literals([
  'Lobby',
  'Playing',
  'Finished',
  'RematchLobby',
])
export type RoomPhase = typeof RoomPhase.Type

export const RoomSeat = Schema.Struct({
  name: Schema.String,
  tone: Schema.Number,
  kind: Schema.Literals(['Human', 'Bot']),
  maybeDeviceId: Schema.Option(Schema.String),
  isReady: Schema.Boolean,
  hasLeft: Schema.Boolean,
})
export type RoomSeat = typeof RoomSeat.Type

export const PingRecord = Schema.Struct({
  deviceId: Schema.String,
  at: Schema.Number,
})
export type PingRecord = typeof PingRecord.Type

export const Room = Schema.Struct({
  code: Schema.String,
  phase: RoomPhase,
  hostDeviceId: Schema.String,
  seats: Schema.Array(RoomSeat),
  generation: Schema.Number,
  maybeGame: Schema.Option(Model),
  createdAt: Schema.Number,
  lastMoveAt: Schema.Number,
  maybeWarnedAt: Schema.Option(Schema.Number),
  maybeFinishedAt: Schema.Option(Schema.Number),
  pings: Schema.Array(PingRecord),
})
export type Room = typeof Room.Type

export const RoomJson = Schema.fromJsonString(Schema.toCodecJson(Room))
export const encodeRoom = Schema.encodeSync(RoomJson)
export const decodeRoom = Schema.decodeUnknownSync(RoomJson)

export type RoomResult = Result.Result<Room, string>

const accept = (room: Room): RoomResult => Result.succeed(room)
const reject = (reason: string): RoomResult => Result.fail(reason)

// QUERIES

export const seatIndexOf = (room: Room, deviceId: string): Option.Option<number> =>
  Array.findFirstIndex(room.seats, seat =>
    Option.contains(seat.maybeDeviceId, deviceId),
  )

export const activeSeatIndexOf = (
  room: Room,
  deviceId: string,
): Option.Option<number> =>
  Option.filter(seatIndexOf(room, deviceId), seatIndex =>
    room.seats[seatIndex]?.hasLeft === false,
  )

export const humanDeviceIds = (room: Room): ReadonlyArray<string> =>
  Array.filterMap(room.seats, seat =>
    seat.kind === 'Human' && !seat.hasLeft
      ? Result.fromOption(seat.maybeDeviceId, () => undefined)
      : Result.failVoid,
  )

const isLobbyPhase = (room: Room): boolean =>
  room.phase === 'Lobby' || room.phase === 'RematchLobby'

const isHost = (room: Room, deviceId: string): boolean =>
  room.hostDeviceId === deviceId

const firstFreeTone = (seats: ReadonlyArray<RoomSeat>): number =>
  pipe(
    Array.range(0, TONE_COUNT - 1),
    Array.findFirst(tone => !Array.some(seats, seat => seat.tone === tone)),
    Option.getOrElse(() => 0),
  )

const isToneTaken = (
  seats: ReadonlyArray<RoomSeat>,
  tone: number,
  exceptSeat: Option.Option<number>,
): boolean =>
  Array.some(
    seats,
    (seat, index) => seat.tone === tone && !Option.contains(exceptSeat, index),
  )

export const cleanName = (raw: string): Option.Option<string> =>
  pipe(
    raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH),
    Option.liftPredicate(name => name.length > 0),
  )

const isValidTone = (tone: number): boolean =>
  Number.isInteger(tone) && tone >= 0 && tone < TONE_COUNT

// CREATE

export const createRoom = (
  code: string,
  hostDeviceId: string,
  hostName: string,
  now: number,
): Room => ({
  code,
  phase: 'Lobby',
  hostDeviceId,
  seats: [
    {
      name: Option.getOrElse(cleanName(hostName), () => 'Host'),
      tone: 0,
      kind: 'Human',
      maybeDeviceId: Option.some(hostDeviceId),
      isReady: true,
      hasLeft: false,
    },
  ],
  generation: 0,
  maybeGame: Option.none(),
  createdAt: now,
  lastMoveAt: now,
  maybeWarnedAt: Option.none(),
  maybeFinishedAt: Option.none(),
  pings: [],
})

// LOBBY

const touch = (room: Room, now: number): Room =>
  modifyFields(room, {
    lastMoveAt: () => now,
    maybeWarnedAt: () => Option.none(),
  })

const modifySeat = (
  room: Room,
  seatIndex: number,
  modify: (seat: RoomSeat) => RoomSeat,
): Room =>
  modifyFields(room, {
    seats: seats =>
      Array.map(seats, (seat, index) => (index === seatIndex ? modify(seat) : seat)),
  })

const joinLobby = (
  room: Room,
  deviceId: string,
  rawName: string,
  tone: number,
): RoomResult => {
  if (room.phase !== 'Lobby') {
    return reject('This game already started.')
  }
  if (!isValidTone(tone)) {
    return reject('Pick one of the colours.')
  }
  return Option.match(cleanName(rawName), {
    onNone: () => reject('Enter a name first.'),
    onSome: name => {
      const maybeSeat = seatIndexOf(room, deviceId)
      if (isToneTaken(room.seats, tone, maybeSeat)) {
        return reject('Someone already took that colour.')
      }
      return Option.match(maybeSeat, {
        onSome: seatIndex =>
          accept(
            modifySeat(room, seatIndex, seat =>
              modifyFields(seat, { name: () => name, tone: () => tone }),
            ),
          ),
        onNone: () =>
          room.seats.length >= MAX_SEATS
            ? reject('This lobby is full.')
            : accept(
                modifyFields(room, {
                  seats: seats =>
                    Array.append(seats, {
                      name,
                      tone,
                      kind: 'Human',
                      maybeDeviceId: Option.some(deviceId),
                      isReady: true,
                      hasLeft: false,
                    }),
                }),
              ),
      })
    },
  })
}

const changeTone = (room: Room, deviceId: string, tone: number): RoomResult => {
  if (!isLobbyPhase(room)) {
    return reject('Colours are set once the game starts.')
  }
  if (!isValidTone(tone)) {
    return reject('Pick one of the colours.')
  }
  return Option.match(seatIndexOf(room, deviceId), {
    onNone: () => reject('Join the lobby first.'),
    onSome: seatIndex =>
      isToneTaken(room.seats, tone, Option.some(seatIndex))
        ? reject('Someone already took that colour.')
        : accept(
            modifySeat(room, seatIndex, seat =>
              modifyFields(seat, { tone: () => tone }),
            ),
          ),
  })
}

const addBot = (room: Room, deviceId: string): RoomResult => {
  if (!isLobbyPhase(room)) {
    return reject('Bots can only join before the game starts.')
  }
  if (!isHost(room, deviceId)) {
    return reject('Only the host can add bots.')
  }
  if (room.seats.length >= MAX_SEATS) {
    return reject(`A table seats ${MAX_SEATS} at most.`)
  }
  const name = pipe(
    BOT_NAMES,
    Array.findFirst(
      candidate => !Array.some(room.seats, seat => seat.name === candidate),
    ),
    Option.getOrElse(() => `Bot ${room.seats.length}`),
  )
  return accept(
    modifyFields(room, {
      seats: seats =>
        Array.append(seats, {
          name,
          tone: firstFreeTone(seats),
          kind: 'Bot',
          maybeDeviceId: Option.none(),
          isReady: true,
          hasLeft: false,
        }),
    }),
  )
}

const removeSeatAt = (room: Room, seatIndex: number): Room =>
  modifyFields(room, { seats: seats => Array.remove(seats, seatIndex) })

const passHostOrClose = (room: Room): Room =>
  Option.match(
    Array.findFirst(
      room.seats,
      seat => seat.kind === 'Human' && Option.isSome(seat.maybeDeviceId),
    ),
    {
      onNone: () => room,
      onSome: seat =>
        modifyFields(room, {
          hostDeviceId: () =>
            Option.getOrElse(seat.maybeDeviceId, () => room.hostDeviceId),
        }),
    },
  )

const removeSeat = (
  room: Room,
  deviceId: string,
  seatIndex: number,
): RoomResult => {
  if (!isLobbyPhase(room)) {
    return reject('Seats are locked once the game starts.')
  }
  if (!isHost(room, deviceId)) {
    return reject('Only the host can remove players.')
  }
  return Option.match(Array.get(room.seats, seatIndex), {
    onNone: () => reject('That seat is already empty.'),
    onSome: seat =>
      Option.contains(seat.maybeDeviceId, deviceId)
        ? reject('Use Leave to give up your own seat.')
        : accept(removeSeatAt(room, seatIndex)),
  })
}

const leaveLobby = (room: Room, deviceId: string): RoomResult =>
  Option.match(seatIndexOf(room, deviceId), {
    onNone: () => reject('You are not in this lobby.'),
    onSome: seatIndex => accept(passHostOrClose(removeSeatAt(room, seatIndex))),
  })

export const hasHumans = (room: Room): boolean =>
  Array.isReadonlyArrayNonEmpty(humanDeviceIds(room))

// START

const seatConfigs = (seats: ReadonlyArray<RoomSeat>): ReadonlyArray<SeatConfig> =>
  Array.map(seats, seat => ({ name: seat.name, kind: seat.kind, tone: seat.tone }))

const startGame = (
  room: Room,
  deviceId: string,
  seed: number,
): RoomResult => {
  if (!isLobbyPhase(room)) {
    return reject('This game already started.')
  }
  if (!isHost(room, deviceId)) {
    return reject('Only the host can start the game.')
  }
  const seats =
    room.phase === 'RematchLobby'
      ? Array.filter(room.seats, seat => seat.isReady)
      : room.seats
  if (seats.length < MIN_SEATS) {
    return reject(`You need at least ${MIN_SEATS} ready seats to start.`)
  }
  return accept(
    modifyFields(room, {
      phase: () => 'Playing',
      seats: () => Array.map(seats, seat => modifyFields(seat, { isReady: () => false })),
      generation: generation =>
        room.phase === 'RematchLobby' ? generation + 1 : generation,
      maybeGame: () => Option.some(newGame(seed, seatConfigs(seats))),
      maybeFinishedAt: () => Option.none(),
      pings: () => [],
    }),
  )
}

// PLAY

const withGame = (room: Room, game: Model, now: number): Room =>
  modifyFields(room, {
    maybeGame: () => Option.some(game),
    phase: () => (game.phase._tag === 'GameOver' ? 'Finished' : room.phase),
    maybeFinishedAt: maybeFinishedAt =>
      game.phase._tag === 'GameOver' && Option.isNone(maybeFinishedAt)
        ? Option.some(now)
        : maybeFinishedAt,
  })

const takeAction = (
  room: Room,
  deviceId: string,
  message: Extract<ClientMessage, { _tag: 'TakeAction' }>,
  now: number,
): RoomResult => {
  if (room.phase !== 'Playing') {
    return reject('The game is not in progress.')
  }
  return Option.match(room.maybeGame, {
    onNone: () => reject('The game is not in progress.'),
    onSome: game =>
      Option.match(activeSeatIndexOf(room, deviceId), {
        onNone: () => reject('You don’t have a seat in this game.'),
        onSome: seatIndex =>
          Result.map(actAs(game, seatIndex, message.action), next =>
            touch(withGame(room, next, now), now),
          ),
      }),
  })
}

export type MessageContext = Readonly<{ now: number; seed: number }>

export const applyClientMessage = (
  room: Room,
  deviceId: string,
  message: ClientMessage,
  context: MessageContext,
): RoomResult =>
  pipe(
    ClientMessageUnion.match<RoomResult>(message, {
      JoinLobby: ({ name, tone }) => joinLobby(room, deviceId, name, tone),
      ChangeTone: ({ tone }) => changeTone(room, deviceId, tone),
      AddBot: () => addBot(room, deviceId),
      RemoveSeat: ({ seatIndex }) => removeSeat(room, deviceId, seatIndex),
      StartGame: () => startGame(room, deviceId, context.seed),
      TakeAction: action => takeAction(room, deviceId, action, context.now),
      Ping: () => reject('Pings aren’t available yet.'),
      LeaveGame: () =>
        isLobbyPhase(room)
          ? leaveLobby(room, deviceId)
          : reject('Leaving a game in progress isn’t available yet.'),
      MarkReady: () => reject('There is no rematch to get ready for.'),
      OpenRematch: () => reject('Rematches aren’t available yet.'),
    }),
    Result.map(next =>
      message._tag === 'TakeAction' ? next : touch(next, context.now),
    ),
  )

// SNAPSHOT

const lobbySeats = (room: Room, deviceId: string): ReadonlyArray<LobbySeat> =>
  Array.map(room.seats, (seat, seatIndex) => ({
    seatIndex,
    name: seat.name,
    tone: seat.tone,
    kind: seat.kind,
    isYou: Option.contains(seat.maybeDeviceId, deviceId),
    isHost: Option.contains(seat.maybeDeviceId, room.hostDeviceId),
    isReady: seat.isReady,
  }))

export const snapshotFor = (room: Room, deviceId: string): GameSnapshot => {
  const maybeSeat = seatIndexOf(room, deviceId)
  const isSeated = Option.isSome(maybeSeat)
  if (isLobbyPhase(room)) {
    return room.phase === 'RematchLobby' && !isSeated
      ? GameSnapshot.Closed({
          code: room.code,
          reason: 'This game already started.',
        })
      : GameSnapshot.Lobby({
          code: room.code,
          seats: lobbySeats(room, deviceId),
          isRematch: room.phase === 'RematchLobby',
          isViewerSeated: isSeated,
          isViewerHost: isHost(room, deviceId),
        })
  }
  return Option.match(maybeSeat, {
    onNone: () =>
      GameSnapshot.Closed({
        code: room.code,
        reason: 'This game already started.',
      }),
    onSome: seatIndex =>
      room.seats[seatIndex]?.hasLeft
        ? GameSnapshot.Closed({ code: room.code, reason: 'You left this game.' })
        : Option.match(room.maybeGame, {
            onNone: () =>
              GameSnapshot.Closed({
                code: room.code,
                reason: 'This game already started.',
              }),
            onSome: game =>
              GameSnapshot.Table({
                code: room.code,
                view: projectView(game, seatIndex),
                maybePingAvailableAt: Option.none(),
                canPing: false,
              }),
          }),
  })
}
