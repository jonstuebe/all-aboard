import { Array, Option, Order, Result, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  MAX_SEATS,
  MIN_SEATS,
  type Model,
  Phase,
  type Player,
  type SeatConfig,
  type Standing,
  TONE_COUNT,
  type TurnStep,
} from '../model'
import {
  CARDS_PER_COLOR,
  CARD_COLORS,
  type Card,
  type CardColor,
  FINAL_ROUND_TRAIN_THRESHOLD,
  MARKET_SIZE,
  ROUTES,
  type Route,
  STARTING_HAND_SIZE,
  STARTING_TICKETS,
  STARTING_TRAINS,
  TICKETS,
  WILD_CARDS,
  cityById,
  maybeRouteById,
  routeById,
  routePoints,
  ticketById,
} from './board'
import { shuffle } from './rng'

// ACTIONS

export const PlayerAction = defineTaggedUnion({
  DrewFromDeck: {},
  TookMarketCard: { slot: Schema.Number },
  ClaimedRoute: { routeId: Schema.String },
  DrewTicket: {},
  Passed: {},
})
export type PlayerAction = typeof PlayerAction.Type

// SETUP

export const BOT_NAMES: ReadonlyArray<string> = [
  'Juniper',
  'Rook',
  'Hazel',
  'Ozzie',
  'Marlow',
]

export const clampSeatCount = (count: number): number =>
  Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(count)))

export const localSeats = (
  humanName: string,
  seatCount: number,
): ReadonlyArray<SeatConfig> =>
  Array.makeBy(clampSeatCount(seatCount), (index): SeatConfig =>
    index === 0
      ? { name: humanName, kind: 'Human', tone: 0 }
      : {
          name: pipe(
            BOT_NAMES,
            Array.get(index - 1),
            Option.getOrElse(() => `Bot ${index}`),
          ),
          kind: 'Bot',
          tone: index % TONE_COUNT,
        },
  )

const MAX_TURNS = 240
const MAX_LOG_ENTRIES = 40

const FULL_DECK: ReadonlyArray<Card> = Array.appendAll(
  Array.flatMap(CARD_COLORS, color =>
    Array.makeBy(CARDS_PER_COLOR, (): Card => color),
  ),
  Array.makeBy(WILD_CARDS, (): Card => 'Wild'),
)

export const emptyModel = (gameId: number): Model => ({
  gameId,
  phase: Phase.Dealing(),
  rngState: gameId,
  players: [],
  currentPlayerIndex: 0,
  deck: [],
  discard: [],
  market: [],
  ticketPile: [],
  claims: [],
  maybeFinalTurnsLeft: Option.none(),
  turnNumber: 0,
  log: [],
  nextLogId: 0,
})

export const newGame = (
  seed: number,
  seats: ReadonlyArray<SeatConfig>,
): Model => {
  const [deck, deckState] = shuffle(FULL_DECK, seed)
  const [ticketIds, ticketState] = shuffle(
    Array.map(TICKETS, ticket => ticket.id),
    deckState,
  )
  const players = Array.map(seats, (seat, index): Player => ({
    name: seat.name,
    kind: seat.kind,
    tone: seat.tone,
    hand: pipe(
      deck,
      Array.drop(index * STARTING_HAND_SIZE),
      Array.take(STARTING_HAND_SIZE),
    ),
    trains: STARTING_TRAINS,
    routePoints: 0,
    ticketIds: pipe(
      ticketIds,
      Array.drop(index * STARTING_TICKETS),
      Array.take(STARTING_TICKETS),
    ),
  }))
  const dealtCards = seats.length * STARTING_HAND_SIZE
  const dealtTickets = seats.length * STARTING_TICKETS

  const dealt = modifyFields(emptyModel(seed), {
    phase: () => Phase.Playing({ step: 'ChoosingAction' }),
    rngState: () => ticketState,
    players: () => players,
    deck: () => Array.drop(deck, dealtCards),
    market: () => Array.makeBy(MARKET_SIZE, () => Option.none<Card>()),
    ticketPile: () => Array.drop(ticketIds, dealtTickets),
  })

  return pipe(dealt, refillMarket, normalizeMarket, model =>
    addLog(
      model,
      0,
      'New game. Connect your tickets before the trains run out.',
    ),
  )
}

