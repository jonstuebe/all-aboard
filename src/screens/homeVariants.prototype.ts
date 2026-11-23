// PROTOTYPE, throwaway (branch prototype/home-variants).
// Question: what should the home screen (new-game card plus the menu below
// it) look like? Round 3: the owner picked B (Printed ticket); G, H and I
// keep B's look and try different layouts. Picked with `?variant=` and the
// dev-only switcher. They reuse the real Home model,
// inputs and Messages; only the rendered subtree changes. Fold the winner
// into screens/home.ts and drop this file.
//
// Affordance rules for every variant: every
// tappable thing is a raised button (`hv-btn`), a field (`hv-field`) or a
// segmented control (`hv-seg`), built by the helpers below so each variant
// only re-themes them. Decoration never borrows those shapes.

import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from '../message'
import { MAX_SEATS, MIN_SEATS } from '../model'
import { NAME_MAX_LENGTH } from '../protocol'
import { CreateState, type Home, type HomeInputs } from './home'
import './homeVariants.prototype.css'

export const HOME_VARIANTS = [
  { key: 'B', name: 'Printed ticket' },
  { key: 'G', name: 'Ticket book tabs' },
  { key: 'H', name: 'Hero ticket' },
  { key: 'I', name: 'Ticket carousel' },
] as const

export type VariantProps = Readonly<{
  home: Home
  inputs: HomeInputs
  notifications: Html
  menu: ReadonlyArray<Html>
  /** G only: which stub tab is open ('friends' | 'bots' | 'join'). */
  tab: string
}>

type H = HtmlBuilder<Message>

// SHARED INPUTS

const nameInput = (
  inputs: HomeInputs,
  h: H,
  className: string,
  placeholder: string,
): Html =>
  h.input([
    h.Class(className),
    h.Type('text'),
    h.Value(inputs.playerName),
    h.Placeholder(placeholder),
    h.AriaLabel('Your name'),
    h.Attribute('maxlength', String(NAME_MAX_LENGTH)),
    h.Attribute('autocomplete', 'nickname'),
    h.OnInput(value => Message.UpdatedNameInput({ value })),
  ])

const codeInput = (home: Home, h: H, className: string): Html =>
  h.input([
    h.Class(className),
    h.Type('text'),
    h.Value(home.joinCode),
    h.Placeholder('TRAIN-4K7'),
    h.AriaLabel('Invite code'),
    h.Attribute('autocapitalize', 'characters'),
    h.OnInput(value => Message.UpdatedJoinCode({ value })),
  ])

const isCreating = (home: Home): boolean => home.create._tag === 'Creating'

const createError = (home: Home, h: H, className: string): Html =>
  CreateState.match(home.create, {
    Idle: () => h.empty,
    Creating: () => h.empty,
    Failed: ({ reason }) =>
      h.p([h.Class(className), h.Role('alert')], [reason]),
  })

const seatCounts = Array.range(MIN_SEATS, MAX_SEATS)

const rest = (props: VariantProps): ReadonlyArray<Html> => [
  props.notifications,
  ...props.menu,
]

// SHARED AFFORDANCES (round 2)

const field = (h: H, label: string, input: Html, extra = ''): Html =>
  h.label(
    [h.Class(`hv-field ${extra}`)],
    [h.span([h.Class('hv-field-label')], [label]), input],
  )

const nameField = (inputs: HomeInputs, h: H, label: string): Html =>
  field(h, label, nameInput(inputs, h, 'hv-field-input', 'Your name'))

