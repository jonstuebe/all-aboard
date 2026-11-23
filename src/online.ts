import { Duration, Effect, Option, Queue, Schema, Stream } from 'effect'
import { Command, ManagedResource } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { Device, socketUrl } from './device'
import { Message } from './message'
import {
  type ClientMessage,
  ClientMessage as ClientMessageSchema,
  GameSnapshot,
  decodeServerMessage,
  encodeClientMessage,
} from './protocol'
import { TableUi, emptyTableUi } from './table'

// MODEL

export const Connection = defineTaggedUnion({
  Connecting: {},
  Open: {},
  Reconnecting: {},
})
export type Connection = typeof Connection.Type

export const OnlineGame = Schema.Struct({
  code: Schema.String,
  connection: Connection,
  attempt: Schema.Number,
  maybeSnapshot: Schema.Option(GameSnapshot),
  ui: TableUi,
  joinName: Schema.String,
  joinTone: Schema.Number,
  isPinging: Schema.Boolean,
})
export type OnlineGame = typeof OnlineGame.Type

export const openOnlineGame = (code: string, playerName: string): OnlineGame => ({
  code,
  connection: Connection.Connecting(),
  attempt: 0,
  maybeSnapshot: Option.none(),
  ui: emptyTableUi,
  joinName: playerName,
  joinTone: 0,
  isPinging: false,
})

export const withNotice = (
  game: OnlineGame,
  maybeNotice: Option.Option<string>,
): OnlineGame =>
  modifyFields(game, {
    ui: ui => modifyFields(ui, { maybeNotice: () => maybeNotice }),
  })

// NOTE: A Gone or Closed game never comes back, so there is no point holding
// a socket open (or reconnecting) once the server has said so.
export const wantsSocket = (game: OnlineGame): boolean =>
  !Option.exists(
    game.maybeSnapshot,
    snapshot => snapshot._tag === 'Gone' || snapshot._tag === 'Closed',
  )

// SOCKET

export const GameSocket = ManagedResource.tag<WebSocket>()('GameSocket')
export type GameSocketService = ManagedResource.ServiceOf<typeof GameSocket>

const CONNECT_TIMEOUT = Duration.seconds(8)
const RECONNECT_DELAY = Duration.seconds(2)

export const SocketRequirements = Schema.Option(
  Schema.Struct({ code: Schema.String, attempt: Schema.Number, device: Device }),
)

export const acquireGameSocket = ({
  code,
  device,
}: {
  code: string
  attempt: number
  device: Device
}) =>
  Effect.suspend(() =>
    Effect.callback<WebSocket, Error>(resume => {
      const socket = new WebSocket(socketUrl(device, code))
      const handleOpen = () => {
        socket.removeEventListener('error', handleError)
        resume(Effect.succeed(socket))
      }
      const handleError = () => {
        socket.removeEventListener('open', handleOpen)
        resume(Effect.fail(new Error('Couldn’t reach the game server.')))
      }
      socket.addEventListener('open', handleOpen)
      socket.addEventListener('error', handleError)
      return Effect.sync(() => {
        socket.removeEventListener('open', handleOpen)
        socket.removeEventListener('error', handleError)
      })
    }),
  ).pipe(
    Effect.timeout(CONNECT_TIMEOUT),
    Effect.catchTag('TimeoutError', () =>
      Effect.fail(new Error('Connecting to the game timed out.')),
    ),
  )

export const releaseGameSocket = (socket: WebSocket) =>
  Effect.sync(() => socket.close(1000, 'left'))

type SocketMessage =
  | typeof Message.ReceivedServerMessage.Type
  | typeof Message.DisconnectedGameSocket.Type

const streamSocketMessages = (socket: WebSocket) =>
  Stream.callback<SocketMessage>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const handleMessage = (event: MessageEvent) => {
          Option.match(decodeServerMessage(String(event.data)), {
            onNone: () => undefined,
            onSome: message => {
              Queue.offerUnsafe(queue, Message.ReceivedServerMessage({ message }))
            },
          })
        }
        const handleClose = () => {
          Queue.offerUnsafe(queue, Message.DisconnectedGameSocket())
          Queue.endUnsafe(queue)
        }
        socket.addEventListener('message', handleMessage)
        socket.addEventListener('close', handleClose)
        socket.addEventListener('error', handleClose)
        return { handleMessage, handleClose }
      }),
      ({ handleMessage, handleClose }) =>
        Effect.sync(() => {
          socket.removeEventListener('message', handleMessage)
          socket.removeEventListener('close', handleClose)
          socket.removeEventListener('error', handleClose)
        }),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

export const gameSocketStream = (isOpen: boolean) =>
  Stream.when(
    Stream.unwrap(
      GameSocket.get.pipe(
        Effect.map(streamSocketMessages),
        Effect.catchTag('ResourceNotAvailable', () => Effect.succeed(Stream.empty)),
      ),
    ),
    Effect.sync(() => isOpen),
  )

// COMMAND

export const SendClientMessage = Command.define('SendClientMessage', {
  args: { message: ClientMessageSchema },
  messages: [Message.CompletedSendClientMessage, Message.FailedSendClientMessage],
  execute: ({ message }) =>
    GameSocket.get.pipe(
      Effect.flatMap(socket =>
        Effect.try({
          try: () => {
            socket.send(encodeClientMessage(message))
            return Message.CompletedSendClientMessage()
          },
          catch: () => 'The connection dropped. Reconnecting…',
        }),
      ),
      Effect.catchTag('ResourceNotAvailable', () =>
        Effect.succeed(
          Message.FailedSendClientMessage({
            reason: 'Still connecting to the game. Try again in a moment.',
          }),
        ),
      ),
      Effect.catch(reason =>
        Effect.succeed(
          Message.FailedSendClientMessage({
            reason: typeof reason === 'string' ? reason : 'Couldn’t send that.',
          }),
        ),
      ),
    ),
})

export const WaitToReconnect = Command.define('WaitToReconnect', {
  args: { code: Schema.String, attempt: Schema.Number },
  messages: [Message.CompletedWaitToReconnect],
  execute: ({ code, attempt }) =>
    Effect.sleep(RECONNECT_DELAY).pipe(
      Effect.as(Message.CompletedWaitToReconnect({ code, attempt })),
    ),
})

export const sendToServer = (message: ClientMessage) =>
  SendClientMessage({ message })
