import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import type { Model } from '../model'
import {
  CARDS_PER_COLOR,
  CARD_COLORS,
  ROUTES,
  STARTING_TRAINS,
  WILD_CARDS,
  routeById,
} from './board'
import { playBotStep } from './bot'
import {
  PlayerAction,
  actAs,
  applyAction,
  canDrawFromDeck,
  isRouteClosedFor,
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

// Every seat keeps all its opening tickets, so play can begin.
const keepAllStartTickets = (model: Model): Model =>
  Array.reduce(model.players, model, (current, player, seatIndex) =>
    accepted(
      actAs(
        current,
        seatIndex,
        PlayerAction.KeptTickets({ ticketIds: player.offeredTicketIds }),
      ),
    ),
  )

const dealt = (seed: number, seatCount: number): Model =>
  keepAllStartTickets(newGame(seed, localSeats('You', seatCount)))

describe('destination tickets', () => {
  test('everyone is dealt 3 tickets, keeps at least 2, and the rest go to the bottom', () => {
    const start = newGame(5, localSeats('You', 3))
    expect(Option.getOrThrow(maybeTurnStep(start))).toBe('ChoosingStartTickets')
    Array.forEach(start.players, player => {
      expect(player.offeredTicketIds).toHaveLength(3)
      expect(player.ticketIds).toHaveLength(0)
    })
    const [first, second, third] = start.players[1]!.offeredTicketIds
    expect(
      Result.isFailure(
        actAs(start, 1, PlayerAction.KeptTickets({ ticketIds: [first!] })),
      ),
    ).toBe(true)
    const afterSeat1 = accepted(
      actAs(
        start,
        1,
        PlayerAction.KeptTickets({ ticketIds: [first!, second!] }),
      ),
    )
    expect(afterSeat1.players[1]!.ticketIds).toEqual([first, second])
    expect(afterSeat1.players[1]!.offeredTicketIds).toEqual([])
    expect(Array.last(afterSeat1.ticketPile)).toEqual(Option.some(third))
    expect(Option.getOrThrow(maybeTurnStep(afterSeat1))).toBe(
      'ChoosingStartTickets',
    )
    expect(
      Result.isFailure(actAs(afterSeat1, 0, PlayerAction.DrewFromDeck())),
    ).toBe(true)
  })

  test('play starts once every seat has picked', () => {
    const start = dealt(5, 3)
    expect(Option.getOrThrow(maybeTurnStep(start))).toBe('ChoosingAction')
    expect(start.currentPlayerIndex).toBe(0)
    Array.forEach(start.players, player =>
      expect(player.ticketIds).toHaveLength(3),
    )
  })

  test('a ticket draw shows 3, keeps at least 1, and ends the turn', () => {
    const start = dealt(5, 3)
    const pileBefore = start.ticketPile
    const drawn = accepted(applyAction(start, PlayerAction.DrewTicket()))
    const offered = drawn.players[0]!.offeredTicketIds
    expect(offered).toEqual(Array.take(pileBefore, 3))
    expect(Option.getOrThrow(maybeTurnStep(drawn))).toBe('KeepingTickets')
    expect(drawn.currentPlayerIndex).toBe(0)
    expect(
      Result.isFailure(applyAction(drawn, PlayerAction.DrewFromDeck())),
    ).toBe(true)
    expect(
      Result.isFailure(
        applyAction(drawn, PlayerAction.KeptTickets({ ticketIds: [] })),
      ),
    ).toBe(true)
    const kept = accepted(
      applyAction(
        drawn,
        PlayerAction.KeptTickets({ ticketIds: [offered[1]!] }),
      ),
    )
    expect(kept.players[0]!.ticketIds).toContain(offered[1])
    expect(kept.players[0]!.offeredTicketIds).toEqual([])
    expect(kept.currentPlayerIndex).toBe(1)
    expect(kept.ticketPile).toEqual([
      ...Array.drop(pileBefore, 3),
      offered[0],
      offered[2],
    ])
  })

  test('you can only keep tickets you were offered', () => {
    const start = newGame(5, localSeats('You', 3))
    const notMine = start.players[1]!.offeredTicketIds
    expect(
      Result.isFailure(
        actAs(start, 0, PlayerAction.KeptTickets({ ticketIds: notMine })),
      ),
    ).toBe(true)
  })
})

describe('turn rules', () => {
  test('drawing from the deck twice ends the turn', () => {
    const start = dealt(5, 3)
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
    const start = dealt(5, 3)
    const longest = ROUTES.find(route => route.length === 4)!
    const after = applyAction(
      start,
      PlayerAction.ClaimedRoute({ routeId: longest.id }),
    )
    expect(Result.isFailure(after)).toBe(true)
  })

  test('an unknown route is rejected rather than crashing', () => {
    const start = dealt(5, 3)
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
        expect(player.offeredTicketIds).toHaveLength(3),
      )
    })
  })
})

describe('double tracks', () => {
  const twinPairs = Array.filter(ROUTES, route => route.lane === -1)
  const withClaim = (seatCount: number, playerIndex: number): Model => ({
    ...newGame(5, allBots(seatCount)),
    claims: [{ routeId: 'r10', playerIndex }],
  })

  test('the second track stays closed with fewer than 4 players', () => {
    const model = withClaim(3, 1)
    expect(isRouteClosedFor(model, 0, routeById('r11'))).toBe(true)
  })

  test('the second track opens with 4 or more players, but not to its twin owner', () => {
    const model = withClaim(4, 1)
    expect(isRouteClosedFor(model, 0, routeById('r11'))).toBe(false)
    expect(isRouteClosedFor(model, 1, routeById('r11'))).toBe(true)
  })

  test.each([
    [3, 3],
    [21, 3],
    [8, 4],
    [33, 5],
  ])('bots respect the pair rules (seed %i, %i seats)', (seed, seatCount) => {
    const final = Option.getOrThrow(Array.last(playOut(seed, seatCount)))
    const ownerOf = (routeId: string) =>
      Array.findFirst(final.claims, claim => claim.routeId === routeId)
    Array.forEach(twinPairs, route => {
      const pair = [ownerOf(route.id), ownerOf(route.twin ?? '')]
      const owners = Array.getSomes(pair).map(claim => claim.playerIndex)
      if (seatCount < 4) {
        expect(owners.length).toBeLessThanOrEqual(1)
      }
      expect(new Set(owners).size).toBe(owners.length)
    })
  })
})