const segmented = (inputs: HomeInputs, h: H, label: string): Html =>
  h.div(
    [h.Class('hv-seg-wrap')],
    [
      h.span([h.Class('hv-field-label')], [label]),
      h.div(
        [h.Class('hv-seg'), h.Role('group'), h.AriaLabel(label)],
        Array.map(seatCounts, count =>
          h.button(
            [
              h.Class(
                `hv-seg-opt${count === inputs.seatCount ? ' is-on' : ''}`,
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

const startFriends = (home: Home, h: H, extra = ''): Html =>
  h.button(
    [
      h.Class(`hv-btn is-friends ${extra}`),
      h.Type('button'),
      h.Disabled(isCreating(home)),
      h.OnClick(Message.ClickedNewFriendGame()),
    ],
    [isCreating(home) ? 'Opening lobby…' : 'Start with friends'],
  )

const startBots = (h: H, extra = ''): Html =>
  h.button(
    [
      h.Class(`hv-btn is-bots ${extra}`),
      h.Type('button'),
      h.OnClick(Message.ClickedNewBotGame()),
    ],
    ['Start with bots'],
  )

const joinForm = (
  home: Home,
  h: H,
  label: string,
  inputClass = 'hv-field-input is-code',
): Html =>
  h.form(
    [h.Class('hv-join'), h.OnSubmit(Message.SubmittedJoinCode())],
    [
      field(h, label, codeInput(home, h, inputClass), 'is-grow'),
      h.button([h.Class('hv-btn is-join'), h.Type('submit')], ['Join']),
    ],
  )

// B · PRINTED TICKET (clear affordances)
// The paper ticket from round 1, now with an inset name field, raised
// buttons in each stub and a segmented player count. Class names are
// plain printed text; nothing decorative is boxed or stamped.

const variantB = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-b')],
    [
      h.section(
        [h.Class('hv-b-ticket'), h.AriaLabel('New game')],
        [
          h.div(
            [h.Class('hv-b-band')],
            [
              h.span([], ['All Aboard Railway Co.']),
              h.span([h.Class('hv-b-serial')], ['No. 0001']),
            ],
          ),
          h.div(
            [h.Class('hv-b-body')],
            [
              h.h2([h.Class('hv-b-title')], ['Passenger ticket']),
              nameField(inputs, h, 'Passenger name'),
            ],
          ),
          h.div(
            [h.Class('hv-b-stub')],
            [
              h.p([h.Class('hv-b-class')], ['First class']),
              h.h3([h.Class('hv-b-route')], ['With friends']),
              h.p(
                [h.Class('hv-b-fine')],
                ['Opens a lobby. Share the code printed on it.'],
              ),
              startFriends(home, h),
            ],
          ),
          h.div(
            [h.Class('hv-b-stub')],
            [
              h.p([h.Class('hv-b-class')], ['Second class']),
              h.h3([h.Class('hv-b-route')], ['With bots']),
              h.p([h.Class('hv-b-fine')], ['Plays on this device, offline too.']),
              segmented(inputs, h, 'Players'),
              startBots(h),
            ],
          ),
          h.div(
            [h.Class('hv-b-stub is-transfer')],
            [
              h.p([h.Class('hv-b-class')], ['Transfer']),
              h.h3([h.Class('hv-b-route')], ['Join a friend']),
              joinForm(home, h, 'Invite code'),
            ],
          ),
          createError(home, h, 'hv-error'),
        ],
      ),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// Pieces G, H and I share with B: the red company band, the section header
// (class line, route name, fine print) and the three sections' controls.

const band = (h: H, right: string): Html =>
  h.div(
    [h.Class('hv-b-band')],
    [
      h.span([], ['All Aboard Railway Co.']),
      h.span([h.Class('hv-b-serial')], [right]),
    ],
  )

const sectionHead = (
  h: H,
  ticketClass: string,
  route: string,
  fine: string,
): ReadonlyArray<Html> => [
  h.p([h.Class('hv-b-class')], [ticketClass]),
  h.h3([h.Class('hv-b-route')], [route]),
  h.p([h.Class('hv-b-fine')], [fine]),
]

const friendsSection = (home: Home, h: H): ReadonlyArray<Html> => [
  ...sectionHead(
    h,
    'First class',
    'With friends',
    'Opens a lobby. Share the code printed on it.',
  ),
  startFriends(home, h),
]

const botsSection = (inputs: HomeInputs, h: H): ReadonlyArray<Html> => [
  ...sectionHead(h, 'Second class', 'With bots', 'Plays on this device, offline too.'),
  segmented(inputs, h, 'Players'),
  startBots(h),
]

const joinSection = (home: Home, h: H): ReadonlyArray<Html> => [
  ...sectionHead(h, 'Transfer', 'Join a friend', 'Type the code they sent you.'),
  joinForm(home, h, 'Invite code'),
]

// G · TICKET BOOK TABS
// One ticket with three stub tabs along its top edge. Only the open tab's
// section shows, so the screen stays short. The name field sits above the
// tabs because every section needs it.

const TABS = [
  { key: 'friends', label: 'Friends' },
  { key: 'bots', label: 'Bots' },
  { key: 'join', label: 'Join' },
] as const

const variantG = (props: VariantProps, h: H): Html => {
  const { home, inputs, tab } = props
  const open = Array.some(TABS, ({ key }) => key === tab) ? tab : 'friends'
  const body =
    open === 'bots'
      ? botsSection(inputs, h)
      : open === 'join'
        ? joinSection(home, h)
        : friendsSection(home, h)
  return h.div(
    [h.Class('hv hv-b hv-g')],
    [
      h.section(
        [h.Class('hv-b-ticket'), h.AriaLabel('New game')],
        [
          band(h, 'Ticket book'),
          h.div(
            [h.Class('hv-b-body')],
            [
              h.h2([h.Class('hv-b-title')], ['Passenger ticket']),
              nameField(inputs, h, 'Passenger name'),
            ],
          ),
          h.div(
            [h.Class('hv-g-tabs'), h.Role('tablist'), h.AriaLabel('How to play')],
            Array.map(TABS, ({ key, label }) =>
              h.button(
                [
                  h.Class(`hv-g-tab${key === open ? ' is-open' : ''}`),
                  h.Type('button'),
                  h.Role('tab'),
                  h.AriaSelected(key === open),
                  h.OnClick(Message.ClickedHomeTab({ tab: key })),
                ],
                [label],
              ),
            ),
          ),
          h.div([h.Class('hv-b-stub hv-g-panel'), h.Role('tabpanel')], body),
          createError(home, h, 'hv-error'),
        ],
      ),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// H · HERO TICKET
// A clear hierarchy: one big ticket for the usual case (play with
// friends), holding the name field. Below it, a smaller slip for bots and
// a thin "Have a code?" strip for joining.

const variantH = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-b hv-h')],
    [
      h.section(
        [h.Class('hv-b-ticket hv-h-hero'), h.AriaLabel('New game')],
        [
          band(h, 'No. 0001'),
          h.div(
            [h.Class('hv-b-body')],
            [
              h.h2([h.Class('hv-b-title')], ['Play with friends']),
              h.p(
                [h.Class('hv-b-fine hv-h-lead')],
                ['Open a lobby, share the code, and play turn by turn.'],
              ),
              nameField(inputs, h, 'Passenger name'),
              startFriends(home, h, 'is-hero'),
            ],
          ),
        ],
      ),
      h.section(
        [h.Class('hv-b-ticket hv-h-slip'), h.AriaLabel('Play with bots')],
        [
          h.div(
            [h.Class('hv-h-slip-body')],
            [
              h.div(
                [h.Class('hv-h-slip-head')],
                [
                  h.h3([h.Class('hv-b-route')], ['Or play with bots']),
                  h.p([h.Class('hv-b-fine')], ['On this device, offline too.']),
                ],
              ),
              segmented(inputs, h, 'Players'),
              startBots(h),
            ],
          ),
        ],
      ),
      h.section(
        [h.Class('hv-b-ticket hv-h-strip'), h.AriaLabel('Join a game')],
        [joinForm(home, h, 'Have a code?')],
      ),
      createError(home, h, 'hv-error'),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// I · TICKET CAROUSEL
// Your name on a small passenger slip, then the three tickets in a row you
// swipe through. The next ticket peeks in from the right on a phone; on a
// wide screen all three sit side by side.

const carouselTicket = (
  h: H,
  index: number,
  body: ReadonlyArray<Html>,
): Html =>
  h.li(
    [h.Class('hv-b-ticket hv-i-ticket')],
    [band(h, `Ticket ${index} of 3`), h.div([h.Class('hv-i-body')], body)],
  )

const variantI = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-b hv-i')],
    [
      h.section(
        [h.Class('hv-b-ticket hv-i-slip'), h.AriaLabel('Passenger')],
        [
          h.div(
            [h.Class('hv-b-body')],
            [
              h.h2([h.Class('hv-b-title')], ['Choose your ticket']),
              nameField(inputs, h, 'Passenger name'),
            ],
          ),
        ],
      ),
      h.ul(
        [h.Class('hv-i-track'), h.AriaLabel('Tickets')],
        [
          carouselTicket(h, 1, friendsSection(home, h)),
          carouselTicket(h, 2, botsSection(inputs, h)),
          carouselTicket(h, 3, joinSection(home, h)),
        ],
      ),
      h.p([h.Class('hv-i-hint'), h.AriaHidden(true)], ['Swipe for more tickets →']),
      createError(home, h, 'hv-error'),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

export const homeVariantView = (
  key: string,
  props: VariantProps,
  h: H,
): Html => {
  switch (key) {
    case 'G':
      return variantG(props, h)
    case 'H':
      return variantH(props, h)
    case 'I':
      return variantI(props, h)
    default:
      return variantB(props, h)
  }
}
