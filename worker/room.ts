import { Array, Option, Result, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { playBotStep } from '../src/domain/bot'
import { projectView } from '../src/domain/clientView'
import {
  BOT_NAMES,
  actAs,
  handOffToBot,
  isBotTurn,
  maybeTurnStep,
  newGame,
} from '../src/domain/game'
import { seatResult, type SeatResult } from '../src/domain/results'
import {
  MAX_SEATS,
  MIN_SEATS,
  Model,
  type SeatConfig,
  TONE_COUNT,
} from '../src/model'
import {
  type ClientMessage,
  ClientMessage as ClientMessageUnion,
  GameSnapshot,
  type LobbySeat,
  type MenuEntry,
  type MenuStatus,
  NAME_MAX_LENGTH,
  PING_COOLDOWN_MS,
  type PushNotice,
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

export const seatIndexOf = (
  room: Room,
  deviceId: string,
): Option.Option<number> =>
  Array.findFirstIndex(room.seats, seat =>
    Option.contains(seat.maybeDeviceId, deviceId),
  )

export const activeSeatIndexOf = (
  room: Room,
  deviceId: string,
): Option.Option<number> =>
  Option.filter(
    seatIndexOf(room, deviceId),
    seatIndex => room.seats[seatIndex]?.hasLeft === false,
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
      Array.map(seats, (seat, index) =>
        index === seatIndex ? modify(seat) : seat,
      ),
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

const seatConfigs = (
  seats: ReadonlyArray<RoomSeat>,
): ReadonlyArray<SeatConfig> =>
  Array.map(seats, seat => ({
    name: seat.name,
    kind: seat.kind,
    tone: seat.tone,
  }))

const startGame = (room: Room, deviceId: string, seed: number): RoomResult => {
  if (!isLobbyPhase(room)) {
    return reject('This game already started.')
  }
  if (!isHost(room, deviceId)) {
    return reject('Only the host can start the game.')
  }
  const seats =
    room.phase === 'RematchLobby'
      ? Array.filter(
          room.seats,
          seat =>
            seat.isReady ||
            Option.contains(seat.maybeDeviceId, room.hostDeviceId),
        )
      : room.seats
  if (seats.length < MIN_SEATS) {
    return reject(`You need at least ${MIN_SEATS} ready seats to start.`)
  }
  return accept(
    modifyFields(room, {
      phase: () => 'Playing',
      seats: () =>
        Array.map(seats, seat => modifyFields(seat, { isReady: () => false })),
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

// PING

// NOTE: When this device may next ping, if pinging makes sense at all: the
// game is in progress, the device has a seat, and the turn belongs to some
// other person (not a bot) who is still in the game.
export const pingAvailableAt = (
  room: Room,
  deviceId: string,
): Option.Option<number> => {
  if (room.phase !== 'Playing') {
    return Option.none()
  }
  return Option.flatMap(activeSeatIndexOf(room, deviceId), seatIndex =>
    Option.flatMap(room.maybeGame, game => {
      const target = room.seats[game.currentPlayerIndex]
      const isPingable =
        game.currentPlayerIndex !== seatIndex &&
        target !== undefined &&
        target.kind === 'Human' &&
        !target.hasLeft
      return isPingable
        ? Option.some(
            Option.match(
              Array.findFirst(
                room.pings,
                record => record.deviceId === deviceId,
              ),
              {
                onNone: () => 0,
                onSome: record => record.at + PING_COOLDOWN_MS,
              },
            ),
          )
        : Option.none()
    }),
  )
}

export const pingTarget = (room: Room): Option.Option<string> =>
  Option.flatMap(room.maybeGame, game =>
    Option.flatMap(
      Array.get(room.seats, game.currentPlayerIndex),
      seat => seat.maybeDeviceId,
    ),
  )

const ping = (room: Room, deviceId: string, now: number): RoomResult =>
  Option.match(pingAvailableAt(room, deviceId), {
    onNone: () => reject('There is nobody to ping right now.'),
    onSome: availableAt =>
      now < availableAt
        ? reject(
            `You can ping again in ${Math.ceil((availableAt - now) / 60_000)} minutes.`,
          )
        : accept(
            modifyFields(room, {
              pings: pings =>
                Array.append(
                  Array.filter(pings, record => record.deviceId !== deviceId),
                  { deviceId, at: now },
                ),
            }),
          ),
  })

// REMOVE FROM THE MENU

// NOTE: What deleting a game from your list does to the game itself. The host
// closing a lobby deletes it for everyone. Anyone else seated in a lobby gives
// up their seat, and a player in a game in progress leaves it (a bot takes the
// seat). A finished game, or one you already left, is only taken off your list.
export const Removal = Schema.Literals([
  'CloseLobby',
  'LeaveLobby',
  'LeaveGame',
  'Forget',
])
export type Removal = typeof Removal.Type

export const removalFor = (room: Room, deviceId: string): Removal => {
  if (isLobbyPhase(room)) {
    if (isHost(room, deviceId)) {
      return 'CloseLobby'
    }
    return Option.isSome(seatIndexOf(room, deviceId)) ? 'LeaveLobby' : 'Forget'
  }
  return room.phase === 'Playing' &&
    Option.isSome(activeSeatIndexOf(room, deviceId))
    ? 'LeaveGame'
    : 'Forget'
}

// LEAVE AND REMATCH

// NOTE: Leaving a game in progress hands the seat to a bot (see
// handOffToBot). The seat keeps its device so the menu can say "Left", but
// hasLeft shuts that device out of moves, pings and pushes.
const leaveGame = (room: Room, deviceId: string): RoomResult => {
  if (room.phase === 'Finished') {
    return reject('This game is over. Head back to the menu instead.')
  }
  return Option.match(activeSeatIndexOf(room, deviceId), {
    onNone: () => reject('You don’t have a seat in this game.'),
    onSome: seatIndex =>
      Option.match(room.maybeGame, {
        onNone: () => reject('The game is not in progress.'),
        onSome: game =>
          accept(
            passHostIfLeft(
              modifyFields(
                modifySeat(room, seatIndex, seat =>
                  modifyFields(seat, {
                    kind: () => 'Bot' as const,
                    hasLeft: () => true,
                  }),
                ),
                {
                  maybeGame: () => Option.some(handOffToBot(game, seatIndex)),
                  pings: pings =>
                    Array.filter(pings, record => record.deviceId !== deviceId),
                },
              ),
            ),
          ),
      }),
  })
}

// NOTE: The host role follows the first person still at the table.
const passHostIfLeft = (room: Room): Room =>
  Array.contains(humanDeviceIds(room), room.hostDeviceId)
    ? room
    : Option.match(Array.head(humanDeviceIds(room)), {
        onNone: () => room,
        onSome: deviceId =>
          modifyFields(room, { hostDeviceId: () => deviceId }),
      })

// NOTE: Rematch turns the finished game back into a lobby with the same
// seats. Seats whose player left stay as bots (and drop the old device), the
// person who opened it is ready, everyone else taps Ready.
const openRematch = (room: Room, deviceId: string): RoomResult => {
  if (room.phase === 'RematchLobby') {
    return Option.isSome(activeSeatIndexOf(room, deviceId))
      ? accept(room)
      : reject('You weren’t in this game.')
  }
  if (room.phase !== 'Finished') {
    return reject('A rematch opens once the game is over.')
  }
  return Option.isNone(activeSeatIndexOf(room, deviceId))
    ? reject('Only players still in the game can start a rematch.')
    : accept(
        passHostIfLeft(
          modifyFields(room, {
            phase: () => 'RematchLobby' as const,
            seats: seats =>
              Array.map(seats, seat =>
                seat.hasLeft
                  ? modifyFields(seat, {
                      kind: () => 'Bot' as const,
                      hasLeft: () => false,
                      maybeDeviceId: () => Option.none(),
                      isReady: () => true,
                    })
                  : modifyFields(seat, {
                      isReady: () =>
                        seat.kind === 'Bot' ||
                        Option.contains(seat.maybeDeviceId, deviceId),
                    }),
              ),
            maybeWarnedAt: () => Option.none(),
            pings: () => [],
          }),
        ),
      )
}

const markReady = (
  room: Room,
  deviceId: string,
  isReady: boolean,
): RoomResult => {
  if (room.phase !== 'RematchLobby') {
    return reject('There is no rematch to get ready for.')
  }
  return Option.match(seatIndexOf(room, deviceId), {
    onNone: () => reject('You weren’t in this game.'),
    onSome: seatIndex =>
      accept(
        modifySeat(room, seatIndex, seat =>
          modifyFields(seat, { isReady: () => isReady }),
        ),
      ),
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
      Ping: () => ping(room, deviceId, context.now),
      LeaveGame: () =>
        isLobbyPhase(room)
          ? leaveLobby(room, deviceId)
          : leaveGame(room, deviceId),
      MarkReady: ({ isReady }) => markReady(room, deviceId, isReady),
      OpenRematch: () => openRematch(room, deviceId),
    }),
    Result.map(next =>
      message._tag === 'TakeAction' || message._tag === 'Ping'
        ? next
        : touch(next, context.now),
    ),
  )

// SNAPSHOT

const WATCHER_INDEX = -1

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
        ? GameSnapshot.Closed({
            code: room.code,
            reason: 'You left this game.',
          })
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
                maybePingAvailableAt: pingAvailableAt(room, deviceId),
                canPing: Option.isSome(pingAvailableAt(room, deviceId)),
              }),
          }),
  })
}

