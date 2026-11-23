import { Option, Schema } from 'effect'

import {
  CreateGameRequest,
  DEVICE_ID_HEADER,
  DEVICE_ID_PATTERN,
  DEVICE_SECRET_HEADER,
  GameSnapshot,
  LocalResultsRequest,
  PushSubscriptionRequest,
  decodeGameSnapshot,
  encodeGameSnapshot,
  encodeSeatResult,
  isValidCode,
  normalizeCode,
} from '../src/protocol'
import type { Env } from './env'
import {
  GAME_CODE_HEADER,
  GONE_REASON_HEADER,
  VERIFIED_DEVICE_HEADER,
  WATCHER_HEADER,
} from './gameDO'
import { readTombstone } from './tombstone'

export { GameDO } from './gameDO'
export { PlayerDO } from './playerDO'

// NOTE: The Worker routes /api/* and serves the built app for everything else.
// It authenticates each device against its PlayerDO, then forwards to the
// GameDO with the verified device ID in a header the client cannot set.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 3
const CODE_ATTEMPTS = 12

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const fail = (status: number, reason: string): Response =>
  json({ reason }, status)

const randomCode = (): string => {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  const suffix = [...bytes]
    .map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('')
  return `TRAIN-${suffix}`
}

type Credentials = Readonly<{ deviceId: string; secret: string }>

const credentialsFrom = (
  request: Request,
  url: URL,
): Option.Option<Credentials> => {
  const deviceId =
    request.headers.get(DEVICE_ID_HEADER) ?? url.searchParams.get('device')
  const secret =
    request.headers.get(DEVICE_SECRET_HEADER) ?? url.searchParams.get('secret')
  return deviceId !== null &&
    secret !== null &&
    DEVICE_ID_PATTERN.test(deviceId)
    ? Option.some({ deviceId, secret })
    : Option.none()
}

const authenticate = async (
  env: Env,
  request: Request,
  url: URL,
): Promise<Option.Option<string>> =>
  Option.match(credentialsFrom(request, url), {
    onNone: async () => Option.none<string>(),
    onSome: async ({ deviceId, secret }) =>
      (await env.PLAYERS.getByName(deviceId).authenticate(secret))
        ? Option.some(deviceId)
        : Option.none<string>(),
  })

const readJson = async <A>(
  request: Request,
  schema: Schema.Codec<A, unknown>,
): Promise<Option.Option<A>> => {
  try {
    return Schema.decodeUnknownOption(schema)(await request.json())
  } catch {
    return Option.none()
  }
}

const createGame = async (env: Env, request: Request, deviceId: string) => {
  const maybeBody = await readJson(request, CreateGameRequest)
  if (Option.isNone(maybeBody)) {
    return fail(400, 'Send a name for the host.')
  }
  const attempt = async (attemptsLeft: number): Promise<Response> => {
    if (attemptsLeft === 0) {
      return fail(503, 'Couldn’t find a free invite code. Try again.')
    }
    const code = randomCode()
    if (Option.isSome(await readTombstone(env, code))) {
      return attempt(attemptsLeft - 1)
    }
    const isCreated = await env.GAMES.getByName(code).create(
      code,
      deviceId,
      maybeBody.value.name,
    )
    return isCreated ? json({ code }, 201) : attempt(attemptsLeft - 1)
  }
  return attempt(CODE_ATTEMPTS)
}

const gameSnapshot = async (env: Env, code: string, deviceId: string) => {
  const raw = await env.GAMES.getByName(code).snapshotJson(code, deviceId)
  const snapshot = Option.getOrElse(decodeGameSnapshot(raw), () =>
    GameSnapshot.Gone({ code, reason: 'This game doesn’t exist.' }),
  )
  const answer =
    snapshot._tag === 'Gone'
      ? Option.match(await readTombstone(env, code), {
          onNone: () => snapshot,
          onSome: tombstone =>
            GameSnapshot.Gone({ code, reason: tombstone.reason }),
        })
      : snapshot
  return new Response(encodeGameSnapshot(answer), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

const connectToGame = async (
  env: Env,
  request: Request,
  code: string,
  deviceId: string,
) => {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return fail(426, 'Expected a WebSocket upgrade.')
  }
  const headers = new Headers(request.headers)
  headers.delete(DEVICE_SECRET_HEADER)
  headers.set(VERIFIED_DEVICE_HEADER, deviceId)
  headers.set(GAME_CODE_HEADER, code)
  headers.set(
    WATCHER_HEADER,
    new URL(request.url).searchParams.get('watch') === '1' ? '1' : '0',
  )
  const stub = env.GAMES.getByName(code)
  if (!(await stub.exists())) {
    const tombstone = await readTombstone(env, code)
    headers.set(
      GONE_REASON_HEADER,
      Option.match(tombstone, {
        onNone: () => 'This game doesn’t exist.',
        onSome: ({ reason }) => reason,
      }),
    )
  }
  return stub.fetch(new Request('https://game.internal/ws', { headers }))
}

const jsonText = (text: string): Response =>
  new Response(text, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })

