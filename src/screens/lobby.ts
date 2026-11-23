import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from '../message'
import { MAX_SEATS, MIN_SEATS, TONE_COUNT } from '../model'
import type { OnlineGame } from '../online'
import { type LobbySeat, NAME_MAX_LENGTH } from '../protocol'
import { screenFrame } from './frame'

type LobbySnapshot = Readonly<{
  code: string
  seats: ReadonlyArray<LobbySeat>
  isRematch: boolean
  isViewerSeated: boolean
  isViewerHost: boolean
}>

const TONE_NAMES = ['Orange', 'Plum', 'Teal', 'Rose', 'Olive']

export const toneName = (tone: number): string => TONE_NAMES[tone] ?? 'Colour'

const noticeView = (game: OnlineGame, h: HtmlBuilder<Message>): Html =>
  Option.match(game.ui.maybeNotice, {
    onNone: () => h.empty,
    onSome: notice => h.p([h.Class('menu-error'), h.Role('alert')], [notice]),
  })

const tonePicker = (
  lobby: LobbySnapshot,
  pickedTone: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('tone-picker'), h.Role('group'), h.AriaLabel('Your colour')],
    Array.map(Array.range(0, TONE_COUNT - 1), tone => {
      const isTakenByOther = Array.some(
        lobby.seats,
        seat => seat.tone === tone && !seat.isYou,
      )
      const isPicked = tone === pickedTone
      return h.button(
        [
          h.Class(
            `tone-swatch tone-p${tone}${isPicked ? ' is-picked' : ''}${isTakenByOther ? ' is-taken' : ''}`,
          ),
          h.Type('button'),
          h.Disabled(isTakenByOther),
          h.AriaPressed(String(isPicked)),
          h.AriaLabel(
            isTakenByOther ? `${toneName(tone)} (taken)` : toneName(tone),
          ),
          h.OnClick(Message.ClickedTone({ tone })),
        ],
        [h.span([h.Class('sr-only')], [toneName(tone)])],
      )
    }),
  )

const seatRow = (
  lobby: LobbySnapshot,
  seat: LobbySeat,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    `${seat.seatIndex}-${seat.name}`,
    [h.Class(`lobby-seat tone-p${seat.tone}`)],
    [
      h.span([h.Class('token'), h.AriaHidden(true)], [seat.name.slice(0, 1)]),
      h.span(
        [h.Class('lobby-seat-name')],
        [
          h.span([h.Class('lobby-seat-label')], [seat.name]),
          seat.isYou ? h.span([h.Class('seat-tag is-you')], ['You']) : h.empty,
          seat.isHost
            ? h.span([h.Class('seat-tag is-host')], ['Host'])
            : h.empty,
          seat.kind === 'Bot'
            ? h.span([h.Class('seat-tag is-bot')], ['Bot'])
            : h.empty,
        ],
      ),
      lobby.isRematch
        ? h.span(
            [h.Class(`ready-chip${seat.isReady ? ' is-ready' : ''}`)],
            [seat.isReady ? 'Ready' : 'Not ready'],
          )
        : h.empty,
      lobby.isViewerHost && !seat.isYou
        ? h.button(
            [
              h.Class('btn btn-text btn-compact'),
              h.Type('button'),
              h.AriaLabel(`Remove ${seat.name}`),
              h.OnClick(
                Message.ClickedRemoveSeat({ seatIndex: seat.seatIndex }),
              ),
            ],
            ['Remove'],
          )
        : h.empty,
    ],
  )

const joinForm = (
  game: OnlineGame,
  lobby: LobbySnapshot,
  h: HtmlBuilder<Message>,
): Html => {
  const isFull = lobby.seats.length >= MAX_SEATS
  return h.form(
    [h.Class('join-lobby'), h.OnSubmit(Message.SubmittedJoinLobby())],
    [
      h.label(
        [h.Class('field')],
        [
          h.span([h.Class('field-label')], ['Your name']),
          h.input([
            h.Class('field-input'),
            h.Type('text'),
            h.Value(game.joinName),
            h.Attribute('maxlength', String(NAME_MAX_LENGTH)),
            h.Attribute('autocomplete', 'nickname'),
            h.OnInput(value => Message.UpdatedJoinName({ value })),
          ]),
        ],
      ),
      h.span([h.Class('field-label')], ['Your colour']),
      tonePicker(lobby, game.joinTone, h),
      h.button(
        [
          h.Class('btn btn-red btn-block lobby-primary'),
          h.Type('submit'),
          h.Disabled(isFull),
        ],
        [isFull ? 'This lobby is full' : 'Take a seat'],
      ),
      h.button(
        [
          h.Class('btn btn-text lobby-leave'),
          h.Type('button'),
          h.OnClick(Message.ClickedMenu()),
        ],
        ['Cancel'],
      ),
    ],
  )
}

const viewerTone = (lobby: LobbySnapshot): number =>
  Option.match(
    Array.findFirst(lobby.seats, seat => seat.isYou),
    { onNone: () => 0, onSome: seat => seat.tone },
  )

const playersWord = (count: number): string =>
  count === 1 ? 'player' : 'players'

