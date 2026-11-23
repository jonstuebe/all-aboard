import { Option } from 'effect'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { type Model, init, update } from './main'
import { Message } from './message'

const openLobby = (): Model =>
  init(
    {
      playerName: 'Ada',
      device: { deviceId: 'd-test', secret: 'secret' },
      now: 0,
    },
    Option.getOrThrow(fromString('http://localhost/g/TRAIN-ABC')),
  ).model

const isCopied = (model: Model): boolean => {
  if (model.screen._tag !== 'Online') {
    throw new Error(`expected an online game, got ${model.screen._tag}`)
  }
  return model.screen.game.isCodeCopied
}

describe('lobby invite code', () => {
  test('Copy asks for the code to be copied and shows Copied once it is', () => {
    const lobby = openLobby()
    expect(isCopied(lobby)).toBe(false)
    const clicked = update(lobby, Message.ClickedCopyCode())
    expect((clicked.commands ?? []).map(command => command.name)).toEqual([
      'CopyInviteCode',
    ])
    expect(
      isCopied(
        update(lobby, Message.CompletedCopyCode({ didCopy: true })).model,
      ),
    ).toBe(true)
  })

  test('a failed copy leaves the button saying Copy', () => {
    const failed = update(
      openLobby(),
      Message.CompletedCopyCode({ didCopy: false }),
    ).model
    expect(isCopied(failed)).toBe(false)
  })
})
