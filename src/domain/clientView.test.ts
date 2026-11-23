import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import type { Model } from '../model'
import { playBotStep } from './bot'
import { projectView } from './clientView'
import { PlayerAction, actAs, handSeatToBot, localSeats, newGame } from './game'

const humans = (seatCount: number) =>
  Array.map(localSeats('Ada', seatCount), (seat, index) => ({
    ...seat,
    name: `Seat ${index}`,
    kind: 'Human' as const,
  }))

const advance = (model: Model, steps: number): Model =>
  Array.reduce(Array.range(1, steps), model, current => playBotStep(current))

// Each seat picks its opening tickets (one bot step per seat).
const dealt = (seed: number, seatCount: number): Model =>
  advance(newGame(seed, humans(seatCount)), seatCount)

const FORBIDDEN_KEYS = [
  'rngState',
  'deck',
  'ticketPile',
  'gameId',
  'maybeSelfText',
]

const allKeys = (value: unknown): ReadonlyArray<string> =>
  typeof value !== 'object' || value === null
    ? []
    : Array.flatMap(Object.entries(value), ([key, inner]) => [
        key,
        ...allKeys(inner),
      ])

describe('ClientView never leaks hidden information', () => {
  test.each([2, 3, 4, 5])('%i seats, mid-game', seatCount => {
    const model = advance(newGame(77, humans(seatCount)), 23)
    Array.forEach(Array.range(0, seatCount - 1), viewerIndex => {
      const view = projectView(model, viewerIndex)
      const json = JSON.parse(JSON.stringify(view))
      const keys = allKeys(json)

      Array.forEach(FORBIDDEN_KEYS, key => expect(keys).not.toContain(key))
      expect(JSON.stringify(view)).not.toContain(String(model.rngState))

      Array.forEach(view.players, (player, playerIndex) => {
        const real = model.players[playerIndex]!
        expect(player.handCount).toBe(real.hand.length)
        expect(player.ticketCount).toBe(real.ticketIds.length)
        if (playerIndex === viewerIndex) {
          expect(player.hand).toEqual(real.hand)
          expect(player.ticketIds).toEqual(real.ticketIds)
          expect(player.offeredTicketIds).toEqual(real.offeredTicketIds)
        } else {
          expect(player.hand).toEqual([])
          expect(player.ticketIds).toEqual([])
          expect(player.offeredTicketIds).toEqual([])
        }
      })
      expect(view.deckCount).toBe(model.deck.length)
      expect(view.ticketPileCount).toBe(model.ticketPile.length)
    })
  })

  test('hidden state that differs between two games gives identical views', () => {
    const model = advance(newGame(5, humans(3)), 10)
    const reshuffled: Model = {
      ...model,
      rngState: model.rngState + 12345,
      deck: Array.reverse(model.deck),
      ticketPile: Array.reverse(model.ticketPile),
      players: Array.map(model.players, (player, index) =>
        index === 0
          ? player
          : {
              ...player,
              hand: Array.map(player.hand, () => 'Wild' as const),
              ticketIds: Array.reverse(player.ticketIds),
            },
      ),
    }
    expect(projectView(reshuffled, 0)).toEqual(projectView(model, 0))
  })

  test('private log text reaches only the actor', () => {
    const start = dealt(9, 3)
    const drawn = Result.getOrThrow(
      actAs(start, 0, PlayerAction.DrewFromDeck()),
    )
    const lastText = (viewerIndex: number): string =>
      Option.getOrThrow(Array.last(projectView(drawn, viewerIndex).log)).text
    expect(lastText(0)).toMatch(/^You drew an? .* card from the deck\.$/)
    expect(lastText(1)).toBe('Seat 0 drew from the deck.')
    Array.forEach(['red', 'blue', 'green', 'yellow', 'black', 'wild'], color =>
      expect(lastText(1)).not.toContain(color),
    )
  })
})

test('opening ticket offers stay private to their seat', () => {
  const start = newGame(12, humans(3))
  Array.forEach(Array.range(0, 2), viewerIndex => {
    const view = projectView(start, viewerIndex)
    Array.forEach(view.players, (player, playerIndex) => {
      expect(player.isPickingTickets).toBe(true)
      expect(player.offeredTicketIds).toEqual(
        playerIndex === viewerIndex
          ? start.players[playerIndex]!.offeredTicketIds
          : [],
      )
    })
  })
})

describe('actor check', () => {
  test('rejects a seat acting out of turn and leaves the game unchanged', () => {
    const start = dealt(3, 3)
    expect(start.currentPlayerIndex).toBe(0)
    Array.forEach([1, 2, 7, -1], seatIndex => {
      const result = actAs(start, seatIndex, PlayerAction.DrewFromDeck())
      expect(Result.isFailure(result)).toBe(true)
    })
  })

  test('accepts the current seat', () => {
    const start = dealt(3, 3)
    expect(Result.isSuccess(actAs(start, 0, PlayerAction.DrewFromDeck()))).toBe(
      true,
    )
  })

  test('rejects any action once the game is over', () => {
    const over = Array.reduce(
      Array.range(1, 3000),
      newGame(4, humans(2)),
      current => playBotStep(current),
    )
    expect(over.phase._tag).toBe('GameOver')
    expect(
      Result.isFailure(
        actAs(over, over.currentPlayerIndex, PlayerAction.Passed()),
      ),
    ).toBe(true)
  })

  test('a seat handed to a bot keeps its hand and tickets', () => {
    const start = newGame(3, humans(3))
    const handed = handSeatToBot(start, 1)
    expect(handed.players[1]!.kind).toBe('LeftToBot')
    expect(handed.players[1]!.hand).toEqual(start.players[1]!.hand)
    expect(handed.players[1]!.ticketIds).toEqual(start.players[1]!.ticketIds)
    expect(Option.isSome(Array.last(handed.log))).toBe(true)
  })
})
