import { exports as workerExports } from 'cloudflare:workers'
import { Array, Option } from 'effect'

import {
  type ClientView,
  canDrawFromDeck,
  canTakeMarketCard,
  isViewerTurn,
  marketCardAt,
  maybeTurnStep,
  maybeViewerPayment,
  viewerHasAnyMove,
} from '../src/domain/clientView'
import { ROUTES } from '../src/domain/board'
import { PlayerAction } from '../src/domain/game'
import {
  type ClientMessage,
  ClientMessage as ClientMessages,
  type GameSnapshot,
  type Menu,
  type ServerMessage,
  decodeMenu,
  decodeServerMessage,
  encodeClientMessage,
} from '../src/protocol'

// NOTE: `exports` is typed from generated wrangler types; this project keeps
// them out of git, so name the one entry point the tests use.
const worker = (workerExports as unknown as { default: Fetcher }).default

// NOTE: A scripted stand-in for the app: it authenticates like a device,
// opens the game's WebSocket through the Worker, and records every message.

export type Device = Readonly<{ deviceId: string; secret: string }>

export const makeDevice = (label: string): Device => ({
  deviceId: `device-${label}-${crypto.randomUUID().slice(0, 12)}`,
  secret: `secret-${crypto.randomUUID()}`,
})

export const authHeaders = (device: Device): Record<string, string> => ({
  'x-device-id': device.deviceId,
  'x-device-secret': device.secret,
})

export const api = (
  device: Device,
  path: string,
  init: RequestInit = {},
): Promise<Response> =>
  worker.fetch(
    new Request(`http://local${path}`, {
      ...init,
      headers: { ...authHeaders(device), 'content-type': 'application/json' },
    }),
  )

export const createGame = async (device: Device, name: string): Promise<string> => {
  const response = await api(device, '/api/games', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  if (response.status !== 201) {
    throw new Error(`create failed: ${response.status} ${await response.text()}`)
  }
  const body: { code: string } = await response.json()
  return body.code
}

export type TestClient = Readonly<{
  device: Device
  messages: Array<ServerMessage>
  send: (message: ClientMessage) => void
  latest: () => GameSnapshot
  waitFor: (
    predicate: (message: ServerMessage) => boolean,
    label?: string,
  ) => Promise<ServerMessage>
  close: () => void
}>

export const connect = async (device: Device, code: string): Promise<TestClient> => {
  const response = await worker.fetch(
    new Request(
      `http://local/api/games/${code}/ws?device=${device.deviceId}&secret=${device.secret}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  )
  const socket = response.webSocket
  if (socket === null) {
    throw new Error(`no websocket: ${response.status} ${await response.text()}`)
  }
  socket.accept()
  const messages: Array<ServerMessage> = []
  const waiters: Array<{
    from: number
    predicate: (message: ServerMessage) => boolean
    resolve: (message: ServerMessage) => void
  }> = []
  const settle = () => {
    waiters.slice().forEach(waiter => {
      const found = messages
        .slice(waiter.from)
        .find(message => waiter.predicate(message))
      if (found !== undefined) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(found)
      }
    })
  }
  socket.addEventListener('message', (event: MessageEvent) => {
    Option.match(decodeServerMessage(String(event.data)), {
      onNone: () => undefined,
      onSome: message => {
        messages.push(message)
        settle()
      },
    })
  })
  const client: TestClient = {
    device,
    messages,
    send: message => socket.send(encodeClientMessage(message)),
    latest: () => {
      const snapshots = messages.flatMap(message =>
        message._tag === 'Snapshot' ? [message.snapshot] : [],
      )
      const last = snapshots[snapshots.length - 1]
      if (last === undefined) {
        throw new Error('no snapshot yet')
      }
      return last
    },
    waitFor: (predicate, label = 'message') =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${label}`)),
          10_000,
        )
        waiters.push({
          from: 0,
          predicate,
          resolve: message => {
            clearTimeout(timer)
            resolve(message)
          },
        })
        settle()
      }),
    close: () => socket.close(1000, 'done'),
  }
  await client.waitFor(message => message._tag === 'Snapshot', 'first snapshot')
  return client
}

export const nextMessage = (client: TestClient, label = 'next message') => {
  const seen = client.messages.length
  return new Promise<ServerMessage>((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      const message = client.messages[seen]
      if (message !== undefined) {
        resolve(message)
      } else if (Date.now() - started > 10_000) {
        reject(new Error(`timed out waiting for ${label}`))
      } else {
        setTimeout(poll, 2)
      }
    }
    poll()
  })
}

