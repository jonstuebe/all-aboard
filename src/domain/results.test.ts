import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import type { Model } from '../model'
import { playBotStep } from './bot'
import { localSeats, maybeTurnStep, newGame } from './game'
import { addResult, emptyStats, longestRoute, seatResult } from './results'

const withClaims = (
  claims: ReadonlyArray<readonly [string, number]>,
): Model => ({
  ...newGame(3, localSeats('You', 2)),
  claims: Array.map(claims, ([routeId, playerIndex]) => ({
    routeId,
    playerIndex,
  })),
})

const playOut = (seed: number): Model => {
  const step = (model: Model, moves: number): Model =>
    Option.isNone(maybeTurnStep(model)) || moves > 2000
      ? model
      : step(playBotStep(model), moves + 1)
  return step(
    newGame(
      seed,
      Array.map(localSeats('You', 3), seat => ({
        ...seat,
        kind: 'Bot' as const,
      })),
    ),
    0,
  )
}

describe('longest route', () => {
  test('follows one continuous trail and ignores branches', () => {
    // Seattle-Helena (2), Helena-Chicago (3), Chicago-New York (3), plus a
    // branch Helena-Denver (2): the longest trail is 2 + 3 + 3 = 8.
    const model = withClaims([
      ['r1', 0],
      ['r4', 0],
      ['r6', 0],
      ['r5', 0],
      ['r2', 1],
    ])
    expect(longestRoute(model, 0)).toBe(8)
    expect(longestRoute(model, 1)).toBe(3)
  })

  test('a loop can be walked all the way round', () => {
    // Seattle-Helena (2), Helena-Denver (2), Denver-Seattle (3) = 7.
    expect(
      longestRoute(
        withClaims([
          ['r1', 0],
          ['r5', 0],
          ['r2', 0],
        ]),
        0,
      ),
    ).toBe(7)
  })

  test('no routes means zero', () => {
    expect(longestRoute(withClaims([]), 0)).toBe(0)
  })
})

describe('seat results', () => {
  test('only a finished game has results, and exactly the top score wins', () => {
    expect(Option.isNone(seatResult(newGame(1, localSeats('You', 3)), 0))).toBe(
      true,
    )
    const final = playOut(21)
    const results = Array.getSomes(
      Array.map([0, 1, 2], seat => seatResult(final, seat)),
    )
    expect(results).toHaveLength(3)
    const best = Math.max(...Array.map(results, result => result.score))
    Array.forEach(results, result => {
      expect(result.isWinner).toBe(result.score === best)
      expect(result.seatCount).toBe(3)
    })
    expect(Array.some(results, result => result.rank === 1)).toBe(true)
  })

  test('stats add up', () => {
    const stats = addResult(
      addResult(emptyStats, {
        score: 30,
        rank: 1,
        isWinner: true,
        seatCount: 2,
        longestRoute: 6,
        ticketsCompleted: 2,
      }),
      {
        score: 10,
        rank: 2,
        isWinner: false,
        seatCount: 2,
        longestRoute: 4,
        ticketsCompleted: 1,
      },
    )
    expect(stats).toEqual({
      gamesPlayed: 2,
      wins: 1,
      totalScore: 40,
      longestRoute: 6,
      ticketsCompleted: 3,
    })
  })
})