// NOTE: A table screen sees the room as an outsider would, whatever seat its
// device holds, so a phone can double as a watcher without leaking its hand.
export const watchSnapshotFor = (room: Room): GameSnapshot => {
  const lobby = () =>
    GameSnapshot.WatchLobby({
      code: room.code,
      seats: lobbySeats(room, ''),
      isRematch: room.phase === 'RematchLobby',
    })
  return isLobbyPhase(room)
    ? lobby()
    : Option.match(room.maybeGame, {
        onNone: lobby,
        onSome: game =>
          GameSnapshot.WatchTable({
            code: room.code,
            view: projectView(game, WATCHER_INDEX),
            revealedTickets:
              game.phase._tag === 'GameOver'
                ? Array.map(game.players, player => player.ticketIds)
                : [],
          }),
      })
}

// MENU

// NOTE: Every device that holds a seat, including seats that left, so the
// GameDO can keep each one's menu entry current.
export const seatedDeviceIds = (room: Room): ReadonlyArray<string> =>
  Array.getSomes(Array.map(room.seats, seat => seat.maybeDeviceId))

const menuStatus = (room: Room, seatIndex: number): MenuStatus => {
  if (room.seats[seatIndex]?.hasLeft === true) {
    return 'Left'
  }
  if (isLobbyPhase(room)) {
    return 'Lobby'
  }
  if (room.phase === 'Finished') {
    return 'Finished'
  }
  return Option.exists(room.maybeGame, game =>
    Option.contains(maybeTurnStep(game), 'ChoosingStartTickets')
      ? Option.exists(Array.get(game.players, seatIndex), player =>
          Array.isReadonlyArrayNonEmpty(player.offeredTicketIds),
        )
      : game.currentPlayerIndex === seatIndex,
  )
    ? 'YourTurn'
    : 'Waiting'
}

