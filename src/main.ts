import {
  Clock,
  Duration,
  Effect,
  Match,
  Option,
  Random,
  Schema,
  Stream,
} from 'effect'
import {
  Command,
  Dom,
  ManagedResource,
  type Runtime,
  Subscription,
  type Update,
} from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { UrlRequest, load, pushUrl, replaceUrl } from 'foldkit/navigation'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { toString as urlToString } from 'foldkit/url'

import {
  Device,
  authHeaders,
  loadDevice,
  loadPlayerName,
  savePlayerName,
} from './device'
import {
  PlayerAction,
  clampSeatCount,
  isBotTurn,
  maybeTurnStep,
} from './domain/game'
import { seatResult } from './domain/results'
import {
  LOCAL_SEAT,
  LocalTable,
  actLocally,
  dealLocalTable,
  emptyLocalTable,
  localTableView,
  playLocalBot,
} from './localTable'
import {
  FetchMenu,
  MenuState,
  QueueLocalResult,
  menuAfterFailure,
} from './menuSync'
import { Message } from './message'
import { TurnStep } from './model'
import {
  Connection,
  GameSocket,
  type GameSocketService,
  OnlineGame,
  SocketRequirements,
  WaitToReconnect,
  acquireGameSocket,
  gameSocketStream,
  openOnlineGame,
  releaseGameSocket,
  sendToServer,
  wantsSocket,
  withNotice,
} from './online'
import { PingGameFromMenu, pingStatus } from './pings'
import {
  ClientMessage,
  CreateGameResponse,
  GameSnapshot,
  ServerMessage,
  isValidCode,
  normalizeCode,
} from './protocol'
import {
  isTypingTarget,
  prototypeSwitcher,
  stepVariant,
  variantFromSearch,
} from './prototypeSwitcher'
import {
  CheckNotifications,
  EnableNotifications,
  NotificationStatus,
  notificationsView,
} from './push'
import { AppRoute, gamePath, urlToAppRoute } from './route'
import { screenFrame } from './screens/frame'
import { CreateState, Home, emptyHome, homeView } from './screens/home'
import {
  HOME_VARIANTS,
  homeVariantView,
} from './screens/homeVariants.prototype'
import { lobbyView, messageScreen } from './screens/lobby'
import { menuView } from './screens/menu'
import { TableMode, makeTable } from './table'
import { tableView } from './view'

export { Message } from './message'

// MODEL

export const Screen = defineTaggedUnion({
  Home: { home: Home },
  Local: { table: LocalTable },
  Online: { game: OnlineGame },
})
export type Screen = typeof Screen.Type

export const Model = Schema.Struct({
  route: AppRoute,
  screen: Screen,
  playerName: Schema.String,
  seatCount: Schema.Number,
  device: Device,
  menu: MenuState,
  now: Schema.Number,
  notifications: NotificationStatus,
  homeVariant: Schema.String,
  homeTab: Schema.String,
  // PROTOTYPE (variant J): wizard step is 'name' | 'mode' | 'bots' | 'join';
  // direction drives the slide; firstStep is 'mode' when a name was remembered.
  wizardStep: Schema.String,
  wizardDirection: Schema.String,
  wizardFirstStep: Schema.String,
})
export type Model = typeof Model.Type

export const Flags = Schema.Struct({
  playerName: Schema.String,
  device: Device,
  now: Schema.Number,
})
export type Flags = typeof Flags.Type

export const flags: Effect.Effect<Flags> = Effect.map(
  Effect.all([loadDevice, loadPlayerName, Clock.currentTimeMillis]),
  ([device, playerName, now]) => ({ playerName, device, now }),
)

const DEFAULT_SEAT_COUNT = 3

const displayName = (model: Model): string =>
  model.playerName.trim() === '' ? 'You' : model.playerName.trim()

// COMMAND

const BOT_THINKING_TIME = Duration.millis(850)

