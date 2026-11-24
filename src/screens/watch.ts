import { Array, Number, Option, pipe } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import { DEPOT_ART, MAP_ART, routeArt } from '../art'
import {
  CITIES,
  type City,
  MARKET_SIZE,
  ROUTES,
  type Route,
} from '../domain/board'
import {
  type ClientPlayer,
  type ClientView,
  currentPlayer,
  marketCardAt,
  maybeRouteOwner,
  maybeTurnStep,
} from '../domain/clientView'
import { Message } from '../message'
import { Phase, type Standing } from '../model'
import type { LobbySeat } from '../protocol'
import {
  type PlayerRecap,
  type Recap,
  RecapStage,
  awards,
  maybeSpotlitPlayer,
  playerRecap,
  revealOrder,
} from '../recap'
import type { SoundSetting } from '../soundSetting'
import {
  BOARD_VIEW_BOX,
  DEFAULT_PLACEMENT,
  DEPOT_SCALE,
  GLYPHS,
  LABEL_PLACEMENTS,
  cardFace,
  cityLabelView,
  cityPair,
  initialOf,
  playerTone,
  routeGeometry,
} from '../view'
import { screenFrame } from './frame'
import { toneName } from './lobby'

type H = HtmlBuilder<Message>

type WatchTable = Readonly<{
  code: string
  view: ClientView
  revealedTickets: ReadonlyArray<ReadonlyArray<string>>
}>

type WatchLobby = Readonly<{
  code: string
  seats: ReadonlyArray<LobbySeat>
  isRematch: boolean
}>

const RECENT_MOVES = 4

const ordinal = (place: number): string => {
  const suffix =
    place % 100 >= 11 && place % 100 <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][place % 10] ?? 'th')
  return `${place}${suffix}`
}

const signed = (value: number): string =>
  value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'

const playerAt = (
  view: ClientView,
  playerIndex: number,
): Option.Option<ClientPlayer> => Array.get(view.players, playerIndex)

const nameOf = (view: ClientView, playerIndex: number): string =>
  Option.match(playerAt(view, playerIndex), {
    onNone: () => '',
    onSome: player => player.name,
  })

const token = (player: ClientPlayer, h: H, size = ''): Html =>
  h.span(
    [h.Class(`token ${playerTone(player)}${size}`), h.AriaHidden(true)],
    [initialOf(player)],
  )

const soundButton = (sound: SoundSetting, h: H): Html =>
  h.button(
    [
      h.Class(
        `btn btn-compact watch-sound${sound === 'On' ? ' btn-cream is-on' : ' btn-blue'}`,
      ),
      h.Type('button'),
      h.AriaPressed(String(sound === 'On')),
      h.OnClick(
        Message.ClickedSound({ setting: sound === 'On' ? 'Off' : 'On' }),
      ),
    ],
    [sound === 'On' ? 'Sound on' : 'Tap for sound'],
  )

const fullscreenButton = (h: H): Html =>
  h.button(
    [
      h.Class('btn btn-cream btn-compact watch-fullscreen'),
      h.Type('button'),
      h.OnClick(Message.ClickedFullscreen()),
    ],
    ['Full screen'],
  )

// LOBBY