// QUERIES

export const playerAt = (model: Model, playerIndex: number): Player =>
  pipe(
    model.players,
    Array.get(playerIndex),
    Option.getOrThrowWith(() => new Error(`No player ${playerIndex}`)),
  )

export const currentPlayer = (model: Model): Player =>
  playerAt(model, model.currentPlayerIndex)

export const maybeTurnStep = (model: Model): Option.Option<TurnStep> =>
  Phase.match<Option.Option<TurnStep>>(model.phase, {
    Dealing: () => Option.none(),
    Playing: ({ step }) => Option.some(step),
    GameOver: () => Option.none(),
  })

export const isBotControlled = (player: Player): boolean =>
  player.kind !== 'Human'

export const isHumanTurn = (model: Model): boolean =>
  Option.isSome(maybeTurnStep(model)) && !isBotControlled(currentPlayer(model))

export const isBotTurn = (model: Model): boolean =>
  Option.isSome(maybeTurnStep(model)) && isBotControlled(currentPlayer(model))

export const countCards = (hand: ReadonlyArray<Card>, card: Card): number =>
  Array.filter(hand, held => held === card).length

export const marketCardAt = (model: Model, slot: number): Option.Option<Card> =>
  pipe(model.market, Array.get(slot), Option.flatten)

export const canDrawFromDeck = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(model.deck) ||
  Array.isReadonlyArrayNonEmpty(model.discard)

export const canTakeMarketCard = (
  model: Model,
  slot: number,
  step: TurnStep,
): boolean =>
  Option.match(marketCardAt(model, slot), {
    onNone: () => false,
    onSome: card => !(step === 'DrawingSecondCard' && card === 'Wild'),
  })

const canDrawSecondCard = (model: Model): boolean =>
  canDrawFromDeck(model) ||
  Array.some(Array.range(0, MARKET_SIZE - 1), slot =>
    canTakeMarketCard(model, slot, 'DrawingSecondCard'),
  )

export type HasClaims = Readonly<{ claims: Model['claims'] }>

export const maybeRouteOwner = (
  model: HasClaims,
  routeId: string,
): Option.Option<number> =>
  pipe(
    model.claims,
    Array.findFirst(claim => claim.routeId === routeId),
    Option.map(claim => claim.playerIndex),
  )

// PAYMENT

export type Payment = Readonly<{
  color: CardColor
  colored: number
  wilds: number
}>

const paymentInColor = (
  hand: ReadonlyArray<Card>,
  color: CardColor,
  length: number,
): Option.Option<Payment> => {
  const colored = Math.min(countCards(hand, color), length)
  const wilds = length - colored
  return countCards(hand, 'Wild') >= wilds
    ? Option.some({ color, colored, wilds })
    : Option.none()
}

export const findPayment = (
  hand: ReadonlyArray<Card>,
  route: Route,
): Option.Option<Payment> =>
  route.color === 'Gray'
    ? pipe(
        CARD_COLORS,
        Array.map(color => paymentInColor(hand, color, route.length)),
        Array.getSomes,
        Array.sort(
          Order.mapInput(Order.Number, (payment: Payment) => payment.wilds),
        ),
        Array.head,
      )
    : paymentInColor(hand, route.color, route.length)

export const maybeClaimPayment = (
  model: Model,
  playerIndex: number,
  routeId: string,
): Option.Option<Payment> => {
  const route = routeById(routeId)
  const player = playerAt(model, playerIndex)
  if (Option.isSome(maybeRouteOwner(model, routeId))) {
    return Option.none()
  }
  if (player.trains < route.length) {
    return Option.none()
  }
  return findPayment(player.hand, route)
}

