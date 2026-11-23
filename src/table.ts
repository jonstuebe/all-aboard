import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { ClientView } from './domain/clientView'

// NOTE: TableUi is what the person at the table is doing (hovering a route,
// reading a rejected-move notice). It never enters the game Model, so the
// server and the rules don't see it, and a notice only reaches the actor.

// NOTE: On a phone the draw row, the hand and the tickets share one dock
// under the map, and dockTab picks which of them shows. Wider screens show
// all three and ignore it.
export const DockTab = Schema.Literals(['Draw', 'Hand', 'Tickets'])
export type DockTab = typeof DockTab.Type

export const TableUi = Schema.Struct({
  maybeHoveredRouteId: Schema.Option(Schema.String),
  maybeNotice: Schema.Option(Schema.String),
  dockTab: DockTab,
})
export type TableUi = typeof TableUi.Type

export const emptyTableUi: TableUi = {
  maybeHoveredRouteId: Option.none(),
  maybeNotice: Option.none(),
  dockTab: 'Draw',
}

export const PingStatus = defineTaggedUnion({
  Hidden: {},
  Ready: {},
  Sending: {},
  Waiting: { minutesLeft: Schema.Number },
})
export type PingStatus = typeof PingStatus.Type

export const TableMode = defineTaggedUnion({
  Local: {},
  Online: {
    code: Schema.String,
    ping: PingStatus,
    isConfirmingLeave: Schema.Boolean,
  },
})
export type TableMode = typeof TableMode.Type

export type Table = ClientView & TableUi & Readonly<{ mode: TableMode }>

export const makeTable = (
  view: ClientView,
  ui: TableUi,
  mode: TableMode,
): Table => ({ ...view, ...ui, mode })