export const RollSeed = Command.define('RollSeed', {
  messages: [Message.CompletedRollSeed],
  execute: Random.nextIntBetween(1, 2_147_483_647).pipe(
    Effect.map(seed => Message.CompletedRollSeed({ seed })),
  ),
})

export const WaitForBot = Command.define('WaitForBot', {
  args: { gameId: Schema.Number, turnNumber: Schema.Number, step: TurnStep },
  messages: [Message.CompletedWaitForBot],
  execute: ({ gameId, turnNumber, step }) =>
    Effect.sleep(BOT_THINKING_TIME).pipe(
      Effect.as(Message.CompletedWaitForBot({ gameId, turnNumber, step })),
    ),
})

// PROTOTYPE: keeps ?variant= in the URL so a variant survives a reload.
export const ReplaceVariantUrl = Command.define('ReplaceVariantUrl', {
  args: { variant: Schema.String },
  messages: [Message.CompletedReplaceVariantUrl],
  execute: ({ variant }) =>
    replaceUrl(`/?variant=${variant}`).pipe(
      Effect.as(Message.CompletedReplaceVariantUrl()),
    ),
})

export const Navigate = Command.define('Navigate', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) =>
    pushUrl(url).pipe(Effect.as(Message.CompletedNavigate())),
})

export const LoadExternal = Command.define('LoadExternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) => load(url).pipe(Effect.as(Message.CompletedNavigate())),
})

export const SavePlayerName = Command.define('SavePlayerName', {
  args: { name: Schema.String },
  messages: [Message.CompletedSavePlayerName],
  execute: ({ name }) =>
    savePlayerName(name).pipe(Effect.as(Message.CompletedSavePlayerName())),
})

const decodeCreateResponse = Schema.decodeUnknownOption(CreateGameResponse)

export const CreateFriendGame = Command.define('CreateFriendGame', {
  args: { name: Schema.String, device: Device },
  messages: [Message.SucceededCreateGame, Message.FailedCreateGame],
  execute: ({ name, device }) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise(() =>
        fetch('/api/games', {
          method: 'POST',
          headers: {
            ...authHeaders(device),
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name }),
        }),
      )
      const body = yield* Effect.tryPromise(() => response.json())
      return Option.match(decodeCreateResponse(body), {
        onNone: () =>
          Message.FailedCreateGame({
            reason: 'The game server said no. Try again in a moment.',
          }),
        onSome: ({ code }) => Message.SucceededCreateGame({ code }),
      })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.FailedCreateGame({
            reason: 'Couldn’t reach the game server. Are you online?',
          }),
        ),
      ),
    ),
})