export const claimBlockReason = (
  model: Model,
  playerIndex: number,
  routeId: string,
): string => {
  const route = routeById(routeId)
  const player = playerAt(model, playerIndex)
  const routeName = `${cityById(route.from).name} to ${cityById(route.to).name}`
  return Option.match(maybeRouteOwner(model, routeId), {
    onSome: owner =>
      `${playerAt(model, owner).name} already owns ${routeName}.`,
    onNone: () =>
      player.trains < route.length
        ? `${routeName} needs ${route.length} trains and you have ${player.trains}.`
        : route.color === 'Gray'
          ? `${routeName} needs ${route.length} cards of one color. Wilds fill gaps.`
          : `${routeName} needs ${route.length} ${route.color} cards. Wilds fill gaps.`,
  })
}

// TICKETS

const reachableCities = (
  model: HasClaims,
  playerIndex: number,
  start: string,
) => {
  const ownedRoutes = Array.filter(ROUTES, route =>
    Option.contains(maybeRouteOwner(model, route.id), playerIndex),
  )
  const neighborsOf = (cityId: string): ReadonlyArray<string> =>
    Array.getSomes(
      Array.map(ownedRoutes, route =>
        route.from === cityId
          ? Option.some(route.to)
          : route.to === cityId
            ? Option.some(route.from)
            : Option.none(),
      ),
    )
  const explore = (
    frontier: ReadonlyArray<string>,
    visited: ReadonlyArray<string>,
  ): ReadonlyArray<string> =>
    Array.match(frontier, {
      onEmpty: () => visited,
      onNonEmpty: ([cityId, ...rest]) => {
        const unseen = Array.filter(
          neighborsOf(cityId),
          neighbor => !Array.contains(visited, neighbor),
        )
        return explore(
          Array.appendAll(rest, unseen),
          Array.appendAll(visited, unseen),
        )
      },
    })
  return explore([start], [start])
}

export const isTicketComplete = (
  model: HasClaims,
  playerIndex: number,
  ticketId: string,
): boolean => {
  const ticket = ticketById(ticketId)
  return Array.contains(
    reachableCities(model, playerIndex, ticket.from),
    ticket.to,
  )
}

export const standings = (model: Model): ReadonlyArray<Standing> =>
  pipe(
    model.players,
    Array.map((player, playerIndex): Standing => {
      const completed = Array.filter(player.ticketIds, ticketId =>
        isTicketComplete(model, playerIndex, ticketId),
      )
      const failed = Array.filter(
        player.ticketIds,
        ticketId => !isTicketComplete(model, playerIndex, ticketId),
      )
      const ticketPoints =
        Array.reduce(completed, 0, (sum, id) => sum + ticketById(id).points) -
        Array.reduce(failed, 0, (sum, id) => sum + ticketById(id).points)
      return {
        playerIndex,
        routePoints: player.routePoints,
        ticketPoints,
        completedTickets: completed.length,
        failedTickets: failed.length,
        total: player.routePoints + ticketPoints,
      }
    }),
    Array.sort(
      Order.flip(
        Order.mapInput(Order.Number, (standing: Standing) => standing.total),
      ),
    ),
  )

// HELPERS

export const addLog = (
  model: Model,
  playerIndex: number,
  text: string,
  maybeSelfText: Option.Option<string> = Option.none(),
): Model =>
  modifyFields(model, {
    log: log =>
      Array.takeRight(
        Array.append(log, {
          id: model.nextLogId,
          playerIndex,
          text,
          maybeSelfText,
        }),
        MAX_LOG_ENTRIES,
      ),
    nextLogId: id => id + 1,
  })

const addSeatLog = (
  model: Model,
  playerIndex: number,
  text: string,
  selfText: string,
): Model => addLog(model, playerIndex, text, Option.some(selfText))

const modifyPlayer = (
  model: Model,
  playerIndex: number,
  modify: (player: Player) => Player,
): Model =>
  modifyFields(model, {
    players: players =>
      Array.map(players, (player, index) =>
        index === playerIndex ? modify(player) : player,
      ),
  })

// NOTE: Array.makeBy normalizes a count of 0 up to 1, so zero needs its own branch.
const repeatCard = (card: Card, count: number): ReadonlyArray<Card> =>
  count <= 0 ? [] : Array.makeBy(count, () => card)