const menu = async (env: Env, deviceId: string): Promise<Response> =>
  jsonText(await env.PLAYERS.getByName(deviceId).menuJson(Date.now()))

const LOCAL_RESULT_ID = /^local-[A-Za-z0-9_-]{6,64}$/
const MAX_RESULTS_PER_POST = 50

const postLocalResults = async (
  env: Env,
  request: Request,
  deviceId: string,
): Promise<Response> => {
  const maybeBody = await readJson(request, LocalResultsRequest)
  if (Option.isNone(maybeBody)) {
    return fail(400, 'Send a list of results.')
  }
  const results = maybeBody.value.results
    .filter(({ id }) => LOCAL_RESULT_ID.test(id))
    .slice(0, MAX_RESULTS_PER_POST)
  const player = env.PLAYERS.getByName(deviceId)
  const recorded = await Promise.all(
    results.map(({ id, result }) =>
      player.recordResult(`${deviceId}:${id}`, encodeSeatResult(result)),
    ),
  )
  return json({
    accepted: results.map(({ id }) => id),
    recorded: recorded.filter(Boolean).length,
  })
}

const subscribePush = async (
  env: Env,
  request: Request,
  deviceId: string,
): Promise<Response> => {
  const maybeBody = await readJson(request, PushSubscriptionRequest)
  if (Option.isNone(maybeBody)) {
    return fail(400, 'Send a push subscription.')
  }
  const { endpoint, keys } = maybeBody.value
  if (!endpoint.startsWith('https://')) {
    return fail(400, 'Push endpoints must use https.')
  }
  const player = env.PLAYERS.getByName(deviceId)
  if (request.method === 'DELETE') {
    await player.removeSubscription(endpoint)
  } else {
    await player.addSubscription(endpoint, keys.p256dh, keys.auth)
  }
  return json({ ok: true })
}

const pingGame = async (env: Env, code: string, deviceId: string) => {
  const maybeReason = await env.GAMES.getByName(code).pingFrom(deviceId)
  return maybeReason === null ? json({ ok: true }) : fail(409, maybeReason)
}

// NOTE: Deletes a game from this device's list, and does whatever that means
// for the game itself (see removalFor). A lobby you closed or left no longer
// seats you, so it can simply be dropped; any other game would send updates
// for your old seat, so it is forgotten instead.
const deleteGame = async (env: Env, code: string, deviceId: string) => {
  const game = env.GAMES.getByName(code)
  const removal = (await game.exists())
    ? await game.removeFor(deviceId)
    : 'Forget'
  const player = env.PLAYERS.getByName(deviceId)
  await (removal === 'CloseLobby' || removal === 'LeaveLobby'
    ? player.removeGame(code)
    : player.forgetGame(code, Date.now()))
  return json({ ok: true })
}

const GAME_PATH = /^\/api\/games\/([^/]+)(\/ws|\/ping)?$/

export const route = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) {
    return env.ASSETS === undefined
      ? fail(404, 'Not found.')
      : env.ASSETS.fetch(request)
  }

  if (url.pathname === '/api/push-key') {
    return env.VAPID_PUBLIC_KEY === undefined
      ? fail(503, 'Push isn’t set up on this server.')
      : json({ publicKey: env.VAPID_PUBLIC_KEY })
  }

  const maybeDeviceId = await authenticate(env, request, url)
  if (Option.isNone(maybeDeviceId)) {
    return fail(401, 'This device isn’t recognised.')
  }
  const deviceId = maybeDeviceId.value

  if (
    url.pathname === '/api/me/push' &&
    (request.method === 'POST' || request.method === 'DELETE')
  ) {
    return subscribePush(env, request, deviceId)
  }

  if (url.pathname === '/api/me' && request.method === 'GET') {
    return menu(env, deviceId)
  }

  if (url.pathname === '/api/me/results' && request.method === 'POST') {
    return postLocalResults(env, request, deviceId)
  }

  if (url.pathname === '/api/games' && request.method === 'POST') {
    return createGame(env, request, deviceId)
  }

  const gameMatch = GAME_PATH.exec(url.pathname)
  if (gameMatch !== null) {
    const code = normalizeCode(decodeURIComponent(gameMatch[1] ?? ''))
    if (!isValidCode(code)) {
      return fail(404, 'That invite code doesn’t look right.')
    }
    if (gameMatch[2] === '/ping') {
      return request.method === 'POST'
        ? pingGame(env, code, deviceId)
        : fail(405, 'Use POST.')
    }
    if (gameMatch[2] === undefined && request.method === 'DELETE') {
      return deleteGame(env, code, deviceId)
    }
    return gameMatch[2] === '/ws'
      ? connectToGame(env, request, code, deviceId)
      : gameSnapshot(env, code, deviceId)
  }

  return fail(404, 'Not found.')
}

export default {
  fetch: route,
} satisfies ExportedHandler<Env>
