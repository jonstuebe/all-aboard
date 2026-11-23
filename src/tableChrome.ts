import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './message'
import { PingStatus, type Table, TableMode } from './table'

// NOTE: The buttons around the table that differ between a local bot game and
// an online game live here, so view.ts stays one rendering path for both.

export const tableTitle = (isViewerTurn: boolean): string =>
  isViewerTurn ? 'Your turn · All Aboard' : 'All Aboard'

const quietButton = (
  label: string,
  message: Message,
  h: HtmlBuilder<Message>,
  isDisabled = false,
): Html =>
  h.button(
    [
      h.Class('btn btn-cream btn-compact topbar-btn'),
      h.Type('button'),
      h.Disabled(isDisabled),
      h.OnClick(message),
    ],
    [label],
  )

const pingButton = (ping: PingStatus, h: HtmlBuilder<Message>): Html =>
  PingStatus.match(ping, {
    Hidden: () => h.empty,
    Ready: () => quietButton('Ping', Message.ClickedPing(), h),
    Sending: () => quietButton('Pinging…', Message.ClickedPing(), h, true),
    Waiting: ({ minutesLeft }) =>
      quietButton(`Ping in ${minutesLeft}m`, Message.ClickedPing(), h, true),
  })

export const tableActionsView = (
  table: Table,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  TableMode.match(table.mode, {
    Local: () => [
      quietButton('Menu', Message.ClickedMenu(), h),
      quietButton('New game', Message.ClickedNewGame(), h),
    ],
    Online: ({ ping, isConfirmingLeave }) =>
      table.phase._tag === 'Playing' && isConfirmingLeave
        ? [
            h.span([h.Class('leave-confirm')], ['A bot will take your seat.']),
            quietButton('Leave', Message.ConfirmedLeaveGame(), h),
            quietButton('Stay', Message.CancelledLeaveGame(), h),
          ]
        : [
            pingButton(ping, h),
            table.phase._tag === 'Playing'
              ? quietButton('Leave game', Message.ClickedLeaveGame(), h)
              : h.empty,
            quietButton('Menu', Message.ClickedMenu(), h),
          ],
  })

export const resultsActionView = (
  table: Table,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Class('btn btn-red'),
      h.Type('button'),
      h.OnClick(
        TableMode.match(table.mode, {
          Local: () => Message.ClickedNewGame(),
          Online: () => Message.ClickedRematch(),
        }),
      ),
    ],
    [
      TableMode.match(table.mode, {
        Local: () => 'Play again',
        Online: () => 'Rematch',
      }),
    ],
  )