const removeCards = (
  hand: ReadonlyArray<Card>,
  card: Card,
  count: number,
): ReadonlyArray<Card> =>
  Array.reduce(
    hand,
    { kept: Array.empty<Card>(), removed: 0 },
    (accumulator, held) =>
      held === card && accumulator.removed < count
        ? { kept: accumulator.kept, removed: accumulator.removed + 1 }
        : {
            kept: Array.append(accumulator.kept, held),
            removed: accumulator.removed,
          },
  ).kept

const reshuffleDiscard = (model: Model): Model => {
  const [deck, rngState] = shuffle(model.discard, model.rngState)
  return addLog(
    modifyFields(model, {
      deck: () => deck,
      discard: () => [],
      rngState: () => rngState,
    }),
    model.currentPlayerIndex,
    'The discard pile was shuffled into a new deck.',
  )
}

const drawTop = (model: Model): readonly [Option.Option<Card>, Model] => {
  const ready =
    Array.isReadonlyArrayEmpty(model.deck) &&
    Array.isReadonlyArrayNonEmpty(model.discard)
      ? reshuffleDiscard(model)
      : model
  return Array.match(ready.deck, {
    onEmpty: () => [Option.none(), ready] as const,
    onNonEmpty: ([top, ...rest]) =>
      [Option.some(top), modifyFields(ready, { deck: () => rest })] as const,
  })
}

const setMarketSlot = (
  model: Model,
  slot: number,
  maybeCard: Option.Option<Card>,
): Model =>
  modifyFields(model, {
    market: market =>
      Array.map(market, (current, index) =>
        index === slot ? maybeCard : current,
      ),
  })

const fillSlot = (model: Model, slot: number): Model => {
  if (Option.isSome(marketCardAt(model, slot))) {
    return model
  }
  const [maybeCard, drawn] = drawTop(model)
  return setMarketSlot(drawn, slot, maybeCard)
}

const refillMarket = (model: Model): Model =>
  Array.reduce(Array.range(0, MARKET_SIZE - 1), model, fillSlot)

const MARKET_WILD_LIMIT = 3

const normalizeMarket = (model: Model): Model => {
  const attempt = (current: Model, attemptsLeft: number): Model => {
    const wildCount = Array.filter(current.market, maybeCard =>
      Option.contains(maybeCard, 'Wild'),
    ).length
    if (wildCount < MARKET_WILD_LIMIT || attemptsLeft === 0) {
      return current
    }
    const cleared = modifyFields(current, {
      discard: discard =>
        Array.appendAll(discard, Array.getSomes(current.market)),
      market: market => Array.map(market, () => Option.none<Card>()),
    })
    return attempt(
      addLog(
        refillMarket(cleared),
        current.currentPlayerIndex,
        'Three wilds showed face up, so the market was replaced.',
      ),
      attemptsLeft - 1,
    )
  }
  return attempt(model, 3)
}

// TURN FLOW

const endTurn = (model: Model): Model => {
  const player = currentPlayer(model)
  const maybeFinalTurnsLeft = Option.match(model.maybeFinalTurnsLeft, {
    onSome: turnsLeft => Option.some(turnsLeft - 1),
    onNone: () =>
      player.trains <= FINAL_ROUND_TRAIN_THRESHOLD
        ? Option.some(model.players.length)
        : Option.none(),
  })
  const triggeredFinalRound =
    Option.isNone(model.maybeFinalTurnsLeft) &&
    Option.isSome(maybeFinalTurnsLeft)
  const announced = triggeredFinalRound
    ? addSeatLog(
        model,
        model.currentPlayerIndex,
        `${player.name} is down to ${player.trains} trains. Everyone gets one last turn.`,
        `You are down to ${player.trains} trains. Everyone gets one last turn.`,
      )
    : model

  const isOver =
    Option.contains(maybeFinalTurnsLeft, 0) || model.turnNumber + 1 >= MAX_TURNS

  if (isOver) {
    const finished = modifyFields(announced, {
      maybeFinalTurnsLeft: () => maybeFinalTurnsLeft,
    })
    return modifyFields(finished, {
      phase: () => Phase.GameOver({ standings: standings(finished) }),
    })
  }

  return modifyFields(announced, {
    phase: () => Phase.Playing({ step: 'ChoosingAction' }),
    currentPlayerIndex: index => (index + 1) % model.players.length,
    maybeFinalTurnsLeft: () => maybeFinalTurnsLeft,
    turnNumber: turnNumber => turnNumber + 1,
  })
}