export const watchLobbyView = (
  lobby: WatchLobby,
  sound: SoundSetting,
  h: H,
): Html =>
  screenFrame(
    [
      h.section(
        [
          h.Class('panel menu-card watch-lobby'),
          h.AriaLabelledBy('watch-title'),
        ],
        [
          h.p(
            [h.Class('watch-kicker')],
            [lobby.isRematch ? 'Table screen · Rematch' : 'Table screen'],
          ),
          h.h2(
            [h.Id('watch-title'), h.Class('watch-lobby-code')],
            [lobby.code],
          ),
          h.p(
            [h.Class('menu-detail')],
            [
              'Join on your phones with this code. This screen follows the game once the host starts it.',
            ],
          ),
          Array.match(lobby.seats, {
            onEmpty: () =>
              h.p([h.Class('menu-detail')], ['Nobody has joined yet.']),
            onNonEmpty: seats =>
              h.ul(
                [h.Class('watch-lobby-seats')],
                Array.map(seats, seat =>
                  h.keyed('li')(
                    String(seat.seatIndex),
                    [h.Class(`watch-lobby-seat tone-p${seat.tone}`)],
                    [
                      h.span(
                        [h.Class('token'), h.AriaHidden(true)],
                        [seat.name.slice(0, 1)],
                      ),
                      h.span([h.Class('watch-lobby-name')], [seat.name]),
                      h.span(
                        [h.Class('watch-lobby-meta')],
                        [
                          seat.kind === 'Bot'
                            ? 'Bot'
                            : `${toneName(seat.tone)}${seat.isHost ? ' · host' : ''}`,
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          }),
          h.div(
            [h.Class('watch-lobby-actions')],
            [soundButton(sound, h), fullscreenButton(h)],
          ),
        ],
      ),
    ],
    h,
    'is-watch-lobby',
  )

// BOARD

type BoardFocus = Readonly<{
  maybeSpotlit: Option.Option<number>
  maybeLatestRouteId: Option.Option<string>
  spotlitRouteIds: ReadonlyArray<string>
  ticketCities: ReadonlyArray<Readonly<{ cityId: string; isComplete: boolean }>>
}>

const watchRouteView = (
  view: ClientView,
  focus: BoardFocus,
  route: Route,
  h: H,
): Html => {
  const geometry = routeGeometry(route)
  const maybeOwner = maybeRouteOwner(view, route.id)
  const revealIndex = Array.findFirstIndex(
    focus.spotlitRouteIds,
    routeId => routeId === route.id,
  )
  const focusClass = Option.match(focus.maybeSpotlit, {
    onNone: () =>
      Option.contains(focus.maybeLatestRouteId, route.id) ? ' is-latest' : '',
    onSome: () => (Option.isSome(revealIndex) ? ' is-spotlit' : ' is-dimmed'),
  })
  const stateClass = Option.match(maybeOwner, {
    onSome: owner => `route is-owned ${playerTone(view.players[owner])}`,
    onNone: () => `route is-open color-${route.color.toLowerCase()}`,
  })
  const mark = Option.match(maybeOwner, {
    onSome: owner =>
      Option.match(playerAt(view, owner), {
        onNone: () => '',
        onSome: initialOf,
      }),
    onNone: () => GLYPHS[route.color],
  })
  return h.keyed('g')(
    route.id,
    [
      h.Class(`${stateClass}${focusClass}`),
      h.Style({
        '--reveal-index': String(Option.getOrElse(revealIndex, () => 0)),
      }),
    ],
    [
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
            mark,
            isOwned: Option.isSome(maybeOwner),
          }),
        ),
      ]),
    ],
  )
}

const watchCityView = (focus: BoardFocus, city: City, h: H): Html => {
  const states = Array.filter(
    focus.ticketCities,
    entry => entry.cityId === city.id,
  )
  const placement = LABEL_PLACEMENTS[city.id] ?? DEFAULT_PLACEMENT
  return h.keyed('g')(
    city.id,
    [h.Class('city')],
    [
      Array.match(states, {
        onEmpty: () => h.empty,
        onNonEmpty: nonEmpty =>
          h.circle([
            h.Class(
              Array.every(nonEmpty, entry => entry.isComplete)
                ? 'city-ring is-done'
                : 'city-ring is-missed',
            ),
            h.Cx(String(city.x)),
            h.Cy(String(city.y)),
            h.R('20'),
          ]),
      }),
      h.g([
        h.Class('depot'),
        h.Transform(`translate(${city.x} ${city.y}) scale(${DEPOT_SCALE})`),
        h.InnerHTML(DEPOT_ART),
      ]),
      cityLabelView(city, placement, h),
    ],
  )
}

const watchBoardView = (view: ClientView, focus: BoardFocus, h: H): Html =>
  h.div(
    [
      h.Class(
        `watch-board${Option.isSome(focus.maybeSpotlit) ? ' is-spotlighting' : ''}`,
      ),
    ],
    [
      h.svg(
        [
          h.Class('board'),
          h.ViewBox(BOARD_VIEW_BOX),
          h.Role('img'),
          h.AriaLabel('Rail map'),
        ],
        [
          h.g([h.Class('map-art'), h.AriaHidden(true), h.InnerHTML(MAP_ART)]),
          h.g(
            [h.Class('routes')],
            Array.map(ROUTES, route => watchRouteView(view, focus, route, h)),
          ),
          h.g(
            [h.Class('cities')],
            Array.map(CITIES, city => watchCityView(focus, city, h)),
          ),
        ],
      ),
    ],
  )

const playingFocus = (view: ClientView): BoardFocus => ({
  maybeSpotlit: Option.none(),
  maybeLatestRouteId: Option.map(
    Array.last(view.claims),
    claim => claim.routeId,
  ),
  spotlitRouteIds: [],
  ticketCities: [],
})

const spotlightFocus = (maybeRecap: Option.Option<PlayerRecap>): BoardFocus =>
  Option.match(maybeRecap, {
    onNone: () => ({
      maybeSpotlit: Option.none(),
      maybeLatestRouteId: Option.none(),
      spotlitRouteIds: [],
      ticketCities: [],
    }),
    onSome: recap => ({
      maybeSpotlit: Option.some(recap.playerIndex),
      maybeLatestRouteId: Option.none(),
      spotlitRouteIds: Array.map(recap.routes, route => route.id),
      ticketCities: Array.flatMap(recap.tickets, ({ ticket, isComplete }) => [
        { cityId: ticket.from, isComplete },
        { cityId: ticket.to, isComplete },
      ]),
    }),
  })

// PLAYING

const turnBanner = (view: ClientView, h: H): Html =>
  Phase.match<Html>(view.phase, {
    Dealing: () => h.p([h.Class('watch-turn')], ['Dealing…']),
    GameOver: () => h.p([h.Class('watch-turn is-over')], ['End of the line']),
    Playing: ({ step }) =>
      Option.match(currentPlayer(view), {
        onNone: () => h.p([h.Class('watch-turn')], ['Waiting…']),
        onSome: player =>
          h.p(
            [h.Class(`watch-turn ${playerTone(player)}`), h.AriaLive('polite')],
            [
              token(player, h, ' is-large'),
              h.span(
                [h.Class('watch-turn-text')],
                [
                  h.strong([], [`${player.name}’s turn`]),
                  h.small(
                    [],
                    [
                      step === 'DrawingSecondCard'
                        ? 'Taking a second card'
                        : player.kind === 'Human'
                          ? 'Draw, claim, or take a ticket'
                          : 'Thinking…',
                    ],
                  ),
                ],
              ),
            ],
          ),
      }),
  })

const finalChip = (view: ClientView, h: H): Html =>
  Option.match(
    Option.filter(view.maybeFinalTurnsLeft, () =>
      Option.isSome(maybeTurnStep(view)),
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
  )

const watchHeader = (table: WatchTable, sound: SoundSetting, h: H): Html =>
  h.header(
    [h.Class('topbar watch-topbar')],
    [
      h.div(
        [h.Class('brand')],
        [
          h.span([h.Class('brand-mark'), h.AriaHidden(true)]),
          h.h1([h.Class('brand-name')], ['All Aboard']),
          h.span([h.Class('brand-mark is-end'), h.AriaHidden(true)]),
        ],
      ),
      turnBanner(table.view, h),
      finalChip(table.view, h),
      h.span([h.Class('watch-code')], [table.code]),
      soundButton(sound, h),
      fullscreenButton(h),
    ],
  )

const playersPanel = (view: ClientView, h: H): Html =>
  h.ol(
    [h.Class('watch-players'), h.AriaLabel('Players')],
    Array.map(view.players, (player, playerIndex) => {
      const isCurrent =
        Option.isSome(maybeTurnStep(view)) &&
        view.currentPlayerIndex === playerIndex
      return h.keyed('li')(
        String(playerIndex),
        [
          h.Class(
            `watch-player ${playerTone(player)}${isCurrent ? ' is-current' : ''}`,
          ),
          ...(isCurrent ? [h.AriaCurrent('step')] : []),
        ],
        [
          token(player, h),
          h.span(
            [h.Class('watch-player-name')],
            [
              player.name,
              player.kind === 'LeftToBot'
                ? h.span([h.Class('bot-badge')], ['bot'])
                : h.empty,
            ],
          ),
          h.span(
            [h.Class('watch-player-score')],
            [h.strong([], [String(player.routePoints)]), h.small([], ['pts'])],
          ),
          h.span(
            [h.Class('watch-player-meta')],
            [
              h.span([], [`${player.trains} trains`]),
              h.span([], [`${player.handCount} cards`]),
              h.span([], [`${player.ticketCount} tickets`]),
            ],
          ),
        ],
      )
    }),
  )

const marketPanel = (view: ClientView, h: H): Html =>
  h.section(
    [h.Class('watch-market'), h.AriaLabel('Face-up cards')],
    [
      h.ul(
        [h.Class('watch-card-row')],
        [
          ...Array.map(Array.range(0, MARKET_SIZE - 1), slot =>
            Option.match(marketCardAt(view, slot), {
              onNone: () =>
                h.keyed('li')(
                  `slot-${slot}`,
                  [h.Class('card is-empty')],
                  ['Sold out'],
                ),
              onSome: card =>
                h.keyed('li')(
                  `slot-${slot}`,
                  [h.Class(`card color-${card.toLowerCase()}`)],
                  cardFace(card, h),
                ),
            }),
          ),
        ],
      ),
      h.p(
        [h.Class('watch-deck')],
        [
          `${view.deckCount} in the deck · ${view.ticketPileCount} tickets left`,
        ],
      ),
    ],
  )

const movesPanel = (view: ClientView, h: H): Html =>
  h.section(
    [h.Class('watch-moves'), h.AriaLabel('Recent moves')],
    [
      h.ol(
        [h.Class('watch-move-list'), h.AriaLive('polite')],
        pipe(
          view.log,
          Array.takeRight(RECENT_MOVES),
          Array.reverse,
          Array.map(entry =>
            h.keyed('li')(
              entry.id,
              [
                h.Class(
                  `watch-move ${playerTone(view.players[entry.playerIndex])}`,
                ),
              ],
              [h.span([h.Class('log-dot'), h.AriaHidden(true)]), entry.text],
            ),
          ),
        ),
      ),
    ],
  )

// RECAP

const ticketRow = (
  outcome: PlayerRecap['tickets'][number],
  index: number,
  h: H,
): Html =>
  h.keyed('li')(
    outcome.ticket.id,
    [
      h.Class(`recap-ticket${outcome.isComplete ? ' is-done' : ' is-missed'}`),
      h.Style({ '--reveal-index': String(index) }),
    ],
    [
      h.span(
        [h.Class('recap-ticket-mark'), h.AriaHidden(true)],
        [outcome.isComplete ? '✓' : '✗'],
      ),
      h.span(
        [h.Class('recap-ticket-route')],
        [cityPair(outcome.ticket.from, outcome.ticket.to)],
      ),
      h.span(
        [h.Class('recap-ticket-points')],
        [
          outcome.isComplete
            ? signed(outcome.ticket.points)
            : signed(-outcome.ticket.points),
        ],
      ),
      h.span(
        [h.Class('sr-only')],
        [outcome.isComplete ? 'Completed' : 'Not completed'],
      ),
    ],
  )

const spotlightCard = (
  view: ClientView,
  recap: PlayerRecap,
  run: number,
  h: H,
): Html =>
  Option.match(playerAt(view, recap.playerIndex), {
    onNone: () => h.empty,
    onSome: player =>
      h.div(
        [h.Class('recap-stage')],
        [
          // NOTE: Keyed by the recap run so each spotlight mounts fresh DOM
          // and its reveal animation plays again.
          h.keyed('section')(
            `spotlight-${run}`,
            [
              h.Class(`recap-spotlight ${playerTone(player)}`),
              h.AriaLabel(`${player.name}’s game`),
            ],
            [
              h.p(
                [h.Class('recap-place')],
                [
                  recap.place === 1
                    ? 'Winner'
                    : `${ordinal(recap.place)} place`,
                ],
              ),
              h.h2(
                [h.Class('recap-name')],
                [token(player, h, ' is-large'), player.name],
              ),
              h.dl(
                [h.Class('recap-stats')],
                [
                  h.div(
                    [h.Class('recap-stat')],
                    [
                      h.dt([], ['Routes']),
                      h.dd(
                        [],
                        [
                          `${recap.routes.length} · ${recap.standing.routePoints} pts`,
                        ],
                      ),
                    ],
                  ),
                  h.div(
                    [h.Class('recap-stat')],
                    [
                      h.dt([], ['Longest trail']),
                      h.dd([], [`${recap.longest} cars`]),
                    ],
                  ),
                  h.div(
                    [h.Class('recap-stat')],
                    [
                      h.dt([], ['Trains left']),
                      h.dd([], [String(player.trains)]),
                    ],
                  ),
                ],
              ),
              h.h3([h.Class('recap-subhead')], ['Tickets']),
              Array.match(recap.tickets, {
                onEmpty: () =>
                  h.p([h.Class('recap-empty')], ['No tickets held.']),
                onNonEmpty: tickets =>
                  h.ul(
                    [h.Class('recap-tickets')],
                    Array.map(tickets, (outcome, index) =>
                      ticketRow(outcome, index, h),
                    ),
                  ),
              }),
              h.p(
                [
                  h.Class('recap-total'),
                  h.Style({
                    '--reveal-index': String(recap.tickets.length),
                  }),
                ],
                [
                  h.strong([], [String(recap.standing.total)]),
                  h.span(
                    [],
                    [
                      ` points · ${recap.standing.routePoints} track ${signed(recap.standing.ticketPoints)} tickets`,
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
  })

const scoreboardCard = (
  table: WatchTable,
  standings: ReadonlyArray<Standing>,
  run: number,
  h: H,
): Html => {
  const best = pipe(
    standings,
    Array.map(standing => Math.max(standing.total, 1)),
    Array.reduce(1, Number.max),
  )
  const headline = Option.match(Array.head(standings), {
    onNone: () => 'Game over',
    onSome: winner => {
      const winners = Array.filter(
        standings,
        standing => standing.total === winner.total,
      )
      return winners.length > 1
        ? `${Array.join(
            Array.map(winners, standing =>
              nameOf(table.view, standing.playerIndex),
            ),
            ' & ',
          )} tie`
        : `${nameOf(table.view, winner.playerIndex)} wins`
    },
  })
  return h.div(
    [h.Class('recap-stage')],
    [
      h.keyed('section')(
        `scores-${run}`,
        [h.Class('recap-scoreboard'), h.AriaLabelledBy('recap-headline')],
        [
          h.p([h.Class('recap-place')], ['Final scores']),
          h.h2([h.Id('recap-headline'), h.Class('recap-name')], [headline]),
          h.ol(
            [h.Class('recap-standings')],
            Array.map(standings, (standing, index) =>
              Option.match(playerAt(table.view, standing.playerIndex), {
                onNone: () => h.empty,
                onSome: player =>
                  h.keyed('li')(
                    String(standing.playerIndex),
                    [
                      h.Class(`recap-standing ${playerTone(player)}`),
                      h.Style({
                        '--reveal-index': String(index),
                        '--total-share': String(
                          Math.max(0, standing.total) / best,
                        ),
                      }),
                    ],
                    [
                      h.span(
                        [h.Class('recap-standing-place')],
                        [
                          ordinal(
                            1 +
                              Array.filter(
                                standings,
                                other => other.total > standing.total,
                              ).length,
                          ),
                        ],
                      ),
                      token(player, h),
                      h.span([h.Class('recap-standing-name')], [player.name]),
                      h.span(
                        [h.Class('recap-bar'), h.AriaHidden(true)],
                        [h.i([h.Class('recap-bar-fill')])],
                      ),
                      h.span(
                        [h.Class('recap-standing-total')],
                        [String(standing.total)],
                      ),
                    ],
                  ),
              }),
            ),
          ),
          h.ul(
            [h.Class('recap-awards')],
            Array.map(
              awards(table.view, table.revealedTickets, standings),
              (award, index) =>
                h.keyed('li')(
                  award.title,
                  [
                    h.Class('recap-award'),
                    h.Style({
                      '--reveal-index': String(standings.length + index),
                    }),
                  ],
                  [
                    h.span([h.Class('recap-award-title')], [award.title]),
                    h.strong(
                      [],
                      [
                        Array.join(
                          Array.map(award.playerIndices, playerIndex =>
                            nameOf(table.view, playerIndex),
                          ),
                          ' & ',
                        ),
                      ],
                    ),
                    h.span([h.Class('recap-award-detail')], [award.detail]),
                  ],
                ),
            ),
          ),
        ],
      ),
    ],
  )
}

const recapChips = (
  table: WatchTable,
  standings: ReadonlyArray<Standing>,
  recap: Recap,
  maybeSpotlit: Option.Option<number>,
  h: H,
): Html => {
  const isTouring = recap.stage._tag === 'Touring'
  return h.nav(
    [h.Class('recap-chips'), h.AriaLabel('Replay a player')],
    [
      ...Array.map(revealOrder(standings), playerIndex =>
        Option.match(playerAt(table.view, playerIndex), {
          onNone: () => h.empty,
          onSome: player =>
            h.button(
              [
                h.Class(
                  `recap-chip ${playerTone(player)}${Option.contains(maybeSpotlit, playerIndex) ? ' is-picked' : ''}`,
                ),
                h.Type('button'),
                h.AriaPressed(
                  String(Option.contains(maybeSpotlit, playerIndex)),
                ),
                h.OnClick(Message.ClickedRecapPlayer({ playerIndex })),
              ],
              [token(player, h), player.name],
            ),
        }),
      ),
      h.button(
        [
          h.Class(
            `recap-chip is-scores${recap.stage._tag === 'Scoreboard' ? ' is-picked' : ''}`,
          ),
          h.Type('button'),
          h.AriaPressed(String(recap.stage._tag === 'Scoreboard')),
          h.OnClick(Message.ClickedRecapScores()),
        ],
        ['Final scores'],
      ),
      h.button(
        [
          h.Class('recap-chip is-replay'),
          h.Type('button'),
          h.OnClick(Message.ClickedReplayRecap()),
        ],
        [isTouring ? 'Restart the show' : 'Play the show again'],
      ),
    ],
  )
}

const recapPanel = (
  table: WatchTable,
  standings: ReadonlyArray<Standing>,
  recap: Recap,
  h: H,
): Html => {
  const maybeSpotlit = maybeSpotlitPlayer(recap, standings)
  const stage = Option.match(
    Option.flatMap(maybeSpotlit, playerIndex =>
      playerRecap(table.view, table.revealedTickets, standings, playerIndex),
    ),
    {
      onNone: () => scoreboardCard(table, standings, recap.run, h),
      onSome: playerRecap_ =>
        spotlightCard(table.view, playerRecap_, recap.run, h),
    },
  )
  return h.aside(
    [h.Class('watch-side is-recap')],
    [
      stage,
      RecapStage.match<Html>(recap.stage, {
        Touring: ({ position }) =>
          h.p(
            [h.Class('recap-progress')],
            [`Player ${position + 1} of ${standings.length}`],
          ),
        Idle: () => h.empty,
        Spotlight: () => h.empty,
        Scoreboard: () => h.empty,
      }),
      recapChips(table, standings, recap, maybeSpotlit, h),
    ],
  )
}

// SCREEN

export const watchTableView = (
  table: WatchTable,
  recap: Recap,
  sound: SoundSetting,
  h: H,
): Document => {
  const body = Phase.match<ReadonlyArray<Html>>(table.view.phase, {
    GameOver: ({ standings }) => {
      const focus = spotlightFocus(
        Option.flatMap(maybeSpotlitPlayer(recap, standings), playerIndex =>
          playerRecap(
            table.view,
            table.revealedTickets,
            standings,
            playerIndex,
          ),
        ),
      )
      return [
        watchBoardView(table.view, focus, h),
        recapPanel(table, standings, recap, h),
      ]
    },
    Dealing: () => [
      watchBoardView(table.view, playingFocus(table.view), h),
      h.aside([h.Class('watch-side')], [playersPanel(table.view, h)]),
    ],
    Playing: () => [
      watchBoardView(table.view, playingFocus(table.view), h),
      h.aside(
        [h.Class('watch-side')],
        [
          playersPanel(table.view, h),
          marketPanel(table.view, h),
          movesPanel(table.view, h),
        ],
      ),
    ],
  })
  return {
    title: `${table.code} · Table screen`,
    body: h.div(
      [h.Class('app watch')],
      [watchHeader(table, sound, h), h.main([h.Class('watch-main')], body)],
    ),
  }
}
