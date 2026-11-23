import { Array, Option, Result, pipe } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import {
  CARD_BACK_ART,
  CAR_ART,
  CAR_KIND,
  CAR_VIEW_BOX,
  DEPOT_ART,
  MAP_ART,
  routeArt,
} from './art'
import {
  CARD_COLORS,
  CITIES,
  type Card,
  type City,
  MARKET_SIZE,
  ROUTES,
  type Route,
  type RouteColor,
  cityById,
  routeById,
  routePoints,
  ticketById,
} from './domain/board'
import {
  type ClientPlayer as Player,
  canDrawFromDeck,
  canTakeMarketCard,
  countCards,
  currentPlayer,
  isViewerTurn as isHumanTurn,
  isViewerTicketComplete,
  marketCardAt,
  maybeRouteOwner,
  maybeTurnStep,
  maybeViewerPayment,
  viewerHasAnyMove,
} from './domain/clientView'
import { AnimateHandRow, HAND_CARD_DATA } from './handMotion'
import { Message } from './message'
import { Phase, type Standing, type TurnStep } from './model'
import type { Table } from './table'
import { resultsActionView, tableActionsView, tableTitle } from './tableChrome'

type Model = Table

// CONSTANTS

const BOARD_VIEW_BOX = '40 30 920 566'
const TICKET_RING_RADIUS = 25
const ROUTE_INSET = 24
const SLOT_GAP = 6
const LOG_LENGTH = 6

const GLYPHS: Record<RouteColor | 'Wild', string> = {
  Red: '◆',
  Blue: '●',
  Green: '▲',
  Yellow: '★',
  Black: '■',
  Gray: '',
  Wild: '✦',
}

const CARD_ORDER: ReadonlyArray<Card> = [...CARD_COLORS, 'Wild']

type LabelPlacement = Readonly<{
  dx: number
  dy: number
  anchor: 'start' | 'middle' | 'end'
}>

const LABEL_PLACEMENTS: Record<string, LabelPlacement> = {
  seattle: { dx: 4, dy: -31, anchor: 'middle' },
  helena: { dx: 0, dy: -31, anchor: 'middle' },
  chicago: { dx: 0, dy: -31, anchor: 'middle' },
  newyork: { dx: 0, dy: -31, anchor: 'middle' },
  denver: { dx: 12, dy: -36, anchor: 'start' },
  atlanta: { dx: -6, dy: 50, anchor: 'middle' },
  losangeles: { dx: 0, dy: 50, anchor: 'middle' },
  dallas: { dx: 0, dy: 50, anchor: 'middle' },
  miami: { dx: 27, dy: 9, anchor: 'start' },
}

const DEFAULT_PLACEMENT: LabelPlacement = { dx: 0, dy: 48, anchor: 'middle' }

const colorName = (card: Card | RouteColor): string =>
  card === 'Wild' ? 'Wild' : card === 'Gray' ? 'Any color' : card

const playerTone = (player: Player | undefined): string =>
  `tone-p${player?.tone ?? 0}`

const seatTone = (model: Model, playerIndex: number): string =>
  playerTone(model.players[playerIndex])

const initialOf = (player: Player): string => player.name.slice(0, 1)

const cityPair = (from: string, to: string): string =>
  `${cityById(from).name} – ${cityById(to).name}`

// BOARD

const routeGeometry = (route: Route) => {
  const from = cityById(route.from)
  const to = cityById(route.to)
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  const distance = Math.hypot(deltaX, deltaY)
  const usable = distance - 2 * ROUTE_INSET
  const slotLength = (usable - SLOT_GAP * (route.length - 1)) / route.length
  const slotCenters: ReadonlyArray<number> = Array.makeBy(
    route.length,
    index => ROUTE_INSET + slotLength / 2 + index * (slotLength + SLOT_GAP),
  )
  return {
    from,
    to,
    slotCenters,
    slotLength,
    angle: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
  }
}

const isRouteClaimableByHuman = (model: Model, routeId: string): boolean =>
  isHumanTurn(model) &&
  Option.contains(maybeTurnStep(model), 'ChoosingAction') &&
  Option.isSome(maybeViewerPayment(model, routeId))