export const tableView = (snapshot: GameSnapshot): Option.Option<ClientView> =>
  snapshot._tag === 'Table' ? Option.some(snapshot.view) : Option.none()

// NOTE: A simple greedy player that only uses what its own ClientView shows.
export const chooseAction = (view: ClientView): PlayerAction => {
  const step = Option.getOrElse(maybeTurnStep(view), () => 'ChoosingAction' as const)
  const slots = Array.range(0, 4)
  const maybeSlot = Array.findFirst(slots, slot =>
    canTakeMarketCard(view, slot, step) &&
    !Option.contains(marketCardAt(view, slot), 'Wild'),
  )
  if (step === 'DrawingSecondCard') {
    return canDrawFromDeck(view)
      ? PlayerAction.DrewFromDeck()
      : Option.match(maybeSlot, {
          onNone: () => PlayerAction.Passed(),
          onSome: slot => PlayerAction.TookMarketCard({ slot }),
        })
  }
  const maybeRoute = Array.findFirst(ROUTES, route =>
    Option.isSome(maybeViewerPayment(view, route.id)),
  )
  return Option.match(maybeRoute, {
    onSome: route => PlayerAction.ClaimedRoute({ routeId: route.id }),
    onNone: () =>
      canDrawFromDeck(view)
        ? PlayerAction.DrewFromDeck()
        : Option.isSome(maybeSlot)
          ? PlayerAction.TookMarketCard({ slot: maybeSlot.value })
          : view.ticketPileCount > 0
            ? PlayerAction.DrewTicket()
            : viewerHasAnyMove(view)
              ? PlayerAction.TookMarketCard({ slot: 0 })
              : PlayerAction.Passed(),
  })
}

export { isViewerTurn }

export const fetchMenu = async (device: Device): Promise<Menu> => {
  const response = await api(device, '/api/me')
  return Option.getOrThrow(decodeMenu(await response.text()))
}

// NOTE: Opens a lobby, seats a guest, and starts the game.
export const startFriendGame = async (
  hostName = 'Ada',
  guestName = 'Bea',
): Promise<
  Readonly<{ code: string; host: TestClient; guest: TestClient }>
> => {
  const hostDevice = makeDevice('host')
  const code = await createGame(hostDevice, hostName)
  const host = await connect(hostDevice, code)
  const guest = await connect(makeDevice('guest'), code)
  guest.send(ClientMessages.JoinLobby({ name: guestName, tone: 1 }))
  await host.waitFor(
    m =>
      m._tag === 'Snapshot' &&
      m.snapshot._tag === 'Lobby' &&
      m.snapshot.seats.length === 2,
    'guest seated',
  )
  host.send(ClientMessages.StartGame())
  await Promise.all(
    [host, guest].map(client =>
      client.waitFor(
        m => m._tag === 'Snapshot' && m.snapshot._tag === 'Table',
        'table',
      ),
    ),
  )
  return { code, host, guest }
}

// NOTE: Plays greedy moves for whichever client is to move until game over.
export const playUntilOver = async (
  clients: ReadonlyArray<TestClient>,
): Promise<number> => {
  const step = async (moves: number): Promise<number> => {
    if (moves > 2000) {
      throw new Error('game did not finish')
    }
    const views = Array.getSomes(
      Array.map(clients, client => tableView(client.latest())),
    )
    if (Array.some(views, view => view.phase._tag === 'GameOver')) {
      return moves
    }
    const maybeActor = Array.findFirst(clients, client =>
      Option.exists(tableView(client.latest()), isViewerTurn),
    )
    if (Option.isNone(maybeActor)) {
      await new Promise(resolve => setTimeout(resolve, 5))
      return step(moves)
    }
    const actor = maybeActor.value
    const view = Option.getOrThrow(tableView(actor.latest()))
    const reply = nextMessage(actor, 'reply to action')
    actor.send(ClientMessages.TakeAction({ action: chooseAction(view) }))
    if ((await reply)._tag === 'Rejected') {
      const fallback = nextMessage(actor, 'reply to pass')
      actor.send(ClientMessages.TakeAction({ action: PlayerAction.Passed() }))
      await fallback
    }
    return step(moves + 1)
  }
  return step(0)
}