const primaryAction = (
  lobby: LobbySnapshot,
  readySeats: number,
  h: HtmlBuilder<Message>,
): Html => {
  if (!lobby.isViewerHost) {
    return h.p(
      [h.Class('lobby-wait'), h.Role('status')],
      ['Waiting for the host to start the game…'],
    )
  }
  const missing = MIN_SEATS - readySeats
  return h.button(
    [
      h.Class('btn btn-red btn-block lobby-primary'),
      h.Type('button'),
      h.Disabled(missing > 0),
      h.OnClick(Message.ClickedStartGame()),
    ],
    [
      missing > 0
        ? `Waiting for ${missing} more ${playersWord(missing)}`
        : lobby.isRematch
          ? `Start rematch (${readySeats} ready)`
          : 'Start game',
    ],
  )
}

const seatedControls = (
  lobby: LobbySnapshot,
  h: HtmlBuilder<Message>,
): Html => {
  const readySeats = lobby.isRematch
    ? Array.filter(lobby.seats, seat => seat.isReady).length
    : lobby.seats.length
  const isViewerReady = Array.some(
    lobby.seats,
    seat => seat.isYou && seat.isReady,
  )
  return h.div(
    [h.Class('lobby-controls')],
    [
      h.span([h.Class('field-label')], ['Your colour']),
      tonePicker(lobby, viewerTone(lobby), h),
      // NOTE: The buttons share a row wrapper so that, held sideways, they can
      // sit side by side; upright the wrapper is display: contents.
      h.div(
        [h.Class('lobby-actions')],
        [
          lobby.isViewerHost
            ? h.button(
                [
                  h.Class('btn btn-cream btn-block'),
                  h.Type('button'),
                  h.Disabled(lobby.seats.length >= MAX_SEATS),
                  h.OnClick(Message.ClickedAddBot()),
                ],
                ['Add a bot'],
              )
            : h.empty,
          lobby.isRematch && !lobby.isViewerHost
            ? h.button(
                [
                  h.Class(
                    `btn btn-block ${isViewerReady ? 'btn-cream' : 'btn-green'}`,
                  ),
                  h.Type('button'),
                  h.OnClick(Message.ClickedReady({ isReady: !isViewerReady })),
                ],
                [isViewerReady ? 'Not ready after all' : 'I’m ready'],
              )
            : h.empty,
          primaryAction(lobby, readySeats, h),
          h.button(
            [
              h.Class('btn btn-text lobby-leave'),
              h.Type('button'),
              h.OnClick(Message.ClickedLeaveLobby()),
            ],
            ['Cancel'],
          ),
        ],
      ),
    ],
  )
}

const inviteBlock = (
  game: OnlineGame,
  lobby: LobbySnapshot,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('invite-block')],
    [
      h.span(
        [h.Id('invite-code-label'), h.Class('field-label')],
        ['Invite code'],
      ),
      h.div(
        [h.Class('invite-code-row')],
        [
          h.output(
            [h.Class('invite-code'), h.AriaLabelledBy('invite-code-label')],
            [h.span([h.Class('invite-code-text')], [lobby.code])],
          ),
          h.button(
            [
              h.Class('btn btn-cream btn-compact'),
              h.Type('button'),
              h.AriaLabel(`Copy invite code ${lobby.code}`),
              h.OnClick(Message.ClickedCopyCode()),
            ],
            [game.isCodeCopied ? 'Copied' : 'Copy'],
          ),
        ],
      ),
      h.button(
        [
          h.Class('btn btn-cream btn-block'),
          h.Type('button'),
          h.OnClick(Message.ClickedShareInvite()),
        ],
        ['Share invite link'],
      ),
    ],
  )

export const lobbyView = (
  game: OnlineGame,
  lobby: LobbySnapshot,
  h: HtmlBuilder<Message>,
): Html =>
  screenFrame(
    [
      h.section(
        [h.Class('panel menu-card lobby'), h.AriaLabelledBy('lobby-title')],
        [
          // NOTE: Two column wrappers so that, held sideways, the invite sits
          // left and the seats right; upright both are display: contents.
          h.div(
            [h.Class('lobby-column is-invite')],
            [
              h.h2(
                [h.Id('lobby-title'), h.Class('menu-heading')],
                [
                  lobby.isRematch
                    ? 'Rematch: same seats'
                    : lobby.isViewerSeated
                      ? 'Invite your friends'
                      : 'Join this game',
                ],
              ),
              inviteBlock(game, lobby, h),
              noticeView(game, h),
              h.p(
                [h.Class('lobby-hint')],
                ['Friends type the code on the home screen, or open the link.'],
              ),
            ],
          ),
          h.div(
            [h.Class('lobby-column is-seats')],
            [
              h.h3(
                [h.Class('lobby-seats-heading')],
                [`Seats: ${lobby.seats.length} of ${MAX_SEATS}`],
              ),
              h.ol(
                [h.Class('lobby-seats'), h.AriaLive('polite')],
                Array.map(lobby.seats, seat => seatRow(lobby, seat, h)),
              ),
              lobby.isViewerSeated
                ? seatedControls(lobby, h)
                : joinForm(game, lobby, h),
            ],
          ),
        ],
      ),
    ],
    h,
    'is-lobby',
  )

export const messageScreen = (
  title: string,
  detail: string,
  h: HtmlBuilder<Message>,
): Html =>
  screenFrame(
    [
      h.section(
        [h.Class('panel menu-card'), h.Role('status')],
        [
          h.h2([h.Class('menu-heading')], [title]),
          h.p([h.Class('menu-detail')], [detail]),
          h.button(
            [
              h.Class('btn btn-red btn-block'),
              h.Type('button'),
              h.OnClick(Message.ClickedMenu()),
            ],
            ['Back to the menu'],
          ),
        ],
      ),
    ],
    h,
  )