const routeLabel = (model: Model, route: Route): string => {
  const base = `${cityPair(route.from, route.to)}, ${route.length} ${colorName(route.color)} cards, ${routePoints(route.length)} points`
  return Option.match(maybeRouteOwner(model, route.id), {
    onSome: owner =>
      `${base}. Claimed by ${model.players[owner]?.name ?? 'someone'}.`,
    onNone: () =>
      isRouteClaimableByHuman(model, route.id)
        ? `${base}. You can claim it.`
        : `${base}. Open.`,
  })
}

const routeView = (
  model: Model,
  route: Route,
  h: HtmlBuilder<Message>,
): Html => {
  const geometry = routeGeometry(route)
  const maybeOwner = maybeRouteOwner(model, route.id)
  const isClaimable = isRouteClaimableByHuman(model, route.id)
  const isHovered = Option.contains(model.maybeHoveredRouteId, route.id)
  const stateClass = Option.match(maybeOwner, {
    onSome: owner => `route is-owned ${seatTone(model, owner)}`,
    onNone: () =>
      `route is-open color-${route.color.toLowerCase()}${isClaimable ? ' is-claimable' : ''}`,
  })
  const slotMark = Option.match(maybeOwner, {
    onSome: owner =>
      pipe(
        model.players,
        Array.get(owner),
        Option.map(initialOf),
        Option.getOrElse(() => ''),
      ),
    onNone: () => GLYPHS[route.color],
  })

  return h.keyed('g')(
    route.id,
    [
      h.Class(`${stateClass}${isHovered ? ' is-hovered' : ''}`),
      h.Role('button'),
      h.Tabindex(0),
      h.AriaLabel(routeLabel(model, route)),
      h.AriaDisabled(!isClaimable),
      h.OnClick(Message.ClickedRoute({ routeId: route.id })),
      h.OnMouseEnter(Message.HoveredRoute({ routeId: route.id })),
      h.OnMouseLeave(Message.UnhoveredRoute()),
      h.OnKeyDownPreventDefault(key =>
        key === 'Enter' || key === ' '
          ? Option.some(Message.ClickedRoute({ routeId: route.id }))
          : Option.none(),
      ),
    ],
    [
      h.line([
        h.Class('route-hit'),
        h.X1(String(geometry.from.x)),
        h.Y1(String(geometry.from.y)),
        h.X2(String(geometry.to.x)),
        h.Y2(String(geometry.to.y)),
      ]),
      h.g([
        h.Class('route-art'),
        h.Transform(
          `translate(${geometry.from.x} ${geometry.from.y}) rotate(${geometry.angle.toFixed(1)})`,
        ),
        h.InnerHTML(
          routeArt({
            slotCenters: geometry.slotCenters,
            slotLength: geometry.slotLength,
            angle: geometry.angle,
            mark: slotMark,
            isOwned: Option.isSome(maybeOwner),
          }),
        ),
      ]),
    ],
  )
}

const humanTicketCities = (model: Model) =>
  pipe(
    model.players,
    Array.get(model.viewerIndex),
    Option.map(player =>
      Array.map(player.ticketIds, ticketId => ({
        ticket: ticketById(ticketId),
        isComplete: isViewerTicketComplete(model, ticketId),
      })),
    ),
    Option.getOrElse(() => []),
  )

const cityView = (model: Model, city: City, h: HtmlBuilder<Message>): Html => {
  const ticketStates = Array.filter(
    humanTicketCities(model),
    ({ ticket }) => ticket.from === city.id || ticket.to === city.id,
  )
  const ringClass = Array.match(ticketStates, {
    onEmpty: () => Option.none<string>(),
    onNonEmpty: states =>
      Option.some(
        Array.every(states, state => state.isComplete)
          ? 'city-ring is-done'
          : 'city-ring',
      ),
  })
  const placement = LABEL_PLACEMENTS[city.id] ?? DEFAULT_PLACEMENT

  return h.keyed('g')(
    city.id,
    [h.Class('city')],
    [
      Option.match(ringClass, {
        onNone: () => h.empty,
        onSome: className =>
          h.circle([
            h.Class(className),
            h.Cx(String(city.x)),
            h.Cy(String(city.y)),
            h.R(String(TICKET_RING_RADIUS)),
          ]),
      }),
      h.g([
        h.Class('depot'),
        h.Transform(`translate(${city.x} ${city.y})`),
        h.InnerHTML(DEPOT_ART),
      ]),
      h.text(
        [
          h.Class('city-label'),
          h.X(String(city.x + placement.dx)),
          h.Y(String(city.y + placement.dy)),
          h.TextAnchor(placement.anchor),
        ],
        [city.name],
      ),
    ],
  )
}

