import { Option, Result, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { playBotStep } from './domain/bot'
import { projectView } from './domain/clientView'
import {
  PlayerAction,
  actAs,
  emptyModel,
  isBotTurn,
  localSeats,
  maybeTurnStep,
  newGame,
} from './domain/game'
import { Model as Game } from './model'
import {
  type Table,
  TableMode,
  TableUi,
  emptyTableUi,
  makeTable,
} from './table'

// NOTE: A bot-only game runs entirely on this device and works offline. The
// person always sits in seat 0.

export const LOCAL_SEAT = 0

export const LocalTable = Schema.Struct({
  game: Game,
  ui: TableUi,
  seatCount: Schema.Number,
  playerName: Schema.String,
})
export type LocalTable = typeof LocalTable.Type

export const emptyLocalTable = (
  seatCount: number,
  playerName: string,
): LocalTable => ({
  game: emptyModel(0),
  ui: emptyTableUi,
  seatCount,
  playerName,
})

export const dealLocalTable = (table: LocalTable, seed: number): LocalTable =>
  modifyFields(table, {
    game: () => newGame(seed, localSeats(table.playerName, table.seatCount)),
    ui: () => emptyTableUi,
  })

export const actLocally = (
  table: LocalTable,
  action: PlayerAction,
): LocalTable =>
  Result.match(actAs(table.game, LOCAL_SEAT, action), {
    onSuccess: game =>
      modifyFields(table, {
        game: () => game,
        ui: ui => modifyFields(ui, { maybeNotice: () => Option.none() }),
      }),
    onFailure: notice =>
      modifyFields(table, {
        ui: ui => modifyFields(ui, { maybeNotice: () => Option.some(notice) }),
      }),
  })

export const playLocalBot = (table: LocalTable): LocalTable =>
  isBotTurn(table.game)
    ? modifyFields(table, { game: () => playBotStep(table.game) })
    : table

export const isLocalViewerTurn = (table: LocalTable): boolean =>
  Option.isSome(maybeTurnStep(table.game)) &&
  table.game.currentPlayerIndex === LOCAL_SEAT

export const localTableView = (table: LocalTable): Table =>
  makeTable(projectView(table.game, LOCAL_SEAT), table.ui, TableMode.Local())
