import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { pingStatus } from './pings'

describe('pingStatus', () => {
  const at = (availableAt: number, canPing = true) => ({
    canPing,
    maybePingAvailableAt: Option.some(availableAt),
  })

  test('hidden when the server says pinging makes no sense', () => {
    expect(pingStatus(at(0, false), false, 1_000)._tag).toBe('Hidden')
  })

  test('ready once the cooldown has passed', () => {
    expect(pingStatus(at(1_000), false, 1_000)._tag).toBe('Ready')
  })

  test('counts down the minutes left, rounding up', () => {
    expect(pingStatus(at(61 * 60_000), false, 60_000)).toMatchObject({
      _tag: 'Waiting',
      minutesLeft: 60,
    })
    expect(pingStatus(at(90_001), false, 60_000)).toMatchObject({
      minutesLeft: 1,
    })
  })

  test('shows sending while a ping is in flight', () => {
    expect(pingStatus(at(0), true, 1_000)._tag).toBe('Sending')
  })
})
