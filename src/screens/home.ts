import { Array, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'

import { MAX_SEATS, MIN_SEATS } from '../model'
import { Message } from '../message'
import { NAME_MAX_LENGTH } from '../protocol'
import { screenFrame } from './frame'

// MODEL

export const CreateState = defineTaggedUnion({
  Idle: {},
  Creating: {},
  Failed: { reason: Schema.String },
})
export type CreateState = typeof CreateState.Type

export const Home = Schema.Struct({
  joinCode: Schema.String,
  create: CreateState,
})
export type Home = typeof Home.Type

export const emptyHome: Home = { joinCode: '', create: CreateState.Idle() }

export type HomeInputs = Readonly<{
  playerName: string
  seatCount: number
}>

// VIEW

const nameField = (inputs: HomeInputs, h: HtmlBuilder<Message>): Html =>
  h.label(
    [h.Class('field')],
    [
      h.span([h.Class('field-label')], ['Your name']),
      h.input([
        h.Class('field-input'),
        h.Type('text'),
        h.Value(inputs.playerName),
        h.Placeholder('Conductor'),
        h.Attribute('maxlength', String(NAME_MAX_LENGTH)),
        h.Attribute('autocomplete', 'nickname'),
        h.OnInput(value => Message.UpdatedNameInput({ value })),
      ]),
    ],
  )

const seatCountPicker = (
  inputs: HomeInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('seat-picker'), h.Role('group'), h.AriaLabel('Players at the table')],
    Array.map(Array.range(MIN_SEATS, MAX_SEATS), count =>
      h.button(
        [
          h.Class(`seat-count${count === inputs.seatCount ? ' is-picked' : ''}`),
          h.Type('button'),
          h.AriaPressed(String(count === inputs.seatCount)),
          h.OnClick(Message.ClickedSeatCount({ count })),
        ],
        [String(count)],
      ),
    ),
  )

export const newGameView = (
  home: Home,
  inputs: HomeInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.Class('panel menu-card'), h.AriaLabelledBy('new-game-title')],
    [
      h.h2([h.Id('new-game-title'), h.Class('menu-heading')], ['New game']),
      nameField(inputs, h),
      h.div(
        [h.Class('menu-actions')],
        [
          h.button(
            [
              h.Class('btn btn-primary'),
              h.Type('button'),
              h.Disabled(home.create._tag === 'Creating'),
              h.OnClick(Message.ClickedNewFriendGame()),
            ],
            [
              home.create._tag === 'Creating'
                ? 'Opening a lobby…'
                : 'New game with friends',
            ],
          ),
          CreateState.match(home.create, {
            Idle: () => h.empty,
            Creating: () => h.empty,
            Failed: ({ reason }) =>
              h.p([h.Class('menu-error'), h.Role('alert')], [reason]),
          }),
        ],
      ),
      h.div(
        [h.Class('menu-actions')],
        [
          h.span([h.Class('field-label')], ['Players with bots']),
          seatCountPicker(inputs, h),
          h.button(
            [
              h.Class('btn'),
              h.Type('button'),
              h.OnClick(Message.ClickedNewBotGame()),
            ],
            ['New game with bots'],
          ),
        ],
      ),
      h.form(
        [h.Class('join-form'), h.OnSubmit(Message.SubmittedJoinCode())],
        [
          h.label(
            [h.Class('field')],
            [
              h.span([h.Class('field-label')], ['Have an invite code?']),
              h.input([
                h.Class('field-input code-input'),
                h.Type('text'),
                h.Value(home.joinCode),
                h.Placeholder('TRAIN-4K7'),
                h.Attribute('autocapitalize', 'characters'),
                h.OnInput(value => Message.UpdatedJoinCode({ value })),
              ]),
            ],
          ),
          h.button([h.Class('btn'), h.Type('submit')], ['Join']),
        ],
      ),
    ],
  )

export const homeView = (
  home: Home,
  inputs: HomeInputs,
  extras: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html => screenFrame([newGameView(home, inputs, h), ...extras], h)
