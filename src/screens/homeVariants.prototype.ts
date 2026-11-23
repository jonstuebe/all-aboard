// PROTOTYPE, throwaway (branch prototype/home-variants).
// Question: what should the home screen (new-game card plus the menu below
// it) look like? Round 2: five takes on the existing home route, picked with
// `?variant=` and the dev-only switcher. They reuse the real Home model,
// inputs and Messages; only the rendered subtree changes. Fold the winner
// into screens/home.ts and drop this file.
//
// Affordance rules for A, B, D and F (E is the round-1 baseline): every
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
  { key: 'A', name: 'Departure board' },
  { key: 'B', name: 'Printed ticket' },
  { key: 'D', name: 'Timetable poster' },
  { key: 'E', name: 'Luggage tags' },
  { key: 'F', name: 'Ticket departures' },
] as const

export type VariantProps = Readonly<{
  home: Home
  inputs: HomeInputs
  notifications: Html
  menu: ReadonlyArray<Html>
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

// A · DEPARTURE BOARD (softened)
// A warm walnut station board with a brass bezel. Split-flap letters appear
// only in the heading and the invite-code field. Each way to play is one
// calm departure: a time, a name, a line of detail, one button.

const flap = (text: string, h: H): Html =>
  h.span(
    [h.Class('hv-flaps'), h.AriaHidden(true)],
    Array.map(text.split(''), char => h.span([h.Class('hv-flap')], [char])),
  )

const departure = (
  h: H,
  time: string,
  title: string,
  detail: string,
  body: ReadonlyArray<Html>,
): Html =>
  h.li(
    [h.Class('hv-a-dep')],
    [
      h.div(
        [h.Class('hv-a-dep-head')],
        [
          h.span([h.Class('hv-a-time')], [time]),
          h.div(
            [],
            [
              h.h3([h.Class('hv-a-dest')], [title]),
              h.p([h.Class('hv-a-detail')], [detail]),
            ],
          ),
        ],
      ),
      ...body,
    ],
  )

const variantA = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-a')],
    [
      h.section(
        [h.Class('hv-a-board'), h.AriaLabel('New game')],
        [
          h.h2(
            [h.Class('hv-a-title')],
            [flap('Departures', h), h.span([h.Class('hv-sr')], ['Departures'])],
          ),
          nameField(inputs, h, 'Your name'),
          h.ul(
            [h.Class('hv-a-deps')],
            [
              departure(
                h,
                'Now',
                'With friends',
                'Open a lobby, then share the invite code.',
                [startFriends(home, h)],
              ),
              departure(
                h,
                'Now',
                'With bots',
                'Plays on this device, even offline.',
                [segmented(inputs, h, 'Players'), startBots(h)],
              ),
            ],
          ),
          h.div(
            [h.Class('hv-a-connect')],
            [
              h.h3([h.Class('hv-a-dest')], ['Joining a friend?']),
              joinForm(home, h, 'Invite code', 'hv-field-input is-code is-flap'),
            ],
          ),
          createError(home, h, 'hv-error'),
        ],
      ),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

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

// D · TIMETABLE POSTER (clear affordances)
// A letterpress poster: big headline, then services as stacked entries
// separated by heavy rules, each ending in a full-width raised button.
// Your name moves up to the top as a proper field.

const service = (
  h: H,
  number: string,
  title: string,
  detail: string,
  body: ReadonlyArray<Html>,
): Html =>
  h.section(
    [h.Class('hv-d-service')],
    [
      h.div(
        [h.Class('hv-d-service-head')],
        [
          h.span([h.Class('hv-d-number')], [number]),
          h.div(
            [],
            [
              h.h3([h.Class('hv-d-name')], [title]),
              h.p([h.Class('hv-d-detail')], [detail]),
            ],
          ),
        ],
      ),
      ...body,
    ],
  )

const variantD = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-d')],
    [
      h.section(
        [h.Class('hv-d-poster'), h.AriaLabel('New game')],
        [
          h.p([h.Class('hv-d-kicker')], ['Winter timetable']),
          h.h2(
            [h.Class('hv-d-headline')],
            ['All Aboard!', h.span([], ['Services from this station'])],
          ),
          nameField(inputs, h, 'Travelling as'),
          service(h, '1', 'The Friends’ Express', 'Opens a lobby. Share the code.', [
            startFriends(home, h),
          ]),
          service(h, '2', 'The Bot Local', 'Stops at every station. Works offline.', [
            segmented(inputs, h, 'Players'),
            startBots(h),
          ]),
          service(h, '3', 'Connecting service', 'Got an invite code from a friend?', [
            joinForm(home, h, 'Invite code'),
          ]),
          createError(home, h, 'hv-error'),
        ],
      ),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// E · LUGGAGE TAGS
// A travel-poster hero that greets you by name, then each way to play is a
// big luggage tag hanging on a string; the tag itself is the button.

const variantE = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  const name =
    inputs.playerName.trim() === '' ? 'traveller' : inputs.playerName.trim()
  return h.div(
    [h.Class('hv hv-e')],
    [
      h.section(
        [h.Class('hv-e-hero')],
        [
          h.div([h.Class('hv-e-sun'), h.AriaHidden(true)], []),
          h.div([h.Class('hv-e-hills'), h.AriaHidden(true)], []),
          h.h2([h.Class('hv-e-greeting')], [`Where to, ${name}?`]),
          h.label(
            [h.Class('hv-e-nametag')],
            [
              h.span([h.Class('hv-e-hole'), h.AriaHidden(true)]),
              h.span([h.Class('hv-e-caption')], ['Name']),
              nameInput(inputs, h, 'hv-e-name', 'Your name'),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('hv-e-tags'), h.AriaLabel('New game'), h.Role('group')],
        [
          h.button(
            [
              h.Class('hv-e-tag is-red'),
              h.Type('button'),
              h.Disabled(isCreating(home)),
              h.OnClick(Message.ClickedNewFriendGame()),
            ],
            [
              h.span([h.Class('hv-e-hole'), h.AriaHidden(true)]),
              h.span(
                [h.Class('hv-e-dest')],
                [isCreating(home) ? 'Opening…' : 'With friends'],
              ),
              h.span(
                [h.Class('hv-e-sub')],
                ['Start a lobby and send the invite'],
              ),
            ],
          ),
          h.div(
            [h.Class('hv-e-tag is-green')],
            [
              h.span([h.Class('hv-e-hole'), h.AriaHidden(true)]),
              h.button(
                [
                  h.Class('hv-e-tag-main'),
                  h.Type('button'),
                  h.OnClick(Message.ClickedNewBotGame()),
                ],
                [
                  h.span([h.Class('hv-e-dest')], ['With bots']),
                  h.span(
                    [h.Class('hv-e-sub')],
                    [`A table of ${inputs.seatCount}, works offline`],
                  ),
                ],
              ),
              h.span(
                [
                  h.Class('hv-e-chips'),
                  h.Role('group'),
                  h.AriaLabel('Players with bots'),
                ],
                Array.map(seatCounts, count =>
                  h.button(
                    [
                      h.Class(
                        `hv-e-chip${count === inputs.seatCount ? ' is-on' : ''}`,
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
          ),
          h.form(
            [
              h.Class('hv-e-tag is-blue'),
              h.OnSubmit(Message.SubmittedJoinCode()),
            ],
            [
              h.span([h.Class('hv-e-hole'), h.AriaHidden(true)]),
              h.span([h.Class('hv-e-dest')], ['Join a game']),
              h.div(
                [h.Class('hv-e-join-row')],
                [
                  codeInput(home, h, 'hv-e-code'),
                  h.button([h.Class('hv-e-go'), h.Type('submit')], ['Go']),
                ],
              ),
            ],
          ),
        ],
      ),
      createError(home, h, 'hv-e-error'),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// F · TICKET DEPARTURES (hybrid)
// B's cream ticket paper holding A's departure list: a departures header,
// the passenger field, then each way to play as a row with a platform,
// a name, a line of detail and one big raised button. The clearest
// affordances of the set: 52px buttons with an arrow, labels above fields.

const platformRow = (
  h: H,
  platform: string,
  title: string,
  detail: string,
  body: ReadonlyArray<Html>,
): Html =>
  h.li(
    [h.Class('hv-f-row')],
    [
      h.div(
        [h.Class('hv-f-row-head')],
        [
          h.span(
            [h.Class('hv-f-plat')],
            [h.span([], ['Platform']), h.strong([], [platform])],
          ),
          h.div(
            [],
            [
              h.h3([h.Class('hv-f-dest')], [title]),
              h.p([h.Class('hv-f-detail')], [detail]),
            ],
          ),
        ],
      ),
      ...body,
    ],
  )

const variantF = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-f')],
    [
      h.section(
        [h.Class('hv-f-ticket'), h.AriaLabel('New game')],
        [
          h.div(
            [h.Class('hv-f-head')],
            [
              h.h2([h.Class('hv-f-title')], ['Departures']),
              h.span([h.Class('hv-f-sub')], ['All Aboard Railway Co.']),
            ],
          ),
          h.div([h.Class('hv-f-passenger')], [nameField(inputs, h, 'Passenger name')]),
          h.ul(
            [h.Class('hv-f-rows')],
            [
              platformRow(h, '1', 'With friends', 'Open a lobby and share the invite code.', [
                startFriends(home, h),
              ]),
              platformRow(h, '2', 'With bots', 'Plays on this device, even offline.', [
                segmented(inputs, h, 'Players'),
                startBots(h),
              ]),
              platformRow(h, '3', 'Join a friend', 'Type the code they sent you.', [
                joinForm(home, h, 'Invite code'),
              ]),
            ],
          ),
          createError(home, h, 'hv-error'),
        ],
      ),
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
    case 'B':
      return variantB(props, h)
    case 'D':
      return variantD(props, h)
    case 'E':
      return variantE(props, h)
    case 'F':
      return variantF(props, h)
    default:
      return variantA(props, h)
  }
}