const boardView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('board-frame')],
    [
      h.svg(
        [
          h.Class('board'),
          h.ViewBox(BOARD_VIEW_BOX),
          h.Role('group'),
          h.AriaLabel('Rail map. Choose a route to claim it.'),
        ],
        [
          h.g([h.Class('map-art'), h.AriaHidden(true), h.InnerHTML(MAP_ART)]),
          h.g(
            [h.Class('routes')],
            Array.map(ROUTES, route => routeView(model, route, h)),
          ),
          h.g(
            [h.Class('cities')],
            Array.map(CITIES, city => cityView(model, city, h)),
          ),
        ],
      ),
    ],
  )

const routeReadoutView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(model.maybeHoveredRouteId, {
    onNone: () =>
      h.p(
        [h.Class('readout is-hint')],
        [
          isHumanTurn(model)
            ? 'Track glowing gold is a route you can claim right now. Tap it to couple your train.'
            : 'Watch the map: each claimed route fills with its owner’s train.',
        ],
      ),
    onSome: routeId => {
      const route = routeById(routeId)
      return h.p(
        [h.Class('readout')],
        [
          h.strong([], [cityPair(route.from, route.to)]),
          h.span(
            [h.Class(`chip color-${route.color.toLowerCase()}`)],
            [
              `${GLYPHS[route.color]} ${route.length} × ${colorName(route.color)}`,
            ],
          ),
          h.span([], [`${routePoints(route.length)} pts`]),
          h.span(
            [h.Class('readout-state')],
            [
              Option.match(maybeRouteOwner(model, routeId), {
                onSome: owner => `Owned by ${model.players[owner]?.name ?? ''}`,
                onNone: () =>
                  isRouteClaimableByHuman(model, routeId)
                    ? 'You can claim this'
                    : 'Open',
              }),
            ],
          ),
        ],
      )
    },
  })

// STATUS

const statusText = (model: Model): string =>
  Phase.match<string>(model.phase, {
    Dealing: () => 'Shuffling the deck…',
    GameOver: () => 'Final results are in.',
    Playing: ({ step }) => {
      if (!isHumanTurn(model)) {
        return Option.match(currentPlayer(model), {
          onNone: () => 'Waiting…',
          onSome: player =>
            player.kind === 'Human'
              ? `Waiting on ${player.name}…`
              : `${player.name} is thinking…`,
        })
      }
      return step === 'DrawingSecondCard'
        ? 'Take one more card. A face-up wild can’t be your second card.'
        : 'Your turn: draw two cards, claim a route, or take a ticket.'
    },
  })

const headerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class('topbar')],
    [
      h.div(
        [h.Class('brand')],
        [
          h.span([h.Class('rivet'), h.AriaHidden(true)]),
          h.h1([h.Class('brand-name')], ['All Aboard']),
          h.span([h.Class('rivet'), h.AriaHidden(true)]),
        ],
      ),
      h.p(
        [
          h.Class(`status${isHumanTurn(model) ? ' is-yours' : ''}`),
          h.AriaLive('polite'),
        ],
        [statusText(model)],
      ),
      Option.match(
        Option.filter(model.maybeFinalTurnsLeft, () =>
          Option.isSome(maybeTurnStep(model)),
        ),
        {
          onNone: () => h.empty,
          onSome: turnsLeft =>
            h.span(
              [h.Class('final-chip')],
              [
                turnsLeft === 1
                  ? 'Final turn'
                  : `Final round · ${turnsLeft} turns left`,
              ],
            ),
        },
      ),
      ...tableActionsView(model, h),
    ],
  )

const scoreboardView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.ol(
    [h.Class('scoreboard'), h.AriaLabel('Players')],
    Array.map(model.players, (player, playerIndex) => {
      const isCurrent =
        Option.isSome(maybeTurnStep(model)) &&
        model.currentPlayerIndex === playerIndex
      return h.keyed('li')(
        player.name,
        [
          h.Class(
            `seat ${playerTone(player)}${isCurrent ? ' is-current' : ''}`,
          ),
          ...(isCurrent ? [h.AriaCurrent('step')] : []),
        ],
        [
          h.span([h.Class('token'), h.AriaHidden(true)], [initialOf(player)]),
          h.span(
            [h.Class('seat-name')],
            [
              player.name,
              player.kind === 'LeftToBot'
                ? h.span([h.Class('bot-badge')], ['bot'])
                : h.empty,
              isCurrent && player.kind !== 'Human'
                ? h.span(
                    [h.Class('thinking'), h.AriaHidden(true)],
                    [h.i([]), h.i([]), h.i([])],
                  )
                : h.empty,
            ],
          ),
          h.span(
            [h.Class('seat-score')],
            [h.strong([], [String(player.routePoints)]), h.small([], ['pts'])],
          ),
          h.span(
            [h.Class('seat-meta')],
            [
              `${player.trains} trains · ${player.handCount} cards · ${player.ticketCount} tickets`,
            ],
          ),
        ],
      )
    }),
  )

