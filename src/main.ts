import {
  Array,
  Clock,
  Duration,
  Effect,
  Array as EffectArray,
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
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { toString as urlToString } from 'foldkit/url'

import { ReloadApp, appUpdateStream, appUpdateView } from './appUpdate'
import { CloseConfirmDialog, ShowConfirmDialog } from './confirmDialog'
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
import { DeleteGameFromMenu, withoutGame } from './menuDelete'
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
  type OnlineRole,
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
  CheckNotifications,
  EnableNotifications,
  NotificationStatus,
  notificationsView,
} from './push'
import {
  type RecapStep,
  RequestFullscreen,
  continueTour,
  idleRecap,
  showScoreboard,
  spotlight,
  startTour,
} from './recap'
import { AppRoute, gamePath, urlToAppRoute, watchPath } from './route'
import {
  CreateState,
  Home,
  changeName,
  chooseBots,
  chooseJoin,
  continueFromName,
  homeFor,
  homeView,
  stepBack,
} from './screens/home'
import { lobbyView, messageScreen } from './screens/lobby'
import { menuView } from './screens/menu'
import { watchLobbyView, watchTableView } from './screens/watch'
import {
  AudioOutput,
  type AudioOutputService,
  AudioRequirements,
  PlaySounds,
  acquireAudio,
  gameCues,
  recapCues,
  releaseAudio,
} from './sound'
import { TableMode, type TableUi, makeTable } from './table'
import { tableView } from './view'
import {
  ScreenWakeLock,
  WakeLockRequirements,
  acquireWakeLock,
  releaseWakeLock,
} from './wakeLock'

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
  maybeConfirmingDelete: Schema.Option(Schema.String),
  now: Schema.Number,
  notifications: NotificationStatus,
  isUpdateReady: Schema.Boolean,
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

// NOTE: Opens the phone's share sheet (AirDrop, Messages) with the game's watch
// page, for an iPad or laptop to show the table. Copies the link where there is
// no share sheet.
export const ShareWatchLink = Command.define('ShareWatchLink', {
  args: { code: Schema.String },
  messages: [Message.CompletedShareWatch],
  execute: ({ code }) =>
    Effect.tryPromise(async () => {
      const url = `${location.origin}${watchPath(code)}`
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: 'All Aboard',
          text: `Watch our All Aboard game: ${code}`,
          url,
        })
      } else {
        await navigator.clipboard.writeText(url)
      }
    }).pipe(
      Effect.catch(() => Effect.void),
      Effect.as(Message.CompletedShareWatch()),
    ),
})

export const CopyInviteCode = Command.define('CopyInviteCode', {
  args: { code: Schema.String },
  messages: [Message.CompletedCopyCode],
  execute: ({ code }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(code)).pipe(
      Effect.as(Message.CompletedCopyCode({ didCopy: true })),
      Effect.catch(() =>
        Effect.succeed(Message.CompletedCopyCode({ didCopy: false })),
      ),
    ),
})

// UPDATE

type UpdateReturn = Update.Return<
  Model,
  Message,
  GameSocketService | AudioOutputService
>

const withScreen = (model: Model, screen: Screen): Model =>
  modifyFields(model, { screen: () => screen })

const goHome = (model: Model): Model =>
  withScreen(model, Screen.Home({ home: homeFor(model.playerName) }))

const fetchMenu = (model: Model) => FetchMenu({ device: model.device })

const updateHome = (model: Model, f: (home: Home) => Home): UpdateReturn =>
  model.screen._tag === 'Home'
    ? { model: withScreen(model, Screen.Home({ home: f(model.screen.home) })) }
    : { model }

const screenForRoute = (model: Model, route: AppRoute): Screen =>
  AppRoute.match<Screen>(route, {
    Home: () =>
      model.screen._tag === 'Local'
        ? model.screen
        : Screen.Home({ home: homeFor(model.playerName) }),
    NotFound: () => Screen.Home({ home: homeFor(model.playerName) }),
    Game: ({ code }) => onlineScreenFor(model, code, 'Player'),
    Watch: ({ code }) => onlineScreenFor(model, code, 'Watcher'),
  })

const onlineScreenFor = (
  model: Model,
  code: string,
  role: OnlineRole,
): Screen => {
  const normalized = normalizeCode(code)
  return model.screen._tag === 'Online' &&
    model.screen.game.code === normalized &&
    model.screen.game.role === role
    ? model.screen
    : Screen.Online({
        game: openOnlineGame(normalized, model.playerName, role),
      })
}

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
): UpdateReturn =>
  game.role === 'Watcher'
    ? { model }
    : {
        model: withOnlineGame(model, withNotice(game, Option.none())),
        commands: [sendToServer(message)],
      }

