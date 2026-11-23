import { Duration, Effect, Match, Option, Random, Schema } from 'effect'
import { Command, Dom, Runtime, Subscription, type Update } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { PlayerAction, isBotTurn, maybeTurnStep } from './domain/game'
import {
  LocalTable,
  actLocally,
  dealLocalTable,
  emptyLocalTable,
  localTableView,
  playLocalBot,
} from './localTable'
import { Message } from './message'
import { TurnStep } from './model'
import { tableView } from './view'

export { Message } from './message'

// MODEL

export const Screen = defineTaggedUnion({
  Local: { table: LocalTable },
})
export type Screen = typeof Screen.Type

export const Model = Schema.Struct({
  screen: Screen,
})
export type Model = typeof Model.Type

const DEFAULT_SEAT_COUNT = 3

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

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const withLocalTable = (model: Model, table: LocalTable): Model =>
  modifyFields(model, { screen: () => Screen.Local({ table }) })

const scheduleLocalBot = (model: Model, table: LocalTable): UpdateReturn =>
  Option.match(maybeTurnStep(table.game), {
    onNone: () => ({ model: withLocalTable(model, table) }),
    onSome: step =>
      isBotTurn(table.game)
        ? {
            model: withLocalTable(model, table),
            commands: [
              WaitForBot({
                gameId: table.game.gameId,
                turnNumber: table.game.turnNumber,
                step,
              }),
            ],
          }
        : { model: withLocalTable(model, table) },
  })

const onLocalTable = (
  model: Model,
  onTable: (table: LocalTable) => UpdateReturn,
): UpdateReturn =>
  Screen.match<UpdateReturn>(model.screen, {
    Local: ({ table }) => onTable(table),
  })

const takeTableAction = (model: Model, action: PlayerAction): UpdateReturn =>
  onLocalTable(model, table =>
    scheduleLocalBot(model, actLocally(table, action)),
  )

const modifyTableUi = (
  model: Model,
  modify: (table: LocalTable) => LocalTable,
): UpdateReturn =>
  onLocalTable(model, table => ({
    model: withLocalTable(model, modify(table)),
  }))

const MARKET_KEYS = ['1', '2', '3', '4', '5']

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    CompletedRollSeed: ({ seed }) =>
      onLocalTable(model, table =>
        scheduleLocalBot(model, dealLocalTable(table, seed)),
      ),

    ClickedDeck: () => takeTableAction(model, PlayerAction.DrewFromDeck()),

    ClickedMarketCard: ({ slot }) =>
      takeTableAction(model, PlayerAction.TookMarketCard({ slot })),

    ClickedRoute: ({ routeId }) =>
      takeTableAction(model, PlayerAction.ClaimedRoute({ routeId })),

    ClickedDrawTicket: () => takeTableAction(model, PlayerAction.DrewTicket()),

    ClickedPass: () => takeTableAction(model, PlayerAction.Passed()),

    ClickedNewGame: () =>
      onLocalTable(model, table => ({
        model: withLocalTable(
          model,
          emptyLocalTable(table.seatCount, table.playerName),
        ),
        commands: [RollSeed()],
      })),

    ClickedMenu: () => ({ model }),

    ClickedPing: () => ({ model }),

    ClickedLeaveGame: () => ({ model }),

    ClickedRematch: () => ({ model }),

    HoveredRoute: ({ routeId }) =>
      modifyTableUi(model, table =>
        modifyFields(table, {
          ui: ui =>
            modifyFields(ui, {
              maybeHoveredRouteId: () => Option.some(routeId),
            }),
        }),
      ),

    UnhoveredRoute: () =>
      modifyTableUi(model, table =>
        modifyFields(table, {
          ui: ui =>
            modifyFields(ui, { maybeHoveredRouteId: () => Option.none() }),
        }),
      ),

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

    CompletedWaitForBot: ({ gameId, turnNumber, step }) =>
      onLocalTable(model, table => {
        const isStillThatTurn =
          gameId === table.game.gameId &&
          turnNumber === table.game.turnNumber &&
          Option.contains(maybeTurnStep(table.game), step) &&
          isBotTurn(table.game)
        return isStillThatTurn
          ? scheduleLocalBot(model, playLocalBot(table))
          : { model }
      }),
  })

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    screen: Screen.Local({
      table: emptyLocalTable(DEFAULT_SEAT_COUNT, 'You'),
    }),
  },
  commands: [RollSeed()],
})

// SUBSCRIPTION

const SHORTCUT_KEYS = ['d', 't', ...MARKET_KEYS]

export const subscriptions = Subscription.make<Model, Message>()(_entry => ({
  keyboardShortcuts: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: document,
      type: 'keydown',
      filterMapEvent: keyboardEvent =>
        !keyboardEvent.metaKey &&
        !keyboardEvent.ctrlKey &&
        !keyboardEvent.altKey &&
        SHORTCUT_KEYS.includes(keyboardEvent.key.toLowerCase())
          ? Option.some(Message.PressedKey({ key: keyboardEvent.key }))
          : Option.none(),
    }),
  ),
}))

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document =>
  Screen.match<Document>(model.screen, {
    Local: ({ table }) => tableView(localTableView(table), h),
  })
