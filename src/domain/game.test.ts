import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import type { Model } from '../model'
import {
  CARDS_PER_COLOR,
  CARD_COLORS,
  ROUTES,
  STARTING_TRAINS,
  WILD_CARDS,
} from './board'
import { decideBotAction } from './bot'
import {
  PlayerAction,
  applyAction,
  canDrawFromDeck,
  maybeTurnStep,
  newGame,
  standings,
} from './game'

const TOTAL_CARDS = CARD_COLORS.length * CARDS_PER_COLOR + WILD_CARDS

const cardsInPlay = (model: Model): number =>
  model.deck.length +
  model.discard.length +
  Array.getSomes(model.market).length +
  Array.reduce(model.players, 0, (sum, player) => sum + player.hand.length)

const playOut = (seed: number): ReadonlyArray<Model> => {
  const step = (
    model: Model,
    history: ReadonlyArray<Model>,
  ): ReadonlyArray<Model> =>
    Option.isNone(maybeTurnStep(model)) || history.length > 2000
      ? Array.append(history, model)
      : step(
          applyAction(model, decideBotAction(model)),
          Array.append(history, model),
        )
  return step(newGame(seed), [])
}

describe('a full game played by bots in every seat', () => {
  test.each([1, 7, 42, 1234, 99999])(
    'seed %i finishes with consistent state',
    seed => {
      const history = playOut(seed)
      const final = history[history.length - 1]!

      expect(final.phase._tag).toBe('GameOver')
      Array.forEach(history, model =>
        expect(cardsInPlay(model)).toBe(TOTAL_CARDS),
      )

      const claimedLength = Array.reduce(final.claims, 0, (sum, claim) => {
        const route = ROUTES.find(candidate => candidate.id === claim.routeId)!
        return sum + route.length
      })
      const trainsUsed = Array.reduce(
        final.players,
        0,
        (sum, player) => sum + (STARTING_TRAINS - player.trains),
      )
      expect(trainsUsed).toBe(claimedLength)
      expect(
        Array.dedupe(Array.map(final.claims, claim => claim.routeId)).length,
      ).toBe(final.claims.length)
      expect(standings(final)).toHaveLength(3)
    },
  )
})

describe('turn rules', () => {
  test('drawing from the deck twice ends the turn', () => {
    const start = newGame(5)
    expect(canDrawFromDeck(start)).toBe(true)
    const afterOne = applyAction(start, PlayerAction.DrewFromDeck())
    expect(afterOne.currentPlayerIndex).toBe(0)
    expect(Option.getOrThrow(maybeTurnStep(afterOne))).toBe('DrawingSecondCard')
    const afterTwo = applyAction(afterOne, PlayerAction.DrewFromDeck())
    expect(afterTwo.currentPlayerIndex).toBe(1)
    expect(afterTwo.players[0]!.hand).toHaveLength(6)
  })

  test('claiming a route you cannot afford leaves a notice and keeps the turn', () => {
    const start = newGame(5)
    const longest = ROUTES.find(route => route.length === 4)!
    const after = applyAction(
      start,
      PlayerAction.ClaimedRoute({ routeId: longest.id }),
    )
    expect(after.currentPlayerIndex).toBe(0)
    expect(Option.isSome(after.maybeNotice)).toBe(true)
  })
})
