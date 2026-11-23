// PROTOTYPE, throwaway (branch prototype/home-variants).
// Question: what should the home screen (new-game card plus the menu below
// it) look like? Five structurally different takes on the existing home
// route, picked with `?variant=A`..`E` and the dev-only switcher.
// They reuse the real Home model, inputs and Messages; only the rendered
// subtree changes. Fold the winner into screens/home.ts and drop this file.

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
  { key: 'C', name: 'Brass control panel' },
  { key: 'D', name: 'Timetable poster' },
  { key: 'E', name: 'Luggage tags' },
] as const

export type VariantProps = Readonly<{
  home: Home
  inputs: HomeInputs
  notifications: Html
  menu: ReadonlyArray<Html>
}>

type H = HtmlBuilder<Message>

// SHARED BITS (inputs only; each variant owns its layout)

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

// A · DEPARTURE BOARD
// A dark split-flap board. Every way to start is a departure row with a
// BOARD button; the bot count is a flap digit with − and +.

const flap = (text: string, h: H, extra = ''): Html =>
  h.span(
    [h.Class(`hv-flaps ${extra}`)],
    Array.map(text.split(''), char =>
      h.span([h.Class('hv-flap')], [char === ' ' ? ' ' : char]),
    ),
  )

const boardRow = (
  h: H,
  time: string,
  destination: Html,
  platform: Html,
  action: Html,
): Html =>
  h.li(
    [h.Class('hv-a-row')],
    [
      h.span([h.Class('hv-a-time')], [time]),
      h.span([h.Class('hv-a-dest')], [destination]),
      h.span([h.Class('hv-a-plat')], [platform]),
      h.span([h.Class('hv-a-go')], [action]),
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
          h.div(
            [h.Class('hv-a-head')],
            [
              flap('DEPARTURES', h, 'is-title'),
              h.span([h.Class('hv-a-clock')], ['ALL ABOARD']),
            ],
          ),
          h.label(
            [h.Class('hv-a-passenger')],
            [
              h.span([h.Class('hv-a-label')], ['Passenger']),
              nameInput(inputs, h, 'hv-a-input', 'YOUR NAME'),
            ],
          ),
          h.div(
            [h.Class('hv-a-cols'), h.AriaHidden(true)],
            [
              h.span([], ['Dep']),
              h.span([], ['Service']),
              h.span([], ['Seats']),
              h.span([], ['']),
            ],
          ),
          h.ul(
            [h.Class('hv-a-rows')],
            [
              boardRow(
                h,
                'NOW',
                h.span(
                  [],
                  [
                    h.strong([], ['Friends Express']),
                    h.small([], ['Opens a lobby, share the code']),
                  ],
                ),
                h.span([], ['2–5']),
                h.button(
                  [
                    h.Class('hv-a-board-btn is-primary'),
                    h.Type('button'),
                    h.Disabled(isCreating(home)),
                    h.OnClick(Message.ClickedNewFriendGame()),
                  ],
                  [isCreating(home) ? 'OPENING' : 'BOARD'],
                ),
              ),
              boardRow(
                h,
                'NOW',
                h.span(
                  [],
                  [
                    h.strong([], ['Bot Local']),
                    h.small([], ['Plays on this device, offline too']),
                  ],
                ),
                h.span(
                  [h.Class('hv-a-stepper')],
                  [
                    h.button(
                      [
                        h.Class('hv-a-step'),
                        h.Type('button'),
                        h.AriaLabel('Fewer players'),
                        h.OnClick(
                          Message.ClickedSeatCount({
                            count: inputs.seatCount - 1,
                          }),
                        ),
                      ],
                      ['−'],
                    ),
                    flap(String(inputs.seatCount), h, 'is-digit'),
                    h.button(
                      [
                        h.Class('hv-a-step'),
                        h.Type('button'),
                        h.AriaLabel('More players'),
                        h.OnClick(
                          Message.ClickedSeatCount({
                            count: inputs.seatCount + 1,
                          }),
                        ),
                      ],
                      ['+'],
                    ),
                  ],
                ),
                h.button(
                  [
                    h.Class('hv-a-board-btn'),
                    h.Type('button'),
                    h.OnClick(Message.ClickedNewBotGame()),
                  ],
                  ['BOARD'],
                ),
              ),
            ],
          ),
          h.form(
            [h.Class('hv-a-join'), h.OnSubmit(Message.SubmittedJoinCode())],
            [
              h.span([h.Class('hv-a-label')], ['Connecting service']),
              codeInput(home, h, 'hv-a-input is-code'),
              h.button([h.Class('hv-a-board-btn'), h.Type('submit')], ['JOIN']),
            ],
          ),
          createError(home, h, 'hv-a-error'),
        ],
      ),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// B · PRINTED TICKET
