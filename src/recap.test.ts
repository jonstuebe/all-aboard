import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  RecapStage,
  continueTour,
  idleRecap,
  maybeSpotlitPlayer,
  revealOrder,
  spotlight,
  startTour,
} from './recap'

const standings = [
  {
    playerIndex: 2,
    routePoints: 30,
    ticketPoints: 10,
    completedTickets: 2,
    failedTickets: 0,
    total: 40,
  },
  {
    playerIndex: 0,
    routePoints: 20,
    ticketPoints: 5,
    completedTickets: 1,
    failedTickets: 0,
    total: 25,
  },
  {
    playerIndex: 1,
    routePoints: 10,
    ticketPoints: -4,
    completedTickets: 0,
    failedTickets: 1,
    total: 6,
  },
]

describe('the end-of-game tour', () => {
  test('goes from last place to the winner', () => {
    expect(revealOrder(standings)).toEqual([1, 0, 2])
  })

  test('steps through every player, then shows the scores', () => {
    const first = startTour(idleRecap)
    expect(maybeSpotlitPlayer(first.recap, standings)).toEqual(Option.some(1))
    const second = continueTour(first.recap, first.recap.run, 0, 3)
    expect(maybeSpotlitPlayer(second.recap, standings)).toEqual(Option.some(0))
    const third = continueTour(second.recap, second.recap.run, 1, 3)
    const done = continueTour(third.recap, third.recap.run, 2, 3)
    expect(done.recap.stage).toEqual(RecapStage.Scoreboard())
    expect(done.commands).toBeUndefined()
  })

  test('ignores a stale timer after someone taps a player', () => {
    const tour = startTour(idleRecap)
    const tapped = spotlight(tour.recap, 2)
    const late = continueTour(tapped, tour.recap.run, 0, 3)
    expect(late.recap).toEqual(tapped)
    expect(late.commands).toBeUndefined()
  })
})
