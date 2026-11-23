import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import type { ClientView } from './domain/clientView'
import { Phase } from './model'
import { idleRecap, showScoreboard, spotlight, startTour } from './recap'
import { gameCues, recapCues } from './sound'

const player = (overrides: Partial<ClientView['players'][number]> = {}) => ({
  name: 'Ada',
  kind: 'Human' as const,
  tone: 0,
  hand: [],
  handCount: 4,
  trains: 14,
  routePoints: 0,
  ticketIds: [],
  ticketCount: 2,
  ...overrides,
})

const view = (overrides: Partial<ClientView> = {}): ClientView => ({
  viewerIndex: -1,
  phase: Phase.Playing({ step: 'ChoosingAction' }),
  players: [player(), player({ name: 'Bea', tone: 1 })],
  currentPlayerIndex: 0,
  deckCount: 30,
  discardCount: 0,
  market: [],
  ticketPileCount: 5,
  claims: [],
  maybeFinalTurnsLeft: Option.none(),
  turnNumber: 1,
  log: [],
  ...overrides,
})

const sounds = (cues: ReturnType<typeof gameCues>) => cues.map(cue => cue.sound)

describe('game sounds', () => {
  test('a claimed route chugs, then the next turn chimes', () => {
    const before = view()
    const after = view({
      claims: [{ routeId: 'r2', playerIndex: 0 }],
      currentPlayerIndex: 1,
    })
    const cues = gameCues(before, after)
    expect(sounds(cues)).toEqual(['Claim', 'Turn'])
    expect(cues[0]?.size).toBe(3)
  })

  test('drawing a card flicks, and passing the turn chimes after it', () => {
    const before = view()
    const after = view({
      players: [player({ handCount: 6 }), player({ name: 'Bea', tone: 1 })],
      currentPlayerIndex: 1,
    })
    const cues = gameCues(before, after)
    expect(sounds(cues)).toEqual(['Card', 'Turn'])
    expect(cues[1]?.at).toBeGreaterThan(0)
  })

  test('taking tickets rustles', () => {
    const after = view({
      players: [player({ ticketCount: 3 }), player({ name: 'Bea', tone: 1 })],
    })
    expect(sounds(gameCues(view(), after))).toEqual(['Ticket'])
  })

  test('the final round rings a bell', () => {
    const after = view({ maybeFinalTurnsLeft: Option.some(2) })
    expect(sounds(gameCues(view(), after))).toEqual(['FinalRound'])
  })

  test('game over whistles once', () => {
    const over = view({ phase: Phase.GameOver({ standings: [] }) })
    expect(sounds(gameCues(view(), over))).toEqual(['GameOver'])
    expect(gameCues(over, over)).toEqual([])
  })

  test('nothing changed, nothing plays', () => {
    expect(gameCues(view(), view())).toEqual([])
  })
})

describe('recap sounds', () => {
  const standings = [
    { playerIndex: 1, routePoints: 4, ticketPoints: 0, completedTickets: 0, failedTickets: 0, total: 4 },
    { playerIndex: 0, routePoints: 0, ticketPoints: 0, completedTickets: 0, failedTickets: 0, total: 0 },
  ]
  const over = view({ phase: Phase.GameOver({ standings }) })

  test('each new spotlight swooshes and ends on its total', () => {
    const tour = startTour(idleRecap).recap
    const cues = recapCues(idleRecap, tour, over, [[], []], standings)
    expect(cues[0]?.sound).toBe('Reveal')
    expect(cues.at(-1)?.sound).toBe('Total')
    const winner = recapCues(tour, spotlight(tour, 1), over, [[], []], standings)
    expect(winner.at(-1)?.sound).toBe('WinnerTotal')
  })

  test('the scoreboard plays a fanfare and a tick per row', () => {
    const tour = startTour(idleRecap).recap
    const cues = recapCues(tour, showScoreboard(tour), over, [[], []], standings)
    expect(sounds(cues)).toEqual(['Scoreboard', 'RowTick', 'RowTick'])
  })

  test('an unchanged recap stays quiet', () => {
    const tour = startTour(idleRecap).recap
    expect(recapCues(tour, tour, over, [[], []], standings)).toEqual([])
  })
})