const afterDraw = (model: Model, step: TurnStep, endsTurn: boolean): Model =>
  step === 'ChoosingAction' && !endsTurn && canDrawSecondCard(model)
    ? modifyFields(model, {
        phase: () => Phase.Playing({ step: 'DrawingSecondCard' }),
      })
    : endTurn(model)

export type ActionResult = Result.Result<Model, string>

const accept = (model: Model): ActionResult => Result.succeed(model)

const reject = (reason: string): ActionResult => Result.fail(reason)

const cardName = (card: Card): string =>
  card === 'Wild' ? 'wild' : card.toLowerCase()

export const hasAnyMove = (model: Model, playerIndex: number): boolean =>
  canDrawFromDeck(model) ||
  Array.some(model.market, Option.isSome) ||
  Array.isReadonlyArrayNonEmpty(model.ticketPile) ||
  Array.some(ROUTES, route =>
    Option.isSome(maybeClaimPayment(model, playerIndex, route.id)),
  )

const applyInStep = (
  model: Model,
  step: TurnStep,
  action: PlayerAction,
): ActionResult => {
  const playerIndex = model.currentPlayerIndex
  const player = currentPlayer(model)

  return PlayerAction.match<ActionResult>(action, {
    DrewFromDeck: () => {
      const [maybeCard, drawn] = drawTop(model)
      return Option.match(maybeCard, {
        onNone: () => reject('The deck and discard pile are empty.'),
        onSome: card =>
          accept(
            afterDraw(
              addSeatLog(
                modifyPlayer(drawn, playerIndex, held =>
                  modifyFields(held, {
                    hand: hand => Array.append(hand, card),
                  }),
                ),
                playerIndex,
                `${player.name} drew from the deck.`,
                `You drew a ${cardName(card)} card from the deck.`,
              ),
              step,
              false,
            ),
          ),
      })
    },

    TookMarketCard: ({ slot }) =>
      Option.match(marketCardAt(model, slot), {
        onNone: () => reject('That market slot is empty.'),
        onSome: card => {
          if (step === 'DrawingSecondCard' && card === 'Wild') {
            return reject(
              'A face-up wild uses your whole turn, so it can only be your first draw.',
            )
          }
          const taken = pipe(
            setMarketSlot(model, slot, Option.none()),
            current =>
              modifyPlayer(current, playerIndex, held =>
                modifyFields(held, { hand: hand => Array.append(hand, card) }),
              ),
            refillMarket,
            normalizeMarket,
          )
          return accept(
            afterDraw(
              addSeatLog(
                taken,
                playerIndex,
                `${player.name} took a face-up ${cardName(card)} card.`,
                `You took a face-up ${cardName(card)} card.`,
              ),
              step,
              card === 'Wild',
            ),
          )
        },
      }),

    ClaimedRoute: ({ routeId }) => {
      if (step === 'DrawingSecondCard') {
        return reject('Draw your second card to finish this turn.')
      }
      if (Option.isNone(maybeRouteById(routeId))) {
        return reject('That route does not exist.')
      }
      return Option.match(maybeClaimPayment(model, playerIndex, routeId), {
        onNone: () => reject(claimBlockReason(model, playerIndex, routeId)),
        onSome: payment => {
          const route = routeById(routeId)
          const spent: ReadonlyArray<Card> = Array.appendAll(
            repeatCard(payment.color, payment.colored),
            repeatCard('Wild', payment.wilds),
          )
          const claimed = pipe(
            modifyPlayer(model, playerIndex, held =>
              modifyFields(held, {
                hand: hand =>
                  removeCards(
                    removeCards(hand, payment.color, payment.colored),
                    'Wild',
                    payment.wilds,
                  ),
                trains: trains => trains - route.length,
                routePoints: points => points + routePoints(route.length),
              }),
            ),
            current =>
              modifyFields(current, {
                claims: claims =>
                  Array.append(claims, { routeId, playerIndex }),
                discard: discard => Array.appendAll(discard, spent),
              }),
          )
          const routeName = `${cityById(route.from).name} to ${cityById(route.to).name}`
          const points = routePoints(route.length)
          return accept(
            endTurn(
              addSeatLog(
                claimed,
                playerIndex,
                `${player.name} claimed ${routeName} for ${points} points.`,
                `You claimed ${routeName} for ${points} points.`,
              ),
            ),
          )
        },
      })
    },

    DrewTicket: () => {
      if (step === 'DrawingSecondCard') {
        return reject('Draw your second card to finish this turn.')
      }
      return Array.match(model.ticketPile, {
        onEmpty: () => reject('No destination tickets are left.'),
        onNonEmpty: ([ticketId, ...rest]) => {
          const ticket = ticketById(ticketId)
          const drawn = modifyFields(
            modifyPlayer(model, playerIndex, held =>
              modifyFields(held, {
                ticketIds: ticketIds => Array.append(ticketIds, ticketId),
              }),
            ),
            { ticketPile: () => rest },
          )
          return accept(
            endTurn(
              addSeatLog(
                drawn,
                playerIndex,
                `${player.name} took a destination ticket.`,
                `You took a ticket: ${cityById(ticket.from).name} to ${cityById(ticket.to).name}, ${ticket.points} points.`,
              ),
            ),
          )
        },
      })
    },

    Passed: () => {
      if (step === 'ChoosingAction' && hasAnyMove(model, playerIndex)) {
        return reject('You still have a move, so you can’t pass.')
      }
      return accept(
        endTurn(
          step === 'DrawingSecondCard'
            ? addSeatLog(
                model,
                playerIndex,
                `${player.name} ended the turn after one card.`,
                'You ended your turn after one card.',
              )
            : addSeatLog(
                model,
                playerIndex,
                `${player.name} passed.`,
                'You passed.',
              ),
        ),
      )
    },
  })
}

