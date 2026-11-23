import { Duration, Effect, Match, Option, Random, Schema } from 'effect'
import { Command, Dom, Runtime, Subscription, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { decideBotAction } from './domain/bot'
import {
  PlayerAction,
  applyAction,
  emptyModel,
  isBotTurn,
  isHumanTurn,
  maybeTurnStep,
  newGame,
} from './domain/game'
import { Message } from './message'
import { Model, TurnStep } from './model'

export { Message } from './message'
export { Model } from './model'
export { view } from './view'

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

const scheduleBot = (model: Model): UpdateReturn =>
  Option.match(maybeTurnStep(model), {
    onNone: () => ({ model }),
    onSome: step =>
      isBotTurn(model)
        ? {
            model,
            commands: [
              WaitForBot({
                gameId: model.gameId,
                turnNumber: model.turnNumber,
                step,
              }),
            ],
          }
        : { model },
  })

const takeHumanAction = (model: Model, action: PlayerAction): UpdateReturn =>
  isHumanTurn(model) ? scheduleBot(applyAction(model, action)) : { model }

const MARKET_KEYS = ['1', '2', '3', '4', '5']

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    CompletedRollSeed: ({ seed }) => scheduleBot(newGame(seed)),

    ClickedDeck: () => takeHumanAction(model, PlayerAction.DrewFromDeck()),

    ClickedMarketCard: ({ slot }) =>
      takeHumanAction(model, PlayerAction.TookMarketCard({ slot })),

    ClickedRoute: ({ routeId }) =>
      takeHumanAction(model, PlayerAction.ClaimedRoute({ routeId })),

    ClickedDrawTicket: () => takeHumanAction(model, PlayerAction.DrewTicket()),

    ClickedPass: () => takeHumanAction(model, PlayerAction.Passed()),

    ClickedNewGame: () => ({
      model: emptyModel(model.gameId),
      commands: [RollSeed()],
    }),

    HoveredRoute: ({ routeId }) => ({
      model: modifyFields(model, {
        maybeHoveredRouteId: () => Option.some(routeId),
      }),
    }),

    UnhoveredRoute: () => ({
      model: modifyFields(model, { maybeHoveredRouteId: () => Option.none() }),
    }),

    PressedKey: ({ key }) =>
      Match.value(key.toLowerCase()).pipe(
        Match.withReturnType<UpdateReturn>(),
        Match.when('d', () =>
          takeHumanAction(model, PlayerAction.DrewFromDeck()),
        ),
        Match.when('t', () =>
          takeHumanAction(model, PlayerAction.DrewTicket()),
        ),
        Match.when(
          (pressed: string) => MARKET_KEYS.includes(pressed),
          pressed =>
            takeHumanAction(
              model,
              PlayerAction.TookMarketCard({ slot: Number(pressed) - 1 }),
            ),
        ),
        Match.orElse(() => ({ model })),
      ),

    CompletedWaitForBot: ({ gameId, turnNumber, step }) => {
      const isStillThatTurn =
        gameId === model.gameId &&
        turnNumber === model.turnNumber &&
        Option.contains(maybeTurnStep(model), step) &&
        isBotTurn(model)
      return isStillThatTurn
        ? scheduleBot(applyAction(model, decideBotAction(model)))
        : { model }
    },
  })

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: emptyModel(0),
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
