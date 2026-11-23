// PROTOTYPE, throwaway (branch prototype/home-variants).
// The floating variant switcher from the prototype skill: a pill at the
// bottom centre with previous/next arrows and the current variant's label.
// Rendered only in dev builds (import.meta.env.DEV).

import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './message'

export type PrototypeVariant = Readonly<{ key: string; name: string }>

export const variantFromSearch = (
  variants: ReadonlyArray<PrototypeVariant>,
  maybeSearch: Option.Option<string>,
): string => {
  const requested = Option.match(maybeSearch, {
    onNone: () => '',
    onSome: search => new URLSearchParams(search).get('variant') ?? '',
  }).toUpperCase()
  return Array.some(variants, variant => variant.key === requested)
    ? requested
    : (variants[0]?.key ?? 'A')
}

export const stepVariant = (
  variants: ReadonlyArray<PrototypeVariant>,
  current: string,
  step: number,
): string => {
  const index = Math.max(
    0,
    variants.findIndex(variant => variant.key === current),
  )
  const next = (index + step + variants.length) % variants.length
  return variants[next]?.key ?? current
}

export const prototypeSwitcher = (
  variants: ReadonlyArray<PrototypeVariant>,
  current: string,
  h: HtmlBuilder<Message>,
): Html => {
  if (!import.meta.env.DEV) {
    return h.empty
  }
  const label = Option.match(
    Array.findFirst(variants, variant => variant.key === current),
    {
      onNone: () => current,
      onSome: variant => `${variant.key} (${variant.name})`,
    },
  )
  return h.div(
    [
      h.Class('proto-switcher'),
      h.Role('toolbar'),
      h.AriaLabel('Prototype variants'),
    ],
    [
      h.button(
        [
          h.Class('proto-arrow'),
          h.Type('button'),
          h.AriaLabel('Previous variant'),
          h.OnClick(Message.SteppedHomeVariant({ step: -1 })),
        ],
        ['←'],
      ),
      h.span([h.Class('proto-label'), h.AriaLive('polite')], [label]),
      h.button(
        [
          h.Class('proto-arrow'),
          h.Type('button'),
          h.AriaLabel('Next variant'),
          h.OnClick(Message.SteppedHomeVariant({ step: 1 })),
        ],
        ['→'],
      ),
    ],
  )
}

// NOTE: Arrow keys cycle variants, except while typing in a field.
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)