export const applyAction = (model: Model, action: PlayerAction): ActionResult =>
  Option.match(maybeTurnStep(model), {
    onNone: () => reject('The game is not in progress.'),
    onSome: step => applyInStep(model, step, action),
  })

// NOTE: applyAction trusts that the current player is acting. Anything that
// acts on behalf of a seat (the server, the local table) goes through actAs,
// which checks the seat first.
export const actAs = (
  model: Model,
  seatIndex: number,
  action: PlayerAction,
): ActionResult => {
  if (Option.isNone(maybeTurnStep(model))) {
    return reject('The game is not in progress.')
  }
  if (seatIndex !== model.currentPlayerIndex) {
    return reject('It’s not your turn.')
  }
  return applyAction(model, action)
}

export const handSeatToBot = (model: Model, seatIndex: number): Model =>
  Option.match(Array.get(model.players, seatIndex), {
    onNone: () => model,
    onSome: player =>
      player.kind !== 'Human'
        ? model
        : addLog(
            modifyPlayer(model, seatIndex, held =>
              modifyFields(held, { kind: () => 'LeftToBot' }),
            ),
            seatIndex,
            `${player.name} left the game. A bot took the seat.`,
          ),
  })

// NOTE: A player who leaves an online game hands their seat to a bot. The
// bot keeps the name, hand, tickets, trains and score; only who decides the
// moves changes. The log notes it so everyone sees why the seat changed.
export const handOffToBot = (model: Model, seatIndex: number): Model =>
  modifyFields(model, {
    players: players =>
      Array.map(players, (player, index) =>
        index === seatIndex
          ? modifyFields(player, { kind: () => 'Bot' as const })
          : player,
      ),
  })