export const ShareInvite = Command.define('ShareInvite', {
  args: { code: Schema.String },
  messages: [Message.CompletedShareInvite],
  execute: ({ code }) =>
    Effect.tryPromise(async () => {
      const url = `${location.origin}${gamePath(code)}`
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: 'All Aboard',
          text: `Join my All Aboard game: ${code}`,
          url,
        })
      } else {
        await navigator.clipboard.writeText(url)
      }
    }).pipe(
      Effect.catch(() => Effect.void),
      Effect.as(Message.CompletedShareInvite()),
    ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, GameSocketService>

const withScreen = (model: Model, screen: Screen): Model =>
  modifyFields(model, { screen: () => screen })

const goHome = (model: Model): Model =>
  withScreen(model, Screen.Home({ home: emptyHome }))

const fetchMenu = (model: Model) => FetchMenu({ device: model.device })

const screenForRoute = (model: Model, route: AppRoute): Screen =>
  AppRoute.match<Screen>(route, {
    Home: () =>
      model.screen._tag === 'Local'
        ? model.screen
        : Screen.Home({ home: emptyHome }),
    NotFound: () => Screen.Home({ home: emptyHome }),
    Game: ({ code }) => {
      const normalized = normalizeCode(code)
      return model.screen._tag === 'Online' &&
        model.screen.game.code === normalized
        ? model.screen
        : Screen.Online({ game: openOnlineGame(normalized, model.playerName) })
    },
  })

// LOCAL TABLE

// NOTE: A local game that just ended queues this device's result, to be
// posted to its stats the next time the menu loads.
const localFinishCommands = (model: Model, table: LocalTable) => {
  const wasOver =
    model.screen._tag === 'Local' &&
    model.screen.table.game.gameId === table.game.gameId &&
    model.screen.table.game.phase._tag === 'GameOver'
  return !wasOver && table.game.phase._tag === 'GameOver'
    ? Option.match(seatResult(table.game, LOCAL_SEAT), {
        onNone: () => [],
        onSome: result => [QueueLocalResult({ result })],
      })
    : []
}

const scheduleLocalBot = (model: Model, table: LocalTable): UpdateReturn => {
  const next = withScreen(model, Screen.Local({ table }))
  const finishCommands = localFinishCommands(model, table)
  return Option.match(maybeTurnStep(table.game), {
    onNone: () => ({ model: next, commands: finishCommands }),
    onSome: step =>
      isBotTurn(table.game)
        ? {
            model: next,
            commands: [
              WaitForBot({
                gameId: table.game.gameId,
                turnNumber: table.game.turnNumber,
                step,
              }),
            ],
          }
        : { model: next },
  })
}

const startLocalGame = (model: Model): UpdateReturn => ({
  model: withScreen(
    model,
    Screen.Local({
      table: emptyLocalTable(model.seatCount, displayName(model)),
    }),
  ),
  commands: [RollSeed()],
})

// ONLINE TABLE

const withOnlineGame = (model: Model, game: OnlineGame): Model =>
  withScreen(model, Screen.Online({ game }))

const sendFromOnline = (
  model: Model,
  game: OnlineGame,
  message: ClientMessage,
): UpdateReturn => ({
  model: withOnlineGame(model, withNotice(game, Option.none())),
  commands: [sendToServer(message)],
})

const onOnline = (
  model: Model,
  onGame: (game: OnlineGame) => UpdateReturn,
): UpdateReturn =>
  model.screen._tag === 'Online' ? onGame(model.screen.game) : { model }

const takeTableAction = (model: Model, action: PlayerAction): UpdateReturn =>
  Screen.match<UpdateReturn>(model.screen, {
    Home: () => ({ model }),
    Local: ({ table }) => scheduleLocalBot(model, actLocally(table, action)),
    Online: ({ game }) =>
      Option.exists(game.maybeSnapshot, snapshot => snapshot._tag === 'Table')
        ? sendFromOnline(model, game, ClientMessage.TakeAction({ action }))
        : { model },
  })

const modifyHoveredRoute = (
  model: Model,
  maybeRouteId: Option.Option<string>,
): UpdateReturn =>
  Screen.match<UpdateReturn>(model.screen, {
    Home: () => ({ model }),
    Local: ({ table }) => ({
      model: withScreen(
        model,
        Screen.Local({
          table: modifyFields(table, {
            ui: ui =>
              modifyFields(ui, { maybeHoveredRouteId: () => maybeRouteId }),
          }),
        }),
      ),
    }),
    Online: ({ game }) => ({
      model: withOnlineGame(
        model,
        modifyFields(game, {
          ui: ui =>
            modifyFields(ui, { maybeHoveredRouteId: () => maybeRouteId }),
        }),
      ),
    }),
  })

const scheduleReconnect = (model: Model, game: OnlineGame): UpdateReturn =>
  wantsSocket(game)
    ? {
        model: withOnlineGame(
          model,
          modifyFields(game, { connection: () => Connection.Reconnecting() }),
        ),
        commands: [WaitToReconnect({ code: game.code, attempt: game.attempt })],
      }
    : { model }

const receiveServerMessage = (
  model: Model,
  game: OnlineGame,
  message: ServerMessage,
): UpdateReturn =>
  ServerMessage.match<UpdateReturn>(message, {
    Rejected: ({ reason }) => ({
      model: withOnlineGame(
        model,
        withNotice(
          modifyFields(game, { isPinging: () => false }),
          Option.some(reason),
        ),
      ),
    }),
    Snapshot: ({ snapshot }) => {
      const isFirstLobbyView =
        snapshot._tag === 'Lobby' &&
        !snapshot.isViewerSeated &&
        !Option.exists(
          game.maybeSnapshot,
          previous => previous._tag === 'Lobby',
        )
      const freeTone = isFirstLobbyView
        ? Option.getOrElse(
            Option.fromNullishOr(
              [0, 1, 2, 3, 4].find(
                tone => !snapshot.seats.some(seat => seat.tone === tone),
              ),
            ),
            () => game.joinTone,
          )
        : game.joinTone
      return {
        model: withOnlineGame(
          model,
          modifyFields(game, {
            maybeSnapshot: () => Option.some(snapshot),
            connection: () => Connection.Open(),
            joinTone: () => freeTone,
            isPinging: () => false,
          }),
        ),
      }
    },
  })

const MARKET_KEYS = ['1', '2', '3', '4', '5']

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    // ROUTING

    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [Navigate({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({
          model,
          commands: [LoadExternal({ url: href })],
        }),
      }),

    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url)
      const screen = screenForRoute(model, route)
      return {
        model: modifyFields(model, {
          route: () => route,
          screen: () => screen,
          homeVariant: () => variantFromSearch(HOME_VARIANTS, url.search),
        }),
        commands: screen._tag === 'Home' ? [fetchMenu(model)] : [],
      }
    },

    CompletedNavigate: () => ({ model }),

    // HOME

    UpdatedNameInput: ({ value }) => ({
      model: modifyFields(model, { playerName: () => value }),
      commands: [SavePlayerName({ name: value.trim() })],
    }),

    CompletedSavePlayerName: () => ({ model }),

    ClickedSeatCount: ({ count }) => ({
      model: modifyFields(model, { seatCount: () => clampSeatCount(count) }),
    }),

    ClickedNewBotGame: () => startLocalGame(model),

    ClickedNewFriendGame: () =>
      model.screen._tag === 'Home'
        ? {
            model: withScreen(
              model,
              Screen.Home({
                home: modifyFields(model.screen.home, {
                  create: () => CreateState.Creating(),
                }),
              }),
            ),
            commands: [
              CreateFriendGame({
                name: displayName(model),
                device: model.device,
              }),
            ],
          }
        : { model },

    SucceededCreateGame: ({ code }) => ({
      model: withScreen(
        model,
        Screen.Online({ game: openOnlineGame(code, model.playerName) }),
      ),
      commands: [Navigate({ url: gamePath(code) })],
    }),

    FailedCreateGame: ({ reason }) =>
      model.screen._tag === 'Home'
        ? {
            model: withScreen(
              model,
              Screen.Home({
                home: modifyFields(model.screen.home, {
                  create: () => CreateState.Failed({ reason }),
                }),
              }),
            ),
          }
        : { model },

    UpdatedJoinCode: ({ value }) =>
      model.screen._tag === 'Home'
        ? {
            model: withScreen(
              model,
              Screen.Home({
                home: modifyFields(model.screen.home, {
                  joinCode: () => value,
                }),
              }),
            ),
          }
        : { model },

    SubmittedJoinCode: () => {
      if (model.screen._tag !== 'Home') {
        return { model }
      }
      const code = normalizeCode(model.screen.home.joinCode)
      return isValidCode(code)
        ? { model, commands: [Navigate({ url: gamePath(code) })] }
        : {
            model: withScreen(
              model,
              Screen.Home({
                home: modifyFields(model.screen.home, {
                  create: () =>
                    CreateState.Failed({
                      reason: 'Invite codes look like TRAIN-4K7.',
                    }),
                }),
              }),
            ),
          }
    },

    // TABLE

    CompletedRollSeed: ({ seed }) =>
      model.screen._tag === 'Local'
        ? scheduleLocalBot(model, dealLocalTable(model.screen.table, seed))
        : { model },

    ClickedDeck: () => takeTableAction(model, PlayerAction.DrewFromDeck()),

    ClickedMarketCard: ({ slot }) =>
      takeTableAction(model, PlayerAction.TookMarketCard({ slot })),

    ClickedRoute: ({ routeId }) =>
      takeTableAction(model, PlayerAction.ClaimedRoute({ routeId })),

    ClickedDrawTicket: () => takeTableAction(model, PlayerAction.DrewTicket()),

    ClickedPass: () => takeTableAction(model, PlayerAction.Passed()),

    ClickedNewGame: () => startLocalGame(model),

    ClickedMenu: () => ({
      model: goHome(model),
      commands: [Navigate({ url: '/' }), fetchMenu(model)],
    }),

    SucceededFetchMenu: ({ menu }) => ({
      model: modifyFields(model, { menu: () => MenuState.Loaded({ menu }) }),
    }),

    FailedFetchMenu: () => ({
      model: modifyFields(model, { menu: menuAfterFailure }),
    }),

    CompletedQueueLocalResult: () => ({ model }),

    ClickedMenuPing: ({ code }) => ({
      model,
      commands: [PingGameFromMenu({ code, device: model.device })],
    }),

    CompletedMenuPing: () => ({ model, commands: [fetchMenu(model)] }),

    SteppedHomeVariant: ({ step }) => {
      if (model.screen._tag !== 'Home') {
        return { model }
      }
      const variant = stepVariant(HOME_VARIANTS, model.homeVariant, step)
      return {
        model: modifyFields(model, { homeVariant: () => variant }),
        commands: [ReplaceVariantUrl({ variant })],
      }
    },

    CompletedReplaceVariantUrl: () => ({ model }),

    ClickedHomeTab: ({ tab }) => ({
      model: modifyFields(model, { homeTab: () => tab }),
    }),

    ClickedWizardContinue: () =>
      model.playerName.trim() === ''
        ? { model }
        : {
            model: modifyFields(model, {
              wizardStep: () => 'mode',
              wizardDirection: () => 'forward',
            }),
            commands: [SavePlayerName({ name: model.playerName.trim() })],
          },

    ClickedWizardMode: ({ mode }) => ({
      model: modifyFields(model, {
        wizardStep: () => (mode === 'join' ? 'join' : 'bots'),
        wizardDirection: () => 'forward',
      }),
    }),

    ClickedWizardBack: () => ({
      model: modifyFields(model, {
        wizardStep: () => (model.wizardStep === 'mode' ? 'name' : 'mode'),
        wizardDirection: () => 'back',
      }),
    }),

    ClickedWizardChangeName: () => ({
      model: modifyFields(model, {
        wizardStep: () => 'name',
        wizardDirection: () => 'back',
      }),
    }),

    TickedClock: ({ now }) => ({
      model: modifyFields(model, { now: () => now }),
    }),

    CheckedNotifications: ({ status }) => ({
      model: modifyFields(model, { notifications: () => status }),
    }),

    ClickedEnableNotifications: () => ({
      model: modifyFields(model, {
        notifications: () => NotificationStatus.Working(),
      }),
      commands: [EnableNotifications({ device: model.device })],
    }),

    ClickedPing: () =>
      onOnline(model, game =>
        sendFromOnline(
          model,
          modifyFields(game, { isPinging: () => true }),
          ClientMessage.Ping(),
        ),
      ),

    ClickedLeaveGame: () =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { isConfirmingLeave: () => true }),
        ),
      })),

    CancelledLeaveGame: () =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { isConfirmingLeave: () => false }),
        ),
      })),

    ConfirmedLeaveGame: () =>
      onOnline(model, game => {
        const sent = sendFromOnline(model, game, ClientMessage.LeaveGame())
        return {
          model: goHome(sent.model),
          commands: [
            ...(sent.commands ?? []),
            Navigate({ url: '/' }),
            fetchMenu(model),
          ],
        }
      }),

    ClickedRematch: () =>
      onOnline(model, game =>
        sendFromOnline(model, game, ClientMessage.OpenRematch()),
      ),

    HoveredRoute: ({ routeId }) =>
      modifyHoveredRoute(model, Option.some(routeId)),

    UnhoveredRoute: () => modifyHoveredRoute(model, Option.none()),

    PressedKey: ({ key }) =>
      Match.value(key.toLowerCase()).pipe(
        Match.withReturnType<UpdateReturn>(),
        Match.when('d', () =>
          takeTableAction(model, PlayerAction.DrewFromDeck()),
        ),
        Match.when('t', () =>
          takeTableAction(model, PlayerAction.DrewTicket()),
        ),
        Match.when(
          (pressed: string) => MARKET_KEYS.includes(pressed),
          pressed =>
            takeTableAction(
              model,
              PlayerAction.TookMarketCard({ slot: Number(pressed) - 1 }),
            ),
        ),
        Match.orElse(() => ({ model })),
      ),

    CompletedWaitForBot: ({ gameId, turnNumber, step }) => {
      if (model.screen._tag !== 'Local') {
        return { model }
      }
      const table = model.screen.table
      const isStillThatTurn =
        gameId === table.game.gameId &&
        turnNumber === table.game.turnNumber &&
        Option.contains(maybeTurnStep(table.game), step) &&
        isBotTurn(table.game)
      return isStillThatTurn
        ? scheduleLocalBot(model, playLocalBot(table))
        : { model }
    },

    // LOBBY

    UpdatedJoinName: ({ value }) =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { joinName: () => value }),
        ),
      })),

    ClickedTone: ({ tone }) =>
      onOnline(model, game => {
        const isSeated = Option.exists(
          game.maybeSnapshot,
          snapshot => snapshot._tag === 'Lobby' && snapshot.isViewerSeated,
        )
        return isSeated
          ? sendFromOnline(model, game, ClientMessage.ChangeTone({ tone }))
          : {
              model: withOnlineGame(
                model,
                modifyFields(game, { joinTone: () => tone }),
              ),
            }
      }),

    SubmittedJoinLobby: () =>
      onOnline(model, game => {
        const sent = sendFromOnline(
          model,
          game,
          ClientMessage.JoinLobby({ name: game.joinName, tone: game.joinTone }),
        )
        return {
          model: modifyFields(sent.model, { playerName: () => game.joinName }),
          commands: [
            ...(sent.commands ?? []),
            SavePlayerName({ name: game.joinName.trim() }),
          ],
        }
      }),

    ClickedAddBot: () =>
      onOnline(model, game =>
        sendFromOnline(model, game, ClientMessage.AddBot()),
      ),

    ClickedRemoveSeat: ({ seatIndex }) =>
      onOnline(model, game =>
        sendFromOnline(model, game, ClientMessage.RemoveSeat({ seatIndex })),
      ),

    ClickedStartGame: () =>
      onOnline(model, game =>
        sendFromOnline(model, game, ClientMessage.StartGame()),
      ),

    ClickedLeaveLobby: () =>
      onOnline(model, game => {
        const sent = sendFromOnline(model, game, ClientMessage.LeaveGame())
        return {
          model: goHome(sent.model),
          commands: [
            ...(sent.commands ?? []),
            Navigate({ url: '/' }),
            fetchMenu(model),
          ],
        }
      }),

    ClickedReady: ({ isReady }) =>
      onOnline(model, game =>
        sendFromOnline(model, game, ClientMessage.MarkReady({ isReady })),
      ),

    ClickedShareInvite: () =>
      onOnline(model, game => ({
        model,
        commands: [ShareInvite({ code: game.code })],
      })),

    CompletedShareInvite: () => ({ model }),

    // SOCKET

    ConnectedGameSocket: () =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { connection: () => Connection.Open() }),
        ),
      })),

    ReleasedGameSocket: () => ({ model }),

    FailedConnectGameSocket: () =>
      onOnline(model, game => scheduleReconnect(model, game)),

    DisconnectedGameSocket: () =>
      onOnline(model, game => scheduleReconnect(model, game)),

    CompletedWaitToReconnect: ({ code, attempt }) =>
      onOnline(model, game =>
        game.code === code && game.attempt === attempt
          ? {
              model: withOnlineGame(
                model,
                modifyFields(game, {
                  attempt: current => current + 1,
                  connection: () => Connection.Connecting(),
                }),
              ),
            }
          : { model },
      ),

    ReceivedServerMessage: ({ message: serverMessage }) =>
      onOnline(model, game => receiveServerMessage(model, game, serverMessage)),

    CompletedSendClientMessage: () => ({ model }),

    FailedSendClientMessage: ({ reason }) =>
      onOnline(model, game => ({
        model: withOnlineGame(model, withNotice(game, Option.some(reason))),
      })),
  })

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, Flags> = (
  initialFlags,
  url,
) => {
  const route = urlToAppRoute(url)
  const base: Model = {
    route,
    screen: Screen.Home({ home: emptyHome }),
    playerName: initialFlags.playerName,
    seatCount: DEFAULT_SEAT_COUNT,
    device: initialFlags.device,
    menu: MenuState.Loading(),
    now: initialFlags.now,
    notifications: NotificationStatus.Checking(),
    homeVariant: variantFromSearch(HOME_VARIANTS, url.search),
    homeTab: 'friends',
    wizardStep: initialFlags.playerName.trim() === '' ? 'name' : 'mode',
    wizardDirection: 'forward',
    wizardFirstStep: initialFlags.playerName.trim() === '' ? 'name' : 'mode',
  }
  const screen = screenForRoute(base, route)
  return {
    model: withScreen(base, screen),
    commands: [
      CheckNotifications(),
      ...(screen._tag === 'Home' ? [fetchMenu(base)] : []),
    ],
  }
}