export const menuEntryFor = (
  room: Room,
  deviceId: string,
  maybePingAvailableAt: Option.Option<number>,
): Option.Option<MenuEntry> =>
  Option.map(seatIndexOf(room, deviceId), seatIndex => {
    const status = menuStatus(room, seatIndex)
    return {
      code: room.code,
      status,
      seatNames: Array.map(room.seats, seat => seat.name),
      maybeCurrentName:
        status === 'Waiting'
          ? Option.flatMap(room.maybeGame, game =>
              Option.map(
                Array.get(game.players, game.currentPlayerIndex),
                player => player.name,
              ),
            )
          : Option.none(),
      updatedAt: Option.getOrElse(room.maybeFinishedAt, () => room.lastMoveAt),
      maybeResult:
        status === 'Finished'
          ? Option.flatMap(room.maybeGame, game => seatResult(game, seatIndex))
          : Option.none(),
      maybeReason: Option.none(),
      maybePingAvailableAt:
        status === 'Waiting' ? maybePingAvailableAt : Option.none(),
    }
  })

export const resultKey = (room: Room): string =>
  `${room.code}#${room.generation}`

// NOTE: The results to record when a game has just finished, one per human
// still in it. Seats that left (now bots) don't count toward that person.
export const finishedResults = (
  before: Option.Option<Room>,
  after: Room,
): ReadonlyArray<readonly [string, SeatResult]> => {
  const justFinished =
    after.phase === 'Finished' &&
    !Option.exists(
      before,
      room => room.phase === 'Finished' && room.generation === after.generation,
    )
  if (!justFinished) {
    return []
  }
  return Option.match(after.maybeGame, {
    onNone: () => [],
    onSome: game =>
      Array.getSomes(
        Array.map(after.seats, (seat, seatIndex) =>
          seat.kind === 'Human' && !seat.hasLeft
            ? Option.flatMap(seat.maybeDeviceId, deviceId =>
                Option.map(
                  seatResult(game, seatIndex),
                  result => [deviceId, result] as const,
                ),
              )
            : Option.none(),
        ),
      ),
  })
}