// CARDS

const carArt = (card: Card, h: HtmlBuilder<Message>): Html =>
  h.svg([
    h.Class('car-art'),
    h.ViewBox(CAR_VIEW_BOX),
    h.AriaHidden(true),
    h.InnerHTML(CAR_ART[card]),
  ])

const cardFace = (card: Card, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.span([h.Class('card-glyph'), h.AriaHidden(true)], [GLYPHS[card]]),
  carArt(card, h),
  h.span(
    [h.Class('card-name')],
    [
      colorName(card),
      h.span([h.Class('card-kind'), h.AriaHidden(true)], [CAR_KIND[card]]),
    ],
  ),
]

const marketView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const maybeStep = maybeTurnStep(model)
  const canAct = isHumanTurn(model)
  const step: TurnStep = Option.getOrElse(
    maybeStep,
    (): TurnStep => 'ChoosingAction',
  )

  const slots = Array.map(Array.range(0, MARKET_SIZE - 1), slot =>
    Option.match(marketCardAt(model, slot), {
      onNone: () =>
        h.keyed('li')(`slot-${slot}`, [h.Class('card is-empty')], ['Sold out']),
      onSome: card => {
        const isAvailable = canAct && canTakeMarketCard(model, slot, step)
        return h.keyed('li')(
          `slot-${slot}`,
          [],
          [
            h.button(
              [
                h.Class(`card color-${card.toLowerCase()}`),
                h.Type('button'),
                h.Disabled(!isAvailable),
                h.AriaLabel(
                  `Take face-up ${colorName(card)} card (key ${slot + 1})`,
                ),
                h.OnClick(Message.ClickedMarketCard({ slot })),
              ],
              [
                ...cardFace(card, h),
                h.kbd(
                  [h.Class('card-key'), h.AriaHidden(true)],
                  [String(slot + 1)],
                ),
              ],
            ),
          ],
        )
      },
    }),
  )

  return h.section(
    [h.Class('panel market'), h.AriaLabelledBy('market-title')],
    [
      h.div(
        [h.Class('panel-head')],
        [
          h.h2([h.Id('market-title')], ['Draw cards']),
          h.span(
            [h.Class('panel-note')],
            [`${model.deckCount} in deck · ${model.discardCount} discarded`],
          ),
        ],
      ),
      h.ul(
        [h.Class('card-row')],
        [
          ...slots,
          h.keyed('li')(
            'deck',
            [],
            [
              h.button(
                [
                  h.Class('card deck'),
                  h.Type('button'),
                  h.Disabled(!(canAct && canDrawFromDeck(model))),
                  h.AriaLabel('Draw the top card of the deck (key D)'),
                  h.OnClick(Message.ClickedDeck()),
                ],
                [
                  h.svg([
                    h.Class('card-back'),
                    h.ViewBox(CAR_VIEW_BOX),
                    h.Attribute('preserveAspectRatio', 'xMidYMid slice'),
                    h.AriaHidden(true),
                    h.InnerHTML(CARD_BACK_ART),
                  ]),
                  h.span(
                    [h.Class('card-name')],
                    [
                      'Deck',
                      h.span(
                        [h.Class('card-kind'), h.AriaHidden(true)],
                        [`${model.deckCount} cards`],
                      ),
                    ],
                  ),
                  h.kbd([h.Class('card-key'), h.AriaHidden(true)], ['D']),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const handView = (
  model: Model,
  player: Player,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.Class('panel hand'), h.AriaLabelledBy('hand-title')],
    [
      h.div(
        [h.Class('panel-head')],
        [
          h.h2([h.Id('hand-title')], ['Your hand']),
          h.span(
            [h.Class('panel-note')],
            [`${player.hand.length} cards · ${player.trains} trains`],
          ),
        ],
      ),
      h.ul(
        [
          h.Class('hand-row'),
          h.AriaLabel('Cards in your hand'),
          h.OnMount(AnimateHandRow),
        ],
        pipe(
          CARD_ORDER,
          Array.filterMap(card => {
            const count = countCards(player.hand, card)
            return count > 0 ? Result.succeed({ card, count }) : Result.failVoid
          }),
          Array.match({
            onEmpty: () => [
              h.keyed('li')(
                'empty',
                [h.Class('hand-empty')],
                ['No cards in hand. Draw from the row above the map.'],
              ),
            ],
            onNonEmpty: held =>
              Array.map(held, ({ card, count }) =>
                h.keyed('li')(
                  card,
                  [
                    h.Class(`card hand-card color-${card.toLowerCase()}`),
                    h.DataAttribute(HAND_CARD_DATA, card),
                    h.AriaLabel(`${count} ${colorName(card)}`),
                  ],
                  [
                    ...cardFace(card, h),
                    h.keyed('span')(
                      `${card}-${count}`,
                      [h.Class('hand-count'), h.AriaHidden(true)],
                      [`×${count}`],
                    ),
                  ],
                ),
              ),
          }),
        ),
      ),
    ],
  )

// TICKETS

const ticketsView = (
  model: Model,
  player: Player,
  h: HtmlBuilder<Message>,
): Html => {
  const canDrawTicket =
    isHumanTurn(model) &&
    Option.contains(maybeTurnStep(model), 'ChoosingAction') &&
    model.ticketPileCount > 0

  return h.section(
    [h.Class('panel tickets'), h.AriaLabelledBy('tickets-title')],
    [
      h.div(
        [h.Class('panel-head')],
        [
          h.h2([h.Id('tickets-title')], ['Your tickets']),
          h.button(
            [
              h.Class('btn btn-small'),
              h.Type('button'),
              h.Disabled(!canDrawTicket),
              h.OnClick(Message.ClickedDrawTicket()),
            ],
            [`Take a ticket (${model.ticketPileCount} left)`],
          ),
        ],
      ),
      h.ul(
        [h.Class('ticket-list')],
        Array.map(player.ticketIds, ticketId => {
          const ticket = ticketById(ticketId)
          const isComplete = isViewerTicketComplete(model, ticketId)
          return h.keyed('li')(
            ticketId,
            [h.Class(`ticket${isComplete ? ' is-done' : ''}`)],
            [
              h.span(
                [h.Class('ticket-main')],
                [
                  h.span(
                    [h.Class('ticket-kicker'), h.AriaHidden(true)],
                    ['Destination ticket'],
                  ),
                  h.span(
                    [h.Class('ticket-route')],
                    [
                      cityById(ticket.from).name,
                      h.span(
                        [h.Class('ticket-arrow'), h.AriaHidden(true)],
                        [' ⟶ '],
                      ),
                      h.span([h.Class('sr-only')], [' to ']),
                      cityById(ticket.to).name,
                    ],
                  ),
                  h.span(
                    [h.Class('ticket-state')],
                    [isComplete ? '✓ Connected' : 'Not yet connected'],
                  ),
                ],
              ),
              h.span(
                [h.Class('ticket-stub')],
                [
                  h.span([h.Class('ticket-points')], [`${ticket.points}`]),
                  h.span([h.Class('ticket-unit')], ['points']),
                ],
              ),
            ],
          )
        }),
      ),
    ],
  )
}

// LOG

const logView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('panel log'), h.AriaLabelledBy('log-title')],
    [
      h.div(
        [h.Class('panel-head')],
        [h.h2([h.Id('log-title')], ['Recent moves'])],
      ),
      h.ol(
        [h.Class('log-list')],
        pipe(
          model.log,
          Array.takeRight(LOG_LENGTH),
          Array.reverse,
          Array.map(entry =>
            h.keyed('li')(
              entry.id,
              [h.Class(`log-entry ${seatTone(model, entry.playerIndex)}`)],
              [h.span([h.Class('log-dot'), h.AriaHidden(true)]), entry.text],
            ),
          ),
        ),
      ),
    ],
  )

// GAME OVER

const resultsView = (
  model: Model,
  standings: ReadonlyArray<Standing>,
  h: HtmlBuilder<Message>,
): Html => {
  const headline = pipe(
    Array.head(standings),
    Option.map(winner => {
      const name = model.players[winner.playerIndex]?.name ?? ''
      return winner.playerIndex === model.viewerIndex
        ? 'You win.'
        : `${name} wins.`
    }),
    Option.getOrElse(() => 'Game over.'),
  )
  return h.section(
    [h.Class('panel results'), h.AriaLabelledBy('results-title')],
    [
      h.p([h.Class('results-kicker')], ['End of the line · Final standings']),
      h.h2([h.Id('results-title'), h.Class('results-headline')], [headline]),
      h.table(
        [h.Class('results-table')],
        [
          h.thead(
            [],
            [
              h.tr(
                [],
                [
                  h.th([h.Scope('col')], ['Player']),
                  h.th([h.Scope('col')], ['Routes']),
                  h.th([h.Scope('col')], ['Tickets']),
                  h.th([h.Scope('col')], ['Total']),
                ],
              ),
            ],
          ),
          h.tbody(
            [],
            Array.map(standings, (standing, rank) => {
              const player = model.players[standing.playerIndex]
              return h.keyed('tr')(
                standing.playerIndex,
                [
                  h.Class(
                    `${seatTone(model, standing.playerIndex)}${rank === 0 ? ' is-winner' : ''}`,
                  ),
                ],
                [
                  h.th(
                    [h.Scope('row')],
                    [
                      h.span(
                        [h.Class('results-player')],
                        [
                          h.span(
                            [h.Class('token'), h.AriaHidden(true)],
                            [player ? initialOf(player) : ''],
                          ),
                          player?.name ?? '',
                        ],
                      ),
                    ],
                  ),
                  h.td([], [String(standing.routePoints)]),
                  h.td(
                    [],
                    [
                      `${standing.ticketPoints >= 0 ? '+' : ''}${standing.ticketPoints}`,
                      h.small(
                        [],
                        [
                          ` ${standing.completedTickets}✓ ${standing.failedTickets}✗`,
                        ],
                      ),
                    ],
                  ),
                  h.td([h.Class('results-total')], [String(standing.total)]),
                ],
              )
            }),
          ),
        ],
      ),
      resultsActionView(model, h),
    ],
  )
}

// LAYOUT

const noticeView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.p(
    [
      h.Class(`notice${Option.isSome(model.maybeNotice) ? ' is-visible' : ''}`),
      h.AriaLive('assertive'),
    ],
    [Option.getOrElse(model.maybeNotice, () => '')],
  )

const passView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isHumanTurn(model) &&
  Option.contains(maybeTurnStep(model), 'ChoosingAction') &&
  !viewerHasAnyMove(model)
    ? h.button(
        [
          h.Class('btn btn-primary'),
          h.Type('button'),
          h.OnClick(Message.ClickedPass()),
        ],
        ['No moves left · Pass'],
      )
    : h.empty

const playAreaView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('play-area')],
    Phase.match<ReadonlyArray<Html>>(model.phase, {
      GameOver: () => [boardView(model, h)],
      Dealing: () => [boardView(model, h)],
      Playing: () =>
        pipe(
          model.players,
          Array.get(model.viewerIndex),
          Option.match({
            onNone: () => [boardView(model, h)],
            onSome: human => [
              noticeView(model, h),
              passView(model, h),
              marketView(model, h),
              boardView(model, h),
              handView(model, human, h),
            ],
          }),
        ),
    }),
  )

const sidebarView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.aside(
    [h.Class('sidebar'), h.AriaLabel('Players, tickets and moves')],
    [routeReadoutView(model, h), ...sidebarPanels(model, h)],
  )

const sidebarPanels = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Phase.match<ReadonlyArray<Html>>(model.phase, {
    GameOver: ({ standings }) => [
      resultsView(model, standings, h),
      scoreboardView(model, h),
      logView(model, h),
    ],
    Dealing: () => [
      h.div([h.Class('panel is-loading')], ['Dealing…']),
      scoreboardView(model, h),
    ],
    Playing: () =>
      pipe(
        model.players,
        Array.get(model.viewerIndex),
        Option.match({
          onNone: () => [h.div([h.Class('panel is-loading')], ['Dealing…'])],
          onSome: human => [
            scoreboardView(model, h),
            ticketsView(model, human, h),
            logView(model, h),
          ],
        }),
      ),
  })

export const tableView = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: tableTitle(isHumanTurn(model)),
  body: h.div(
    [h.Class('app')],
    [
      headerView(model, h),
      h.main(
        [h.Class('table')],
        [playAreaView(model, h), sidebarView(model, h)],
      ),
    ],
  ),
})