// NOTE: A table screen starts its end-of-game tour the first time it sees a
// finished game, and forgets it when a rematch brings the lobby back.
const recapOnSnapshot = (
  model: Model,
  game: OnlineGame,
  snapshot: GameSnapshot,
): UpdateReturn => {
  const isOver =
    snapshot._tag === 'WatchTable' && snapshot.view.phase._tag === 'GameOver'
  if (isOver && game.recap.stage._tag === 'Idle') {
    const tour = startTour(game.recap)
    return withRecapStep(model, game, tour)
  }
  return !isOver && game.recap.stage._tag !== 'Idle'
    ? {
        model: withOnlineGame(
          model,
          modifyFields(game, { recap: () => idleRecap }),
        ),
      }
    : { model }
}

const withRecapStep = (
  model: Model,
  game: OnlineGame,
  step: RecapStep,
): UpdateReturn => {
  const nextModel = withOnlineGame(
    model,
    modifyFields(game, { recap: () => step.recap }),
  )
  return step.commands === undefined
    ? { model: nextModel }
    : { model: nextModel, commands: step.commands }
}

const watchedPlayerCount = (game: OnlineGame): number =>
  Option.match(game.maybeSnapshot, {
    onNone: () => 0,
    onSome: snapshot =>
      snapshot._tag === 'WatchTable' ? snapshot.view.players.length : 0,
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

const modifyTableUi = (
  model: Model,
  f: (ui: TableUi) => TableUi,
): UpdateReturn =>
  Screen.match<UpdateReturn>(model.screen, {
    Home: () => ({ model }),
    Local: ({ table }) => ({
      model: withScreen(
        model,
        Screen.Local({ table: modifyFields(table, { ui: f }) }),
      ),
    }),
    Online: ({ game }) => ({
      model: withOnlineGame(model, modifyFields(game, { ui: f })),
    }),
  })

const modifyHoveredRoute = (
  model: Model,
  maybeRouteId: Option.Option<string>,
): UpdateReturn =>
  modifyTableUi(model, ui =>
    modifyFields(ui, { maybeHoveredRouteId: () => maybeRouteId }),
  )

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

const turnKey = (snapshot: GameSnapshot): string =>
  snapshot._tag === 'Table'
    ? `${snapshot.view.phase._tag}:${snapshot.view.currentPlayerIndex}`
    : snapshot._tag

// NOTE: A rejected-move notice ("It's not your turn.") describes the turn it
// was sent in. Once the turn moves on, it is stale, so the next snapshot from
// a different turn clears it.
const turnChanged = (
  maybePrevious: Option.Option<GameSnapshot>,
  next: GameSnapshot,
): boolean =>
  !Option.exists(maybePrevious, previous => turnKey(previous) === turnKey(next))

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
      const updatedGame = turnChanged(game.maybeSnapshot, snapshot)
        ? withNotice(game, Option.none())
        : game
      const nextGame = modifyFields(updatedGame, {
        maybeSnapshot: () => Option.some(snapshot),
        connection: () => Connection.Open(),
        joinTone: () => freeTone,
        isPinging: () => false,
      })
      return recapOnSnapshot(
        withOnlineGame(model, nextGame),
        nextGame,
        snapshot,
      )
    },
  })

// NOTE: Join and Watch both start from the code typed on the home screen;
// they differ only in which page they open.
const goToCode = (
  model: Model,
  pathFor: (code: string) => string,
): UpdateReturn => {
  if (model.screen._tag !== 'Home') {
    return { model }
  }
  const code = normalizeCode(model.screen.home.joinCode)
  return isValidCode(code)
    ? { model, commands: [Navigate({ url: pathFor(code) })] }
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
}

const MARKET_KEYS = ['1', '2', '3', '4', '5']