// A paper ticket you fill in: passenger line, then two tear-off stubs, one
// per way to play, and a small "transfer" stub for an invite code.

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
          h.h2([h.Class('hv-b-title')], ['Passenger Ticket']),
          h.label(
            [h.Class('hv-b-line')],
            [
              h.span([h.Class('hv-b-caption')], ['Issued to']),
              nameInput(inputs, h, 'hv-b-write', 'write your name'),
            ],
          ),
          h.div(
            [h.Class('hv-b-stubs')],
            [
              h.div(
                [h.Class('hv-b-stub')],
                [
                  h.span([h.Class('hv-b-class')], ['First class']),
                  h.strong([h.Class('hv-b-route')], ['With friends']),
                  h.p(
                    [h.Class('hv-b-fine')],
                    ['Valid for one lobby. Share the code printed on it.'],
                  ),
                  h.button(
                    [
                      h.Class('hv-b-stamp is-red'),
                      h.Type('button'),
                      h.Disabled(isCreating(home)),
                      h.OnClick(Message.ClickedNewFriendGame()),
                    ],
                    [isCreating(home) ? 'Issuing…' : 'Issue ticket'],
                  ),
                ],
              ),
              h.div(
                [h.Class('hv-b-stub')],
                [
                  h.span([h.Class('hv-b-class')], ['Second class']),
                  h.strong([h.Class('hv-b-route')], ['With bots']),
                  h.fieldset(
                    [h.Class('hv-b-boxes')],
                    [
                      h.legend([h.Class('hv-b-fine')], ['Party of (tick one)']),
                      ...Array.map(seatCounts, count =>
                        h.button(
                          [
                            h.Class(
                              `hv-b-box${count === inputs.seatCount ? ' is-ticked' : ''}`,
                            ),
                            h.Type('button'),
                            h.AriaPressed(String(count === inputs.seatCount)),
                            h.OnClick(Message.ClickedSeatCount({ count })),
                          ],
                          [
                            h.span(
                              [h.Class('hv-b-tick')],
                              [count === inputs.seatCount ? '✕' : ''],
                            ),
                            String(count),
                          ],
                        ),
                      ),
                    ],
                  ),
                  h.button(
                    [
                      h.Class('hv-b-stamp'),
                      h.Type('button'),
                      h.OnClick(Message.ClickedNewBotGame()),
                    ],
                    ['Issue ticket'],
                  ),
                ],
              ),
            ],
          ),
          createError(home, h, 'hv-b-error'),
        ],
      ),
      h.form(
        [h.Class('hv-b-transfer'), h.OnSubmit(Message.SubmittedJoinCode())],
        [
          h.span(
            [h.Class('hv-b-caption')],
            ['Transfer · have a ticket number?'],
          ),
          h.div(
            [h.Class('hv-b-transfer-row')],
            [
              codeInput(home, h, 'hv-b-write is-code'),
              h.button(
                [h.Class('hv-b-stamp is-small'), h.Type('submit')],
                ['Join'],
              ),
            ],
          ),
        ],
      ),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// C · BRASS CONTROL PANEL
// A locomotive console: engraved nameplate, a rotary selector for the bot
// count, and three big round push-buttons as the primary controls.

const variantC = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-c')],
    [
      h.section(
        [h.Class('hv-c-panel'), h.AriaLabel('New game')],
        [
          h.span([h.Class('hv-c-screw is-tl'), h.AriaHidden(true)]),
          h.span([h.Class('hv-c-screw is-tr'), h.AriaHidden(true)]),
          h.span([h.Class('hv-c-screw is-bl'), h.AriaHidden(true)]),
          h.span([h.Class('hv-c-screw is-br'), h.AriaHidden(true)]),
          h.label(
            [h.Class('hv-c-plate')],
            [
              h.span([h.Class('hv-c-engrave')], ['Engineer']),
              nameInput(inputs, h, 'hv-c-plate-input', 'Your name'),
            ],
          ),
          h.div(
            [h.Class('hv-c-dial-wrap')],
            [
              h.div(
                [
                  h.Class(`hv-c-dial is-turn-${inputs.seatCount}`),
                  h.Role('group'),
                  h.AriaLabel('Players with bots'),
                ],
                [
                  h.span([h.Class('hv-c-knob'), h.AriaHidden(true)]),
                  ...Array.map(seatCounts, count =>
                    h.button(
                      [
                        h.Class(
                          `hv-c-stop is-${count}${count === inputs.seatCount ? ' is-on' : ''}`,
                        ),
                        h.Type('button'),
                        h.AriaPressed(String(count === inputs.seatCount)),
                        h.AriaLabel(`${count} players`),
                        h.OnClick(Message.ClickedSeatCount({ count })),
                      ],
                      [String(count)],
                    ),
                  ),
                ],
              ),
              h.span([h.Class('hv-c-engrave')], ['Crew with bots']),
            ],
          ),
          h.div(
            [h.Class('hv-c-buttons')],
            [
              h.button(
                [
                  h.Class('hv-c-push is-red'),
                  h.Type('button'),
                  h.Disabled(isCreating(home)),
                  h.OnClick(Message.ClickedNewFriendGame()),
                ],
                [
                  h.span([h.Class('hv-c-cap')], []),
                  h.span(
                    [h.Class('hv-c-push-label')],
                    [isCreating(home) ? 'Opening…' : 'Friends'],
                  ),
                ],
              ),
              h.button(
                [
                  h.Class('hv-c-push is-green'),
                  h.Type('button'),
                  h.OnClick(Message.ClickedNewBotGame()),
                ],
                [
                  h.span([h.Class('hv-c-cap')], []),
                  h.span(
                    [h.Class('hv-c-push-label')],
                    [`Bots · ${inputs.seatCount}`],
                  ),
                ],
              ),
            ],
          ),
          h.form(
            [h.Class('hv-c-join'), h.OnSubmit(Message.SubmittedJoinCode())],
            [
              h.span([h.Class('hv-c-engrave')], ['Invite code']),
              h.div(
                [h.Class('hv-c-join-row')],
                [
                  codeInput(home, h, 'hv-c-lcd'),
                  h.button(
                    [h.Class('hv-c-toggle'), h.Type('submit')],
                    ['Join'],
                  ),
                ],
              ),
            ],
          ),
          createError(home, h, 'hv-c-error'),
        ],
      ),
      h.div([h.Class('hv-rest')], rest(props)),
    ],
  )
}

