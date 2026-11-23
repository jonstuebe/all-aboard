import { Effect } from 'effect'
import { Command, Dom } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './message'

// NOTE: The one centred "are you sure?" dialog, drawn as a ticket. A screen
// renders it only while its Model says a confirm is open, and returns
// ShowConfirmDialog alongside that change and CloseConfirmDialog alongside the
// change that ends it. Only one confirm is open at a time, so they share an id.
//
// Slots, top to bottom:
//   details  what the confirm is about (confirmEyebrow, confirmChip, or any Html)
//   title    the question
//   body     what will happen
//   actions  the buttons, on the torn-off stub at the bottom
// onDismiss is sent for Escape and for a tap outside the ticket.

export const CONFIRM_DIALOG_ID = 'confirm-dialog'
const TITLE_ID = 'confirm-dialog-title'
const BODY_ID = 'confirm-dialog-body'

export type ConfirmDialogSlots = Readonly<{
  details?: ReadonlyArray<Html>
  title: string
  body?: ReadonlyArray<Html>
  actions: ReadonlyArray<Html>
  onDismiss: Message
}>

export const ShowConfirmDialog = Command.define('ShowConfirmDialog', {
  messages: [Message.CompletedShowConfirmDialog],
  // NOTE: Lock the page only when this call opened the dialog, so a repeat
  // Show can't leave an extra lock behind after the close.
  execute: Effect.gen(function* () {
    const opened = yield* Dom.showDialog(`#${CONFIRM_DIALOG_ID}`, {
      isModal: true,
      focusSelector: '.confirm-actions .btn',
    })
    if (opened) {
      yield* Dom.lockScroll
    }
  }).pipe(
    Effect.catch(() => Effect.void),
    Effect.as(Message.CompletedShowConfirmDialog()),
  ),
})

// NOTE: The close usually runs before the next render drops the element. When
// it doesn't, releaseDialogResources reclaims the focus trap and scroll lock by id.
export const CloseConfirmDialog = Command.define('CloseConfirmDialog', {
  messages: [Message.CompletedCloseConfirmDialog],
  execute: Dom.closeDialog(`#${CONFIRM_DIALOG_ID}`).pipe(
    Effect.flatMap(released => (released ? Dom.unlockScroll : Effect.void)),
    Effect.catch(() => Dom.releaseDialogResources(CONFIRM_DIALOG_ID)),
    Effect.as(Message.CompletedCloseConfirmDialog()),
  ),
})

export const confirmDialog = (
  slots: ConfirmDialogSlots,
  h: HtmlBuilder<Message>,
): Html =>
  h.dialog(
    [
      h.Id(CONFIRM_DIALOG_ID),
      h.Class('confirm-dialog'),
      h.Role('alertdialog'),
      h.AriaModal(true),
      h.AriaLabelledBy(TITLE_ID),
      ...(slots.body === undefined ? [] : [h.AriaDescribedBy(BODY_ID)]),
      h.OnCancelPreventDefault(slots.onDismiss),
    ],
    [
      h.div([
        h.Class('confirm-scrim'),
        h.AriaHidden(true),
        h.OnClick(slots.onDismiss),
      ]),
      h.div(
        [h.Class('confirm-ticket')],
        [
          h.div(
            [h.Class('confirm-top')],
            [
              ...(slots.details === undefined
                ? []
                : [h.div([h.Class('confirm-details')], slots.details)]),
              h.h2([h.Id(TITLE_ID), h.Class('confirm-title')], [slots.title]),
              slots.body === undefined
                ? h.empty
                : h.div([h.Id(BODY_ID), h.Class('confirm-body')], slots.body),
            ],
          ),
          h.div([h.Class('confirm-actions')], slots.actions),
        ],
      ),
    ],
  )

/** A small engraved label for the details slot, like LOBBY or GAME. */
export const confirmEyebrow = (text: string, h: HtmlBuilder<Message>): Html =>
  h.span([h.Class('confirm-eyebrow')], [text])

/** A typewritten slip for the details slot, for a code or a name. */
export const confirmChip = (text: string, h: HtmlBuilder<Message>): Html =>
  h.span([h.Class('confirm-chip')], [text])
