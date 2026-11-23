import { Option } from 'effect'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { type Model, init, update } from './main'
import { Message } from './message'
import { hasStats } from './screens/menu'

// NOTE: These drive the real init and update, so they cover the wizard's
// Messages as the app sees them, not only the pure step helpers.

const homeUrl = Option.getOrThrow(fromString('http://localhost/'))

const start = (playerName: string): Model =>
  init(
    {
      playerName,
      device: { deviceId: 'd-test', secret: 'secret' },
      now: 0,
    },
    homeUrl,
  ).model

const send = (model: Model, ...messages: ReadonlyArray<Message>): Model =>
  messages.reduce((current, message) => update(current, message).model, model)

const home = (model: Model) => {
  if (model.screen._tag !== 'Home') {
    throw new Error(`expected the home screen, got ${model.screen._tag}`)
  }
  return model.screen.home
}

const commandNames = (model: Model, message: Message): ReadonlyArray<string> =>
  (update(model, message).commands ?? []).map(command => command.name)

describe('home wizard', () => {
  test('a new device starts on the name step', () => {
    expect(home(start('')).step).toBe('Name')
  })

  test('a remembered name skips the name step', () => {
    const model = start('Ada')
    expect(home(model).step).toBe('Mode')
    expect(home(model).firstStep).toBe('Mode')
  })

  test('Continue needs a name, then saves it and moves to the mode step', () => {
    const blank = start('')
    expect(home(send(blank, Message.SubmittedName())).step).toBe('Name')
    expect(commandNames(blank, Message.SubmittedName())).toEqual([])

    const named = send(blank, Message.UpdatedNameInput({ value: '  Ada ' }))
    const next = send(named, Message.SubmittedName())
    expect(home(next).step).toBe('Mode')
    expect(home(next).direction).toBe('Forward')
    expect(commandNames(named, Message.SubmittedName())).toEqual([
      'SavePlayerName',
    ])
  })

  test('typing a name saves it through a Command', () => {
    expect(
      commandNames(start(''), Message.UpdatedNameInput({ value: 'Ada' })),
    ).toEqual(['SavePlayerName'])
  })

  test('Play with bots goes to the players step, and the count sticks', () => {
    const bots = send(start('Ada'), Message.ClickedPlayWithBots())
    expect(home(bots).step).toBe('Bots')
    const five = send(bots, Message.ClickedSeatCount({ count: 5 }))
    expect(five.seatCount).toBe(5)
    expect(send(five, Message.ClickedSeatCount({ count: 9 })).seatCount).toBe(5)
    expect(send(five, Message.ClickedSeatCount({ count: 1 })).seatCount).toBe(2)
  })

  test('Start with bots leaves the home screen for a local table', () => {
    const bots = send(start('Ada'), Message.ClickedPlayWithBots())
    expect(send(bots, Message.ClickedNewBotGame()).screen._tag).toBe('Local')
  })

  test('Play with friends opens a lobby straight from the mode step', () => {
    const model = start('Ada')
    expect(home(send(model, Message.ClickedNewFriendGame())).create._tag).toBe(
      'Creating',
    )
    expect(commandNames(model, Message.ClickedNewFriendGame())).toEqual([
      'CreateFriendGame',
    ])
  })

  test('the join path takes a code and navigates to its game', () => {
    const join = send(start('Ada'), Message.ClickedHaveInviteCode())
    expect(home(join).step).toBe('Join')
    const typed = send(join, Message.UpdatedJoinCode({ value: 'train-4k7' }))
    expect(commandNames(typed, Message.SubmittedJoinCode())).toEqual([
      'Navigate',
    ])
    const bad = send(
      join,
      Message.UpdatedJoinCode({ value: 'not a code!' }),
      Message.SubmittedJoinCode(),
    )
    expect(home(bad).create._tag).toBe('Failed')
  })

  test('Back returns to the mode step from players and from the code', () => {
    for (const choose of [
      Message.ClickedPlayWithBots(),
      Message.ClickedHaveInviteCode(),
    ]) {
      const back = send(start('Ada'), choose, Message.ClickedWizardBack())
      expect(home(back).step).toBe('Mode')
      expect(home(back).direction).toBe('Back')
    }
  })

  test('Back from the mode step returns to the name only if it came first', () => {
    const named = send(
      start(''),
      Message.UpdatedNameInput({ value: 'Ada' }),
      Message.SubmittedName(),
      Message.ClickedWizardBack(),
    )
    expect(home(named).step).toBe('Name')

    const remembered = send(start('Ada'), Message.ClickedWizardBack())
    expect(home(remembered).step).toBe('Mode')
  })

  test('Change goes back to the name step with the name kept', () => {
    const changed = send(start('Ada'), Message.ClickedChangeName())
    expect(home(changed).step).toBe('Name')
    expect(changed.playerName).toBe('Ada')
  })
})

describe('stats card', () => {
  const stats = {
    gamesPlayed: 0,
    wins: 0,
    totalScore: 0,
    longestRoute: 0,
    ticketsCompleted: 0,
  }

  test('is hidden until a game has finished', () => {
    expect(hasStats(stats)).toBe(false)
    expect(hasStats({ ...stats, gamesPlayed: 1 })).toBe(true)
  })
})
