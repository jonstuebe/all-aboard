import type { Html, HtmlBuilder } from 'foldkit/html'

import { confirmChip, confirmDialog, confirmEyebrow } from './confirmDialog'
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
    Online: ({ ping }) => [
      pingButton(ping, h),
      table.phase._tag === 'Playing'
        ? quietButton('Leave game', Message.ClickedLeaveGame(), h)
        : h.empty,
      quietButton('Menu', Message.ClickedMenu(), h),
    ],
  })

/** Leaving an online game asks once, in the shared confirm dialog. */
export const leaveDialogView = (table: Table, h: HtmlBuilder<Message>): Html =>
  TableMode.match(table.mode, {
    Local: () => h.empty,
    Online: ({ code, isConfirmingLeave }) =>
      table.phase._tag === 'Playing' && isConfirmingLeave
        ? confirmDialog(
            {
              details: [confirmEyebrow('Game', h), confirmChip(code, h)],
              title: 'Leave this game?',
              body: [h.p([], ['A bot takes your seat and plays it out.'])],
              actions: [
                h.button(
                  [
                    h.Class('btn btn-cream'),
                    h.Type('button'),
                    h.OnClick(Message.CancelledLeaveGame()),
                  ],
                  ['Stay'],
                ),
                h.button(
                  [
                    h.Class('btn btn-red'),
                    h.Type('button'),
                    h.OnClick(Message.ConfirmedLeaveGame()),
                  ],
                  ['Leave'],
                ),
              ],
              onDismiss: Message.CancelledLeaveGame(),
            },
            h,
          )
        : h.empty,
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