// LIFECYCLE

const HOUR_MS = 60 * 60 * 1000
export const WARN_AFTER_MS = 48 * HOUR_MS
export const DELETE_AFTER_MS = 72 * HOUR_MS
export const FINISHED_TTL_MS = 7 * 24 * HOUR_MS

export const REASON_IDLE_GAME = 'Removed after 3 days with no moves.'
export const REASON_IDLE_LOBBY = 'Removed after 3 days without starting.'
export const REASON_FINISHED = 'Removed one week after it ended.'
export const REASON_EVERYONE_LEFT = 'Everyone left this game.'
export const REASON_HOST_CLOSED = 'The host closed this lobby.'

const isBotToMove = (room: Room): boolean =>
  room.phase === 'Playing' && Option.exists(room.maybeGame, isBotTurn)

// NOTE: One alarm covers everything time-based. It is always set to the
// earliest of: the next bot move, the 48-hour warning, 72-hour deletion, or
// one-week deletion of a finished game.
export const nextAlarmAt = (room: Room, botDelayMs: number): number => {
  if (room.phase === 'Finished') {
    return (
      Option.getOrElse(room.maybeFinishedAt, () => room.lastMoveAt) +
      FINISHED_TTL_MS
    )
  }
  const lifecycleAt = Option.isNone(room.maybeWarnedAt)
    ? room.lastMoveAt + WARN_AFTER_MS
    : room.lastMoveAt + DELETE_AFTER_MS
  return isBotToMove(room)
    ? Math.min(room.lastMoveAt + botDelayMs, lifecycleAt)
    : lifecycleAt
}

export const AlarmOutcome = defineTaggedUnion({
  Unchanged: {},
  Updated: { room: Room },
  Warned: { room: Room, deviceIds: Schema.Array(Schema.String) },
  Deleted: { reason: Schema.String },
})
export type AlarmOutcome = typeof AlarmOutcome.Type

// NOTE: Who hears about a game about to be deleted: the player whose turn it
// is, or the host while it is still a lobby.
const warnedDeviceIds = (room: Room): ReadonlyArray<string> => {
  if (room.phase === 'Playing') {
    return Option.match(
      Option.flatMap(room.maybeGame, game =>
        Array.get(room.seats, game.currentPlayerIndex),
      ),
      {
        onNone: () => [],
        onSome: seat =>
          seat.kind === 'Human' && !seat.hasLeft
            ? Option.toArray(seat.maybeDeviceId)
            : [],
      },
    )
  }
  return [room.hostDeviceId]
}

