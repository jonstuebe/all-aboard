import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import type { Model } from '../model'
import {
  CARDS_PER_COLOR,
  CARD_COLORS,
  ROUTES,
  STARTING_TRAINS,
  WILD_CARDS,
} from './board'
import { playBotStep } from './bot'
import {
  PlayerAction,
  applyAction,
  canDrawFromDeck,
  localSeats,
  maybeTurnStep,
  newGame,
  standings,
} from './game'

const allBots = (seatCount: number) =>
  Array.map(localSeats('You', seatCount), seat => ({
    ...seat,
    kind: 'Bot' as const,
  }))

const accepted = (result: Result.Result<Model, string>): Model =>
  Result.getOrThrowWith(result, reason => new Error(reason))

const TOTAL_CARDS = CARD_COLORS.length * CARDS_PER_COLOR + WILD_CARDS

const cardsInPlay = (model: Model): number =>
  model.deck.length +
  model.discard.length +
  Array.getSomes(model.market).length +
  Array.reduce(model.players, 0, (sum, player) => sum + player.hand.length)

const playOut = (seed: number, seatCount = 3): ReadonlyArray<Model> => {
  const step = (
    model: Model,
    history: ReadonlyArray<Model>,
  ): ReadonlyArray<Model> =>
    Option.isNone(maybeTurnStep(model)) || history.length > 2000
      ? Array.append(history, model)
      : step(playBotStep(model), Array.append(history, model))
  return step(newGame(seed, allBots(seatCount)), [])
}

describe('a full game played by bots in every seat', () => {
  test.each([
    [1, 3],
    [7, 3],
    [42, 3],
    [1234, 3],
    [99999, 3],
    [11, 2],
    [12, 4],
    [13, 5],
    [14, 5],
  ])('seed %i with %i seats finishes with consistent state', (seed, seats) => {
    const history = playOut(seed, seats)
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
    expect(standings(final)).toHaveLength(seats)
  })
})

describe('turn rules', () => {
  test('drawing from the deck twice ends the turn', () => {
    const start = newGame(5, localSeats('You', 3))
    expect(canDrawFromDeck(start)).toBe(true)
    const afterOne = accepted(applyAction(start, PlayerAction.DrewFromDeck()))
    expect(afterOne.currentPlayerIndex).toBe(0)
    expect(Option.getOrThrow(maybeTurnStep(afterOne))).toBe('DrawingSecondCard')
    const afterTwo = accepted(
      applyAction(afterOne, PlayerAction.DrewFromDeck()),
    )
    expect(afterTwo.currentPlayerIndex).toBe(1)
    expect(afterTwo.players[0]!.hand).toHaveLength(6)
  })

  test('claiming a route you cannot afford is rejected with a reason', () => {
    const start = newGame(5, localSeats('You', 3))
    const longest = ROUTES.find(route => route.length === 4)!
    const after = applyAction(
      start,
      PlayerAction.ClaimedRoute({ routeId: longest.id }),
    )
    expect(Result.isFailure(after)).toBe(true)
  })

  test('an unknown route is rejected rather than crashing', () => {
    const start = newGame(5, localSeats('You', 3))
    const after = applyAction(
      start,
      PlayerAction.ClaimedRoute({ routeId: 'nope' }),
    )
    expect(Result.isFailure(after)).toBe(true)
  })

  test('seats are dealt for every supported table size', () => {
    Array.forEach([2, 3, 4, 5], seatCount => {
      const start = newGame(3, localSeats('You', seatCount))
      expect(start.players).toHaveLength(seatCount)
      expect(cardsInPlay(start)).toBe(TOTAL_CARDS)
      Array.forEach(start.players, player =>
        expect(player.ticketIds.length).toBeGreaterThan(0),
      )
    })
  })
})
