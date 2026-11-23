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

const TABLE_MENU_ID = 'table-menu'

const menuItem = (
  label: string,
  message: Message,
  h: HtmlBuilder<Message>,
  options: Readonly<{ isDisabled?: boolean; isWarning?: boolean }> = {},
): Html =>
  h.button(
    [
      h.Class(
        `table-menu-item${options.isWarning === true ? ' is-warning' : ''}`,
      ),
      h.Type('button'),
      h.Role('menuitem'),
      h.Disabled(options.isDisabled === true),
      h.Popovertarget(TABLE_MENU_ID),
      h.Popovertargetaction('hide'),
      h.OnClick(message),
    ],
    [label],
  )

const pingMenuItem = (ping: PingStatus, h: HtmlBuilder<Message>): Html =>
  PingStatus.match(ping, {
    Hidden: () => h.empty,
    Ready: () => menuItem('Ping', Message.ClickedPing(), h),
    Sending: () =>
      menuItem('Pinging…', Message.ClickedPing(), h, { isDisabled: true }),
    Waiting: ({ minutesLeft }) =>
      menuItem(`Ping in ${minutesLeft}m`, Message.ClickedPing(), h, {
        isDisabled: true,
      }),
  })

const menuIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'

// NOTE: On a phone the table's buttons fold into one menu button. The list is
// a native popover, so a tap outside or Escape closes it without any state in
// the Model; each item closes it too as it sends its Message. Wider screens
// keep the plain buttons (tableActionsView) and hide this.
export const tableMenuView = (
  table: Table,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.button([
    h.Class('table-menu-button'),
    h.Type('button'),
    h.AriaLabel('Game menu'),
    h.Popovertarget(TABLE_MENU_ID),
    h.InnerHTML(menuIcon),
  ]),
  h.div(
    [
      h.Id(TABLE_MENU_ID),
      h.Class('table-menu'),
      h.Popover('auto'),
      h.Role('menu'),
    ],
    TableMode.match(table.mode, {
      Local: () => [
        menuItem('New game', Message.ClickedNewGame(), h),
        menuItem('Main menu', Message.ClickedMenu(), h),
      ],
      Online: ({ ping }) => [
        pingMenuItem(ping, h),
        menuItem('Main menu', Message.ClickedMenu(), h),
        table.phase._tag === 'Playing'
          ? menuItem('Leave game', Message.ClickedLeaveGame(), h, {
              isWarning: true,
            })
          : h.empty,
      ],
    }),
  ),
]

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