const updateModel = (model: Model, message: Message) =>
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

    SubmittedName: () => {
      const name = model.playerName.trim()
      return name === ''
        ? { model }
        : {
            ...updateHome(model, home => continueFromName(home, name)),
            commands: [SavePlayerName({ name })],
          }
    },

    ClickedPlayWithBots: () => updateHome(model, chooseBots),

    ClickedHaveInviteCode: () => updateHome(model, chooseJoin),

    ClickedWizardBack: () => updateHome(model, stepBack),

    ClickedChangeName: () => updateHome(model, changeName),

    ClickedSeatCount: ({ count }) => ({
      model: modifyFields(model, { seatCount: () => clampSeatCount(count) }),
    }),

    DraggedSeatCount: ({ count }) => ({
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

    SubmittedJoinCode: () => goToCode(model, gamePath),

    ClickedWatchCode: () => goToCode(model, watchPath),

    // TABLE SCREEN

    CompletedWaitForRecap: ({ run, position }) =>
      onOnline(model, game => {
        const tour = continueTour(
          game.recap,
          run,
          position,
          watchedPlayerCount(game),
        )
        return withRecapStep(model, game, tour)
      }),

    ClickedRecapPlayer: ({ playerIndex }) =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { recap: recap => spotlight(recap, playerIndex) }),
        ),
      })),

    ClickedRecapScores: () =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { recap: showScoreboard }),
        ),
      })),

    ClickedReplayRecap: () =>
      onOnline(model, game => {
        const tour = startTour(game.recap)
        return withRecapStep(model, game, tour)
      }),

    ClickedFullscreen: () => ({ model, commands: [RequestFullscreen()] }),

    CompletedRequestFullscreen: () => ({ model }),

    AcquiredWakeLock: () => ({ model }),

    ReleasedWakeLock: () => ({ model }),

    FailedWakeLock: () => ({ model }),

    ClickedSound: ({ setting }) =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { sound: () => setting }),
        ),
      })),

    CompletedPlaySounds: () => ({ model }),

    AcquiredAudio: () => ({ model }),

    ReleasedAudio: () => ({ model }),

    FailedAudio: () =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { sound: () => 'Off' }),
        ),
      })),

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

    ToggledOfferedTicket: ({ ticketId }) =>
      modifyTableUi(model, ui =>
        modifyFields(ui, {
          returnedTicketIds: returned =>
            Array.contains(returned, ticketId)
              ? Array.filter(returned, id => id !== ticketId)
              : Array.append(returned, ticketId),
        }),
      ),

    ClickedKeepTickets: ({ ticketIds }) => {
      const cleared = modifyTableUi(model, ui =>
        modifyFields(ui, { returnedTicketIds: () => [] }),
      ).model
      return takeTableAction(cleared, PlayerAction.KeptTickets({ ticketIds }))
    },

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

    ClickedDeleteGame: ({ code }) => ({
      model: modifyFields(model, {
        maybeConfirmingDelete: () => Option.some(code),
      }),
      commands: [ShowConfirmDialog()],
    }),

    ClickedCancelDeleteGame: () => ({
      model: modifyFields(model, {
        maybeConfirmingDelete: () => Option.none(),
      }),
      commands: [CloseConfirmDialog()],
    }),

    ClickedConfirmDeleteGame: ({ code }) => ({
      model: modifyFields(model, {
        maybeConfirmingDelete: () => Option.none(),
        menu: menu => withoutGame(menu, code),
      }),
      commands: [
        CloseConfirmDialog(),
        DeleteGameFromMenu({ code, device: model.device }),
      ],
    }),

    CompletedShowConfirmDialog: () => ({ model }),

    CompletedCloseConfirmDialog: () => ({ model }),

    CompletedDeleteGame: () => ({ model, commands: [fetchMenu(model)] }),

    FoundAppUpdate: () => ({
      model: modifyFields(model, { isUpdateReady: () => true }),
    }),

    ClickedReloadApp: () => ({ model, commands: [ReloadApp()] }),

    CompletedReloadApp: () => ({ model }),

    DismissedAppUpdate: () => ({
      model: modifyFields(model, { isUpdateReady: () => false }),
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
        commands: [ShowConfirmDialog()],
      })),

    CancelledLeaveGame: () =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { isConfirmingLeave: () => false }),
        ),
        commands: [CloseConfirmDialog()],
      })),

    ConfirmedLeaveGame: () =>
      onOnline(model, game => {
        const sent = sendFromOnline(model, game, ClientMessage.LeaveGame())
        return {
          model: goHome(sent.model),
          commands: [
            ...(sent.commands ?? []),
            CloseConfirmDialog(),
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

    ClickedDockTab: ({ tab }) =>
      modifyTableUi(model, ui => modifyFields(ui, { dockTab: () => tab })),

    DraggedDockTab: ({ tab }) =>
      modifyTableUi(model, ui => modifyFields(ui, { dockTab: () => tab })),

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

    ClickedShareWatch: () =>
      onOnline(model, game => ({
        model,
        commands: [ShareWatchLink({ code: game.code })],
      })),

    CompletedShareWatch: () => ({ model }),

    ClickedCopyCode: () =>
      onOnline(model, game => ({
        model,
        commands: [CopyInviteCode({ code: game.code })],
      })),

    CompletedCopyCode: ({ didCopy }) =>
      onOnline(model, game => ({
        model: withOnlineGame(
          model,
          modifyFields(game, { isCodeCopied: () => didCopy }),
        ),
      })),

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

// NOTE: Sound is worked out from what changed, not from which Message
// arrived, so a snapshot, a tour step or a tap all get their cues the same
// way. Only a table screen with sound on plays anything.
const watchedTable = (model: Model) => {
  if (model.screen._tag !== 'Online') {
    return Option.none()
  }
  const game = model.screen.game
  return game.role === 'Watcher' && game.sound === 'On'
    ? Option.flatMap(game.maybeSnapshot, snapshot =>
        snapshot._tag === 'WatchTable'
          ? Option.some({ game, table: snapshot })
          : Option.none(),
      )
    : Option.none()
}

const soundCommands = (before: Model, after: Model) =>
  Option.match(
    Option.zipWith(watchedTable(before), watchedTable(after), (was, now) => ({
      was,
      now,
    })),
    {
      onNone: () => [],
      onSome: ({ was, now }) => {
        if (was.game.code !== now.game.code) {
          return []
        }
        const game = gameCues(was.table.view, now.table.view)
        const recap =
          now.table.view.phase._tag === 'GameOver'
            ? recapCues(
                was.game.recap,
                now.game.recap,
                now.table.view,
                now.table.revealedTickets,
                now.table.view.phase.standings,
              )
            : []
        return [
          ...(EffectArray.isReadonlyArrayNonEmpty(game)
            ? [PlaySounds({ channel: 'Game', cues: game })]
            : []),
          ...(EffectArray.isReadonlyArrayNonEmpty(recap)
            ? [PlaySounds({ channel: 'Recap', cues: recap })]
            : []),
        ]
      },
    },
  )

export const update = (model: Model, message: Message): UpdateReturn => {
  const updated = updateModel(model, message)
  const sounds = soundCommands(model, updated.model)
  return EffectArray.isArrayNonEmpty(sounds)
    ? {
        model: updated.model,
        commands: [...(updated.commands ?? []), ...sounds],
      }
    : updated
}

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, Flags> = (
  initialFlags,
  url,
) => {
  const route = urlToAppRoute(url)
  const base: Model = {
    route,
    screen: Screen.Home({ home: homeFor(initialFlags.playerName) }),
    playerName: initialFlags.playerName,
    seatCount: DEFAULT_SEAT_COUNT,
    device: initialFlags.device,
    menu: MenuState.Loading(),
    maybeConfirmingDelete: Option.none(),
    now: initialFlags.now,
    notifications: NotificationStatus.Checking(),
    isUpdateReady: false,
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
              isWatching: model.screen.game.role === 'Watcher',
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
    audio: entry(AudioRequirements, {
      resource: AudioOutput,
      modelToMaybeRequirements: model =>
        model.screen._tag === 'Online' &&
        model.screen.game.role === 'Watcher' &&
        model.screen.game.sound === 'On'
          ? Option.some({ code: model.screen.game.code })
          : Option.none(),
      acquire: acquireAudio,
      release: releaseAudio,
      onAcquired: () => Message.AcquiredAudio(),
      onReleased: () => Message.ReleasedAudio(),
      onAcquireError: () => Message.FailedAudio(),
    }),
    wakeLock: entry(WakeLockRequirements, {
      resource: ScreenWakeLock,
      modelToMaybeRequirements: model =>
        model.screen._tag === 'Online' &&
        model.screen.game.role === 'Watcher' &&
        wantsSocket(model.screen.game)
          ? Option.some({ code: model.screen.game.code })
          : Option.none(),
      acquire: acquireWakeLock,
      release: releaseWakeLock,
      onAcquired: () => Message.AcquiredWakeLock(),
      onReleased: () => Message.ReleasedWakeLock(),
      onAcquireError: () => Message.FailedWakeLock(),
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
  appUpdate: Subscription.persistentEntry(appUpdateStream),
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
            ? `${model.screen.game.role}:${model.screen.game.code}#${model.screen.game.attempt}`
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
        WatchLobby: lobby => ({
          title: `${lobby.code} · Table screen`,
          body: watchLobbyView(lobby, game.sound, h),
        }),
        WatchTable: table => watchTableView(table, game.recap, game.sound, h),
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

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const page = screenView(model, h)
  return {
    ...page,
    body: h.div(
      [h.Class('app-shell')],
      [page.body, appUpdateView(model.isUpdateReady, h)],
    ),
  }
}

const screenView = (model: Model, h: HtmlBuilder<Message>): Document =>
  Screen.match<Document>(model.screen, {
    Home: ({ home }) => ({
      title: 'All Aboard',
      body: homeView(
        home,
        { playerName: model.playerName, seatCount: model.seatCount },
        [
          notificationsView(model.notifications, h),
          ...menuView(
            model.menu,
            {
              now: model.now,
              maybeConfirmingDelete: model.maybeConfirmingDelete,
            },
            h,
          ),
        ],
        h,
      ),
    }),
    Local: ({ table }) => tableView(localTableView(table), h),
    Online: ({ game }) => onlineView(game, model.now, h),
  })
