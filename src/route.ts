import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion, literal, slash, string } from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  Home: {},
  Game: { code: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home))

const gameRouter = pipe(
  literal('g'),
  slash(string('code')),
  Route.mapTo(AppRoute.Game),
)

export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(gameRouter, homeRouter),
  AppRoute.NotFound,
)

export const gamePath = (code: string): string =>
  `/g/${encodeURIComponent(code)}`