// MANAGED RESOURCE

export const managedResources = ManagedResource.make<Model, Message>()(
  entry => ({
    gameSocket: entry(SocketRequirements, {
      resource: GameSocket,
      modelToMaybeRequirements: model =>
        model.screen._tag === 'Online' && wantsSocket(model.screen.game)
          ? Option.some({
              code: model.screen.game.code,
              attempt: model.screen.game.attempt,
              device: model.device,
            })
          : Option.none(),
      acquire: acquireGameSocket,
      release: releaseGameSocket,
      onAcquired: () => Message.ConnectedGameSocket(),
      onReleased: () => Message.ReleasedGameSocket(),
      onAcquireError: error =>
        Message.FailedConnectGameSocket({
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
    }),
  }),
)

// SUBSCRIPTION

const SHORTCUT_KEYS = ['d', 't', ...MARKET_KEYS]

const CLOCK_INTERVAL = Duration.seconds(30)

export const subscriptions = Subscription.make<
  Model,
  Message,
  GameSocketService
>()(entry => ({
  // NOTE: Ping countdowns need the time; nothing else in the Model does.
  clock: Subscription.persistentEntry(
    Stream.tick(CLOCK_INTERVAL).pipe(
      Stream.mapEffect(() =>
        Clock.currentTimeMillis.pipe(
          Effect.map(now => Message.TickedClock({ now })),
        ),
      ),
    ),
  ),
  prototypeVariantKeys: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: document,
      type: 'keydown',
      filterMapEvent: keyboardEvent =>
        import.meta.env.DEV &&
        !keyboardEvent.metaKey &&
        !keyboardEvent.ctrlKey &&
        !keyboardEvent.altKey &&
        !isTypingTarget(keyboardEvent.target) &&
        (keyboardEvent.key === 'ArrowLeft' ||
          keyboardEvent.key === 'ArrowRight')
          ? Option.some(
              Message.SteppedHomeVariant({
                step: keyboardEvent.key === 'ArrowLeft' ? -1 : 1,
              }),
            )
          : Option.none(),
    }),
  ),
  keyboardShortcuts: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: document,
      type: 'keydown',
      filterMapEvent: keyboardEvent =>
        !keyboardEvent.metaKey &&
        !keyboardEvent.ctrlKey &&
        !keyboardEvent.altKey &&
        !(keyboardEvent.target instanceof HTMLInputElement) &&
        SHORTCUT_KEYS.includes(keyboardEvent.key.toLowerCase())
          ? Option.some(Message.PressedKey({ key: keyboardEvent.key }))
          : Option.none(),
    }),
  ),
  gameSocket: entry(
    { socketKey: Schema.String },
    {
      modelToDependencies: model => ({
        socketKey:
          model.screen._tag === 'Online' &&
          model.screen.game.connection._tag === 'Open'
            ? `${model.screen.game.code}#${model.screen.game.attempt}`
            : '',
      }),
      dependenciesToStream: ({ socketKey }) =>
        gameSocketStream(socketKey !== ''),
    },
  ),
}))

