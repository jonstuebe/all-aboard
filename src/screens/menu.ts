import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { type Stats, averageScore, winRate } from '../domain/results'
import { MenuState } from '../menuSync'
import { Message } from '../message'
import { pingMinutesLeft } from '../pings'
import type { Menu, MenuEntry, MenuStatus } from '../protocol'
import { gamePath } from '../route'

// NOTE: The game lists and stats under the new-game card. Each entry links to
// its game; the router turns the click into navigation.

const ordinal = (rank: number): string =>
  rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`

const entryDetail = (entry: MenuEntry): string => {
  switch (entry.status) {
    case 'YourTurn':
      return 'Your move'
    case 'Waiting':
      return Option.match(entry.maybeCurrentName, {
        onNone: () => 'Waiting on the others',
        onSome: name => `Waiting on ${name}`,
      })
    case 'Lobby':
      return `${entry.seatNames.length} seated · not started`
    case 'Finished':
      return Option.match(entry.maybeResult, {
        onNone: () => 'Finished',
        onSome: result =>
          `${result.isWinner ? 'Won' : ordinal(result.rank)} of ${result.seatCount} · ${result.score} pts`,
      })
    case 'Left':
      return 'Left'
    case 'Gone':
      return Option.getOrElse(
        entry.maybeReason,
        () => 'This game no longer exists',
      )
  }
}

export type PingClock = Readonly<{ now: number }>

const pingButton = (
  entry: MenuEntry,
  clock: PingClock,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(entry.maybePingAvailableAt, {
    onNone: () => h.empty,
    onSome: availableAt => {
      const waitMinutes = pingMinutesLeft(availableAt, clock.now)
      const isReady = waitMinutes <= 0
      return h.button(
        [
          h.Class('btn btn-small'),
          h.Type('button'),
          h.Disabled(!isReady),
          h.AriaLabel(
            isReady
              ? `Ping ${Option.getOrElse(entry.maybeCurrentName, () => 'them')} in ${entry.code}`
              : `You can ping again in ${waitMinutes} minutes`,
          ),
          h.OnClick(Message.ClickedMenuPing({ code: entry.code })),
        ],
        [isReady ? 'Ping' : `Ping in ${waitMinutes}m`],
      )
    },
  })

const entryRow = (
  entry: MenuEntry,
  clock: PingClock,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    entry.code,
    [h.Class(`menu-game is-${entry.status.toLowerCase()}`)],
    [
      h.a(
        [h.Class('menu-game-link'), h.Href(gamePath(entry.code))],
        [
          h.span([h.Class('menu-game-code')], [entry.code]),
          h.span([h.Class('menu-game-names')], [entry.seatNames.join(', ')]),
          h.span([h.Class('menu-game-detail')], [entryDetail(entry)]),
        ],
      ),
      entry.status === 'Waiting' ? pingButton(entry, clock, h) : h.empty,
    ],
  )

type Section = Readonly<{
  title: string
  statuses: ReadonlyArray<MenuStatus>
}>

const SECTIONS: ReadonlyArray<Section> = [
  { title: 'Your turn', statuses: ['YourTurn'] },
  { title: 'Waiting on others', statuses: ['Waiting'] },
  { title: 'Lobbies', statuses: ['Lobby'] },
  { title: 'Past games', statuses: ['Finished', 'Left', 'Gone'] },
]

const gameSections = (
  menu: Menu,
  clock: PingClock,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.getSomes(
    Array.map(SECTIONS, section => {
      const entries = Array.filter(menu.games, entry =>
        Array.contains(section.statuses, entry.status),
      )
      return Array.isReadonlyArrayNonEmpty(entries)
        ? Option.some(
            h.section(
              [h.Class('panel menu-card menu-list')],
              [
                h.h2([h.Class('menu-subheading is-first')], [section.title]),
                h.ul(
                  [h.Class('menu-games')],
                  Array.map(entries, entry => entryRow(entry, clock, h)),
                ),
              ],
            ),
          )
        : Option.none()
    }),
  )

const statTile = (
  label: string,
  value: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('stat')],
    [
      h.dt([h.Class('stat-label')], [label]),
      h.dd([h.Class('stat-value')], [value]),
    ],
  )

// NOTE: No card at all until a game has finished; an empty record says nothing.
const statsCard = (stats: Stats, h: HtmlBuilder<Message>): Html =>
  stats.gamesPlayed === 0
    ? h.empty
    : h.section(
        [
          h.Class('panel menu-card menu-stats'),
          h.AriaLabelledBy('stats-title'),
        ],
        [
          h.h2(
            [h.Id('stats-title'), h.Class('menu-subheading is-first')],
            ['Stats'],
          ),
          h.dl(
            [h.Class('stat-grid')],
            [
              statTile('Games played', String(stats.gamesPlayed), h),
              statTile('Wins', String(stats.wins), h),
              statTile('Win rate', `${Math.round(winRate(stats) * 100)}%`, h),
              statTile(
                'Average score',
                String(Math.round(averageScore(stats))),
                h,
              ),
              statTile('Longest route', `${stats.longestRoute} cars`, h),
              statTile('Tickets completed', String(stats.ticketsCompleted), h),
            ],
          ),
        ],
      )

const loadedView = (
  menu: Menu,
  clock: PingClock,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  ...gameSections(menu, clock, h),
  statsCard(menu.stats, h),
]

export const menuView = (
  state: MenuState,
  clock: PingClock,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  MenuState.match<ReadonlyArray<Html>>(state, {
    Loading: () => [
      h.p([h.Class('menu-status'), h.Role('status')], ['Loading your games…']),
    ],
    Loaded: ({ menu }) => loadedView(menu, clock, h),
    Offline: ({ maybeMenu }) => [
      h.p(
        [h.Class('menu-status'), h.Role('status')],
        [
          'You’re offline. Games with bots still work; friend games and stats need a connection.',
        ],
      ),
      ...Option.match(maybeMenu, {
        onNone: () => [],
        onSome: menu => loadedView(menu, clock, h),
      }),
    ],
  })
