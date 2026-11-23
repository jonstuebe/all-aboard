import { Array, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { Message } from '../message'
import { MAX_SEATS, MIN_SEATS } from '../model'
import { NAME_MAX_LENGTH } from '../protocol'
import { screenFrame } from './frame'

// NOTE: The home screen is a printed-ticket wizard that asks one question per
// step: your name (skipped once this device remembers one), how you want to
// play, then the player count or the invite code. "Play with friends" starts
// a lobby straight from the mode step.

// MODEL

export const CreateState = defineTaggedUnion({
  Idle: {},
  Creating: {},
  Failed: { reason: Schema.String },
})
export type CreateState = typeof CreateState.Type

export const WizardStep = Schema.Literals(['Name', 'Mode', 'Bots', 'Join'])
export type WizardStep = typeof WizardStep.Type

/** Which way the last step change went, so the new step slides in from that side. */
export const StepDirection = Schema.Literals(['Forward', 'Back'])
export type StepDirection = typeof StepDirection.Type

export const Home = Schema.Struct({
  joinCode: Schema.String,
  create: CreateState,
  step: WizardStep,
  direction: StepDirection,
  /** 'Mode' when the device already remembered a name, so 'Mode' has no Back. */
  firstStep: WizardStep,
})
export type Home = typeof Home.Type

/** A fresh wizard: it opens on the name step only when no name is remembered. */
export const homeFor = (rememberedName: string): Home => {
  const firstStep: WizardStep = rememberedName.trim() === '' ? 'Name' : 'Mode'
  return {
    joinCode: '',
    create: CreateState.Idle(),
    step: firstStep,
    direction: 'Forward',
    firstStep,
  }
}

export type HomeInputs = Readonly<{
  playerName: string
  seatCount: number
}>

// TRANSITIONS

const goTo = (home: Home, step: WizardStep, direction: StepDirection): Home =>
  modifyFields(home, {
    step: () => step,
    direction: () => direction,
    create: () => CreateState.Idle(),
  })

/** Leaves the name step, unless the name is still blank. */
export const continueFromName = (home: Home, playerName: string): Home =>
  playerName.trim() === '' ? home : goTo(home, 'Mode', 'Forward')

export const chooseBots = (home: Home): Home => goTo(home, 'Bots', 'Forward')

export const chooseJoin = (home: Home): Home => goTo(home, 'Join', 'Forward')

/** Back from players or the code goes to the mode step; from the mode step, to the name. */
export const stepBack = (home: Home): Home => {
  switch (home.step) {
    case 'Bots':
    case 'Join':
      return goTo(home, 'Mode', 'Back')
    case 'Mode':
      return home.firstStep === 'Name' ? goTo(home, 'Name', 'Back') : home
    case 'Name':
      return home
  }
}

export const changeName = (home: Home): Home => goTo(home, 'Name', 'Back')

export const hasBack = (home: Home): boolean =>
  home.step !== 'Name' && home.step !== home.firstStep

// VIEW

type H = HtmlBuilder<Message>

const isCreating = (home: Home): boolean => home.create._tag === 'Creating'

const createError = (home: Home, h: H): Html =>
  CreateState.match(home.create, {
    Idle: () => h.empty,
    Creating: () => h.empty,
    Failed: ({ reason }) =>
      h.p([h.Class('wizard-error'), h.Role('alert')], [reason]),
  })

const field = (h: H, label: string, input: Html): Html =>
  h.label(
    [h.Class('wizard-field')],
    [h.span([h.Class('wizard-label')], [label]), input],
  )

const nameField = (inputs: HomeInputs, h: H): Html =>
  field(
    h,
    'Your name',
    h.input([
      h.Class('wizard-input'),
      h.Type('text'),
      h.Value(inputs.playerName),
      h.Placeholder('Conductor'),
      h.Attribute('maxlength', String(NAME_MAX_LENGTH)),
      h.Attribute('autocomplete', 'nickname'),
      h.OnInput(value => Message.UpdatedNameInput({ value })),
    ]),
  )

const seatCountPicker = (inputs: HomeInputs, h: H): Html =>
  h.div(
    [h.Class('wizard-field')],
    [
      h.span([h.Class('wizard-label')], ['Players']),
      h.div(
        [h.Class('wizard-segments'), h.Role('group'), h.AriaLabel('Players')],
        Array.map(Array.range(MIN_SEATS, MAX_SEATS), count =>
          h.button(
            [
              h.Class(
                `wizard-segment${count === inputs.seatCount ? ' is-picked' : ''}`,
              ),
              h.Type('button'),
              h.AriaPressed(String(count === inputs.seatCount)),
              h.OnClick(Message.ClickedSeatCount({ count })),
            ],
            [String(count)],
          ),
        ),
      ),
    ],
  )

const question = (h: H, text: string, hint: string): ReadonlyArray<Html> => [
  h.h2([h.Class('wizard-question')], [text]),
  h.p([h.Class('wizard-hint')], [hint]),
]

const backButton = (h: H): Html =>
  h.button(
    [
      h.Class('btn btn-text btn-compact'),
      h.Type('button'),
      h.OnClick(Message.ClickedWizardBack()),
    ],
    ['Back'],
  )

const playingAs = (inputs: HomeInputs, h: H): Html =>
  h.p(
    [h.Class('wizard-playing-as')],
    [
      h.span([], [`Playing as ${inputs.playerName.trim()}`]),
      h.span([h.AriaHidden(true)], ['·']),
      h.button(
        [
          h.Class('btn btn-text btn-compact'),
          h.Type('button'),
          h.AriaLabel('Change your name'),
          h.OnClick(Message.ClickedChangeName()),
        ],
        ['Change'],
      ),
    ],
  )

// The quiet line under a step's controls: a way back, and whose name is on it.
const footer = (home: Home, inputs: HomeInputs, h: H): Html =>
  h.div(
    [h.Class('wizard-footer')],
    [hasBack(home) ? backButton(h) : h.empty, playingAs(inputs, h)],
  )

// NOTE: One view function per step, so a step change replaces the DOM and the
// entry slide plays again.
const stepFrame = (home: Home, h: H, children: ReadonlyArray<Html>): Html =>
  h.div(
    [
      h.Class(
        `wizard-step ${home.direction === 'Back' ? 'is-back' : 'is-forward'}`,
      ),
    ],
    children,
  )

const nameStep = (home: Home, inputs: HomeInputs, h: H): Html =>
  stepFrame(home, h, [
    ...question(
      h,
      'What’s your name?',
      'Friends see it at the table. This device remembers it.',
    ),
    h.form(
      [h.Class('wizard-form'), h.OnSubmit(Message.SubmittedName())],
      [
        nameField(inputs, h),
        h.button(
          [
            h.Class('btn btn-red btn-block'),
            h.Type('submit'),
            h.Disabled(inputs.playerName.trim() === ''),
          ],
          ['Continue'],
        ),
      ],
    ),
  ])

const choice = (
  h: H,
  colour: string,
  title: string,
  detail: string,
  message: Message,
  disabled = false,
): Html =>
  h.button(
    [
      h.Class(`btn ${colour} btn-block btn-with-detail`),
      h.Type('button'),
      h.Disabled(disabled),
      h.OnClick(message),
    ],
    [
      h.span([h.Class('btn-title')], [title]),
      h.span([h.Class('btn-detail')], [detail]),
    ],
  )

// NOTE: No back button here: the only step behind this one is the name, and
// "Change" under the choices already goes there.
const modeStep = (home: Home, inputs: HomeInputs, h: H): Html =>
  stepFrame(home, h, [
    h.h2([h.Class('wizard-question')], ['How do you want to play?']),
    h.div(
      [h.Class('wizard-choices')],
      [
        choice(
          h,
          'btn-red',
          isCreating(home) ? 'Opening a lobby…' : 'Play with friends',
          'Open a lobby and share the code',
          Message.ClickedNewFriendGame(),
          isCreating(home),
        ),
        choice(
          h,
          'btn-green',
          'Play with bots',
          'On this device, offline too',
          Message.ClickedPlayWithBots(),
        ),
        h.button(
          [
            h.Class('btn btn-cream btn-block'),
            h.Type('button'),
            h.OnClick(Message.ClickedHaveInviteCode()),
          ],
          ['Have an invite code?'],
        ),
      ],
    ),
    playingAs(inputs, h),
    createError(home, h),
  ])

const botsStep = (home: Home, inputs: HomeInputs, h: H): Html =>
  stepFrame(home, h, [
    ...question(h, 'How many players?', 'You, plus bots in the other seats.'),
    seatCountPicker(inputs, h),
    h.button(
      [
        h.Class('btn btn-green btn-block'),
        h.Type('button'),
        h.OnClick(Message.ClickedNewBotGame()),
      ],
      ['Start with bots'],
    ),
    footer(home, inputs, h),
  ])

const joinStep = (home: Home, inputs: HomeInputs, h: H): Html =>
  stepFrame(home, h, [
    ...question(h, 'Join a friend’s game', 'Type the code they sent you.'),
    h.form(
      [h.Class('wizard-join'), h.OnSubmit(Message.SubmittedJoinCode())],
      [
        field(
          h,
          'Invite code',
          h.input([
            h.Class('wizard-input is-code'),
            h.Type('text'),
            h.Value(home.joinCode),
            h.Placeholder('TRAIN-4K7'),
            h.Attribute('autocapitalize', 'characters'),
            h.OnInput(value => Message.UpdatedJoinCode({ value })),
          ]),
        ),
        h.button([h.Class('btn btn-blue'), h.Type('submit')], ['Join']),
      ],
    ),
    createError(home, h),
    footer(home, inputs, h),
  ])

const currentStep = (home: Home, inputs: HomeInputs, h: H): Html => {
  switch (home.step) {
    case 'Name':
      return nameStep(home, inputs, h)
    case 'Mode':
      return modeStep(home, inputs, h)
    case 'Bots':
      return botsStep(home, inputs, h)
    case 'Join':
      return joinStep(home, inputs, h)
  }
}

export const newGameView = (home: Home, inputs: HomeInputs, h: H): Html =>
  h.section(
    [h.Class('ticket-card wizard'), h.AriaLabel('New game')],
    [currentStep(home, inputs, h)],
  )

export const homeView = (
  home: Home,
  inputs: HomeInputs,
  extras: ReadonlyArray<Html>,
  h: H,
): Html => screenFrame([newGameView(home, inputs, h), ...extras], h)