// D · TIMETABLE POSTER
// A printed poster: big headline, then a timetable table where each service
// is a row and booking is an inline link. The name sits in the small print.

const variantD = (props: VariantProps, h: H): Html => {
  const { home, inputs } = props
  return h.div(
    [h.Class('hv hv-d')],
    [
      h.section(
        [h.Class('hv-d-poster'), h.AriaLabel('New game')],
        [
          h.p(
            [h.Class('hv-d-kicker')],
            ['Winter timetable · until further notice'],
          ),
          h.h2(
            [h.Class('hv-d-headline')],
            [
              'All Aboard!',
              h.br([]),
              h.span([], ['Services from this station']),
            ],
          ),
          h.table(
            [h.Class('hv-d-table')],
            [
              h.thead(
                [],
                [
                  h.tr(
                    [],
                    [
                      h.th([], ['Service']),
                      h.th([], ['Calling at']),
                      h.th([], ['']),
                    ],
                  ),
                ],
              ),
              h.tbody(
                [],
                [
                  h.tr(
                    [],
                    [
                      h.td(
                        [],
                        [
                          h.strong([], ['The Friends’ Express']),
                          h.small([], ['Opens a lobby; share the code']),
                        ],
                      ),
                      h.td([], ['Your friends, 2 to 5']),
                      h.td(
                        [],
                        [
                          h.button(
                            [
                              h.Class('hv-d-book is-main'),
                              h.Type('button'),
                              h.Disabled(isCreating(home)),
                              h.OnClick(Message.ClickedNewFriendGame()),
                            ],
                            [isCreating(home) ? 'Booking…' : 'Book →'],
                          ),
                        ],
                      ),
                    ],
                  ),
                  h.tr(
                    [],
                    [
                      h.td(
                        [],
                        [
                          h.strong([], ['The Bot Local']),
                          h.small([], ['Stops at every station; offline']),
                        ],
                      ),
                      h.td(
                        [],
                        [
                          h.span(
                            [
                              h.Class('hv-d-counts'),
                              h.Role('group'),
                              h.AriaLabel('Players with bots'),
                            ],
                            Array.map(seatCounts, count =>
                              h.button(
                                [
                                  h.Class(
                                    `hv-d-count${count === inputs.seatCount ? ' is-on' : ''}`,
                                  ),
                                  h.Type('button'),
                                  h.AriaPressed(
                                    String(count === inputs.seatCount),
                                  ),
                                  h.OnClick(
                                    Message.ClickedSeatCount({ count }),
                                  ),
                                ],
                                [String(count)],
                              ),
                            ),
                          ),
                        ],
                      ),
                      h.td(
                        [],
                        [
                          h.button(
                            [
                              h.Class('hv-d-book'),
                              h.Type('button'),
                              h.OnClick(Message.ClickedNewBotGame()),
                            ],
                            ['Book →'],
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          h.form(
            [h.Class('hv-d-join'), h.OnSubmit(Message.SubmittedJoinCode())],
            [
              h.span(
                [h.Class('hv-d-join-lead')],
                ['Connecting passengers: enter your service number'],
              ),
              codeInput(home, h, 'hv-d-input is-code'),
              h.button([h.Class('hv-d-book'), h.Type('submit')], ['Join →']),
            ],
          ),
          createError(home, h, 'hv-d-error'),
          h.label(
            [h.Class('hv-d-small')],
            [
              h.span([], ['Tickets issued in the name of']),
              nameInput(inputs, h, 'hv-d-input', 'your name'),
            ],
          ),
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

export const homeVariantView = (
  key: string,
  props: VariantProps,
  h: H,
): Html => {
  switch (key) {
    case 'B':
      return variantB(props, h)
    case 'C':
      return variantC(props, h)
    case 'D':
      return variantD(props, h)
    case 'E':
      return variantE(props, h)
    default:
      return variantA(props, h)
  }
}