export const runAlarm = (
  room: Room,
  now: number,
  botDelayMs: number,
): AlarmOutcome => {
  if (room.phase === 'Finished') {
    const expiresAt =
      Option.getOrElse(room.maybeFinishedAt, () => room.lastMoveAt) +
      FINISHED_TTL_MS
    return now >= expiresAt
      ? AlarmOutcome.Deleted({ reason: REASON_FINISHED })
      : AlarmOutcome.Unchanged()
  }
  const isLobby = isLobbyPhase(room)
  if (now >= room.lastMoveAt + DELETE_AFTER_MS) {
    return AlarmOutcome.Deleted({
      reason: isLobby ? REASON_IDLE_LOBBY : REASON_IDLE_GAME,
    })
  }
  if (isBotToMove(room) && now >= room.lastMoveAt + botDelayMs) {
    return Option.match(room.maybeGame, {
      onNone: () => AlarmOutcome.Unchanged(),
      onSome: game =>
        AlarmOutcome.Updated({
          room: touch(withGame(room, playBotStep(game), now), now),
        }),
    })
  }
  if (
    now >= room.lastMoveAt + WARN_AFTER_MS &&
    Option.isNone(room.maybeWarnedAt)
  ) {
    return AlarmOutcome.Warned({
      room: modifyFields(room, { maybeWarnedAt: () => Option.some(now) }),
      deviceIds: warnedDeviceIds(room),
    })
  }
  return AlarmOutcome.Unchanged()
}

// PUSH

const gameUrl = (room: Room): string => `/g/${room.code}`

const currentHumanDevice = (room: Room): Option.Option<string> =>
  Option.flatMap(room.maybeGame, game =>
    Option.flatMap(Array.get(room.seats, game.currentPlayerIndex), seat =>
      seat.kind === 'Human' && !seat.hasLeft
        ? seat.maybeDeviceId
        : Option.none(),
    ),
  )

export const turnNotice = (room: Room): PushNotice => ({
  title: 'Your turn',
  body: `It’s your move in ${room.code}.`,
  url: gameUrl(room),
  tag: `turn-${room.code}`,
})

export const pingNotice = (room: Room, fromName: string): PushNotice => ({
  title: `${fromName} pinged you`,
  body: `They’re waiting on your move in ${room.code}.`,
  url: gameUrl(room),
  tag: `ping-${room.code}`,
})

export const warningNotice = (room: Room): PushNotice => ({
  title: 'Game about to be deleted',
  body: isLobbyPhase(room)
    ? `${room.code} hasn’t started and will be deleted in 24 hours.`
    : `Nobody has moved in ${room.code} for 2 days. It will be deleted in 24 hours.`,
  url: gameUrl(room),
  tag: `warning-${room.code}`,
})

export const finalScoresNotice = (room: Room): Option.Option<PushNotice> =>
  Option.flatMap(room.maybeGame, game =>
    game.phase._tag === 'GameOver'
      ? Option.some({
          title: `Final scores · ${room.code}`,
          body: Array.map(
            game.phase.standings,
            standing =>
              `${game.players[standing.playerIndex]?.name ?? '?'} ${standing.total}`,
          ).join(' · '),
          url: gameUrl(room),
          tag: `final-${room.code}`,
        })
      : Option.none(),
  )

// NOTE: The pushes one change causes. "Your turn" goes to the person the turn
// just passed to. Final scores go to every person still in the game. Devices
// that left the game never appear here.
export const pushesForChange = (
  maybeBefore: Option.Option<Room>,
  after: Room,
): ReadonlyArray<readonly [string, PushNotice]> => {
  const turnPassed =
    after.phase === 'Playing' &&
    !Option.exists(
      maybeBefore,
      before =>
        before.phase === 'Playing' &&
        before.generation === after.generation &&
        Option.exists(before.maybeGame, beforeGame =>
          Option.exists(
            after.maybeGame,
            afterGame =>
              afterGame.currentPlayerIndex === beforeGame.currentPlayerIndex,
          ),
        ),
    )
  const turnPushes = turnPassed
    ? Option.match(currentHumanDevice(after), {
        onNone: () => [],
        onSome: deviceId => [[deviceId, turnNotice(after)] as const],
      })
    : []
  const finalPushes = Array.isReadonlyArrayNonEmpty(
    finishedResults(maybeBefore, after),
  )
    ? Option.match(finalScoresNotice(after), {
        onNone: () => [],
        onSome: notice =>
          Array.map(
            humanDeviceIds(after),
            deviceId => [deviceId, notice] as const,
          ),
      })
    : []
  return [...turnPushes, ...finalPushes]
}