// VIEW

const onlineView = (
  game: OnlineGame,
  now: number,
  h: HtmlBuilder<Message>,
): Document => {
  const connecting = (): Document => ({
    title: 'All Aboard',
    body: messageScreen(
      `Connecting to ${game.code}…`,
      game.connection._tag === 'Reconnecting'
        ? 'The connection dropped. Trying again…'
        : 'Finding your table.',
      h,
    ),
  })
  return Option.match(game.maybeSnapshot, {
    onNone: connecting,
    onSome: snapshot =>
      GameSnapshot.match<Document>(snapshot, {
        Lobby: lobby => ({
          title: `${lobby.code} · All Aboard`,
          body: lobbyView(game, lobby, h),
        }),
        Table: table =>
          tableView(
            makeTable(
              table.view,
              game.ui,
              TableMode.Online({
                code: table.code,
                ping: pingStatus(table, game.isPinging, now),
                isConfirmingLeave: game.isConfirmingLeave,
              }),
            ),
            h,
          ),
        Closed: ({ reason }) => ({
          title: 'All Aboard',
          body: messageScreen(reason, `Invite code ${game.code}.`, h),
        }),
        Gone: ({ reason }) => ({
          title: 'All Aboard',
          body: messageScreen('This game no longer exists', reason, h),
        }),
      }),
  })
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document =>
  Screen.match<Document>(model.screen, {
    Home: ({ home }) => {
      const inputs = {
        playerName: model.playerName,
        seatCount: model.seatCount,
      }
      const notifications = notificationsView(model.notifications, h)
      const menu = menuView(model.menu, { now: model.now }, h)
      // PROTOTYPE: dev builds render the picked home variant and the switcher.
      return {
        title: 'All Aboard',
        body: import.meta.env.DEV
          ? screenFrame(
              [
                homeVariantView(
                  model.homeVariant,
                  {
                    home,
                    inputs,
                    notifications,
                    menu,
                    tab: model.homeTab,
                    wizard: {
                      step: model.wizardStep,
                      direction: model.wizardDirection,
                      firstStep: model.wizardFirstStep,
                    },
                  },
                  h,
                ),
                prototypeSwitcher(HOME_VARIANTS, model.homeVariant, h),
              ],
              h,
            )
          : homeView(home, inputs, [notifications, ...menu], h),
      }
    },
    Local: ({ table }) => tableView(localTableView(table), h),
    Online: ({ game }) => onlineView(game, model.now, h),
  })
