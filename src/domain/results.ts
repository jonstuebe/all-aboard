import { Array, Number, Option, Schema, pipe } from 'effect'

import type { Model } from '../model'
import { ROUTES, type Route } from './board'
import { standings } from './game'

// NOTE: What one seat takes away from a finished game, for the stats on the
// main menu. Server games and local bot games both build it from the final
// Model, so stats mean the same thing whichever way the game was played.

export const SeatResult = Schema.Struct({
  score: Schema.Number,
  rank: Schema.Number,
  isWinner: Schema.Boolean,
  seatCount: Schema.Number,
  longestRoute: Schema.Number,
  ticketsCompleted: Schema.Number,
})
export type SeatResult = typeof SeatResult.Type

export const Stats = Schema.Struct({
  gamesPlayed: Schema.Number,
  wins: Schema.Number,
  totalScore: Schema.Number,
  longestRoute: Schema.Number,
  ticketsCompleted: Schema.Number,
})
export type Stats = typeof Stats.Type

export const emptyStats: Stats = {
  gamesPlayed: 0,
  wins: 0,
  totalScore: 0,
  longestRoute: 0,
  ticketsCompleted: 0,
}

export const addResult = (stats: Stats, result: SeatResult): Stats => ({
  gamesPlayed: stats.gamesPlayed + 1,
  wins: stats.wins + (result.isWinner ? 1 : 0),
  totalScore: stats.totalScore + result.score,
  longestRoute: Math.max(stats.longestRoute, result.longestRoute),
  ticketsCompleted: stats.ticketsCompleted + result.ticketsCompleted,
})

export const winRate = (stats: Stats): number =>
  stats.gamesPlayed === 0 ? 0 : stats.wins / stats.gamesPlayed

export const averageScore = (stats: Stats): number =>
  stats.gamesPlayed === 0 ? 0 : stats.totalScore / stats.gamesPlayed

// LONGEST ROUTE

// NOTE: The longest continuous trail through a seat's own routes, counted in
// train cars. Each route is used at most once; cities may repeat. The board
// is small, so a plain depth-first search over the seat's routes is enough.
export const longestRoute = (model: Model, seatIndex: number): number => {
  const owned: ReadonlyArray<Route> = Array.filter(ROUTES, route =>
    Array.some(
      model.claims,
      claim => claim.routeId === route.id && claim.playerIndex === seatIndex,
    ),
  )
  const walk = (city: string, used: ReadonlyArray<string>): number =>
    pipe(
      owned,
      Array.filter(
        route =>
          !Array.contains(used, route.id) &&
          (route.from === city || route.to === city),
      ),
      Array.map(
        route =>
          route.length +
          walk(route.from === city ? route.to : route.from, [...used, route.id]),
      ),
      Array.reduce(0, Number.max),
    )
  const cities = Array.dedupe(Array.flatMap(owned, route => [route.from, route.to]))
  return Array.reduce(Array.map(cities, city => walk(city, [])), 0, Number.max)
}

export const seatResult = (
  model: Model,
  seatIndex: number,
): Option.Option<SeatResult> => {
  if (model.phase._tag !== 'GameOver') {
    return Option.none()
  }
  const ranked = standings(model)
  return pipe(
    Array.findFirstIndex(ranked, standing => standing.playerIndex === seatIndex),
    Option.flatMap(position =>
      Option.map(Array.get(ranked, position), standing => {
        const best = Option.getOrElse(
          Option.map(Array.head(ranked), top => top.total),
          () => standing.total,
        )
        const rank =
          1 + Array.filter(ranked, other => other.total > standing.total).length
        return {
          score: standing.total,
          rank,
          isWinner: standing.total === best,
          seatCount: model.players.length,
          longestRoute: longestRoute(model, seatIndex),
          ticketsCompleted: standing.completedTickets,
        }
      }),
    ),
  )
}
