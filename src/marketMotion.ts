import { Effect, Stream } from 'effect'
import type { Mount } from 'foldkit'

import { HAND_CARD_DATA } from './handMotion'
import { DOCK_TAB_DATA } from './segmentDrag'

// Animates the draw row. When a face-up card is taken, a copy of it flies
// off (to the Hand tab, or the hand panel on wide screens, when it was
// yours; up and away when a bot took it) and the card that replaces it
// deals in from the deck. A blind draw from the deck turns the card over
// big in the middle of the screen, holds it there so you can see what you
// got, then sends it to your hand.
//
// The view tags each slot with `data-face` (its color, or `empty`) and the
// deck with `data-count`. This watches those attributes instead of the
// model, so it needs no Message and stays silent for the element's
// lifetime. Ghosts live in document.body, where the renderer never looks.

/** Data attribute (no `data-` prefix) holding a slot's card color. */
export const MARKET_FACE_DATA = 'face'
/** Data attribute (no `data-` prefix) holding the deck's card count. */
export const DECK_COUNT_DATA = 'count'

const FACE = `data-${MARKET_FACE_DATA}`
const COUNT = `data-${DECK_COUNT_DATA}`
const FLY_MS = 460
const DEAL_MS = 420
const DEAL_DELAY_MS = 110
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)'
const REVEAL_IN_MS = 420
const REVEAL_HOLD_MS = 900
const REVEAL_OUT_MS = 440
const REVEAL_WIDTH = 132
const HAND_KEY = `data-${HAND_CARD_DATA}`

// Boxes are kept relative to the row, so a scroll between renders
// doesn't throw them off.
type Box = Readonly<{ x: number; y: number; width: number; height: number }>

type Slot = Readonly<{
  face: string
  enabled: boolean
  ghost: Element | null
  box: Box
}>

type Snapshot = Readonly<{
  slots: ReadonlyArray<Slot>
  deckCount: number
  deckEnabled: boolean
  deckGhost: Element | null
  deckBox: Box | null
  handCounts: ReadonlyMap<string, number>
}>

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const slotItems = (list: HTMLElement): ReadonlyArray<HTMLElement> =>
  Array.from(list.querySelectorAll<HTMLElement>(`:scope > li[${FACE}]`))

const deckItem = (list: HTMLElement): HTMLElement | null =>
  list.querySelector<HTMLElement>(`:scope > li[${COUNT}]`)

const buttonIn = (item: HTMLElement): HTMLButtonElement | null =>
  item.querySelector('button')

const copyOf = (element: Element | null): Element | null => {
  const copy = element?.cloneNode(true)
  return copy instanceof Element ? copy : null
}

const isShown = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element.getClientRects().length > 0

const boxIn = (list: HTMLElement, element: Element): Box => {
  const base = list.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left - base.left,
    y: rect.top - base.top,
    width: rect.width,
    height: rect.height,
  }
}

const onScreen = (list: HTMLElement, box: Box): DOMRect => {
  const base = list.getBoundingClientRect()
  return new DOMRect(base.left + box.x, base.top + box.y, box.width, box.height)
}

// The hand row lists each color you hold once, labelled "<count> <color>".
// It stays in the page on phones even while another dock tab shows.
const handCards = (): ReadonlyArray<HTMLElement> =>
  Array.from(
    document.querySelectorAll<HTMLElement>(`.panel.hand li[${HAND_KEY}]`),
  )

const handCounts = (): ReadonlyMap<string, number> =>
  new Map(
    handCards().map(card => [
      card.getAttribute(HAND_KEY) ?? '',
      Number.parseInt(card.getAttribute('aria-label') ?? '0', 10) || 0,
    ]),
  )

// The color that gained a card between two renders, as a copy of its hand
// card without the count badge.
const drawnCardFace = (before: ReadonlyMap<string, number>): Element | null => {
  const gained = handCards().find(card => {
    const color = card.getAttribute(HAND_KEY) ?? ''
    return (handCounts().get(color) ?? 0) > (before.get(color) ?? 0)
  })
  const face = copyOf(gained ?? null)
  face?.querySelector('.hand-count')?.remove()
  return face
}

const snapshot = (list: HTMLElement): Snapshot => {
  const deck = deckItem(list)
  const deckButton = deck === null ? null : buttonIn(deck)
  // On phones the deck is a wide button with a small card back on it;
  // the card back is what flies.
  const deckBack = deckButton?.querySelector('.card-back') ?? deckButton
  return {
    slots: slotItems(list).map(item => {
      const button = buttonIn(item)
      return {
        face: item.getAttribute(FACE) ?? 'empty',
        enabled: button !== null && !button.disabled,
        ghost: copyOf(button),
        box: boxIn(list, button ?? item),
      }
    }),
    deckCount: Number(deck?.getAttribute(COUNT) ?? 0),
    deckEnabled: deckButton !== null && !deckButton.disabled,
    deckGhost: copyOf(deckBack ?? null),
    deckBox: deckBack == null ? null : boxIn(list, deckBack),
    handCounts: handCounts(),
  }
}

// Where a card you took should land: the Hand tab on phones, the hand
// row on wide screens.
const handTarget = (): DOMRect | null => {
  const tab = document.querySelector(`[data-${DOCK_TAB_DATA}="Hand"]`)
  if (isShown(tab)) {
    return tab.getBoundingClientRect()
  }
  const row = document.querySelector('.panel.hand .hand-row')
  return isShown(row) ? row.getBoundingClientRect() : null
}

const bumpHandTab = (): void => {
  const tab = document.querySelector(`[data-${DOCK_TAB_DATA}="Hand"]`)
  if (isShown(tab)) {
    tab.animate([{ scale: 1 }, { scale: 1.08 }, { scale: 1 }], {
      duration: 260,
      easing: EASE_OUT,
    })
  }
}

// The ghost sits in a bare copy of the market panel, so the panel's own
// card rules (sizes, the wild's tag) still style it in flight.
const flyAway = (
  ghost: Element,
  from: DOMRect,
  to: DOMRect | null,
  onLand: () => void,
): void => {
  ghost.removeAttribute('disabled')
  ghost.setAttribute('aria-hidden', 'true')
  const host = document.createElement('div')
  host.className = 'panel market card-flight'
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  })
  host.appendChild(ghost)
  document.body.appendChild(host)

  const dx =
    to === null ? 0 : to.left + to.width / 2 - (from.left + from.width / 2)
  const dy =
    to === null
      ? -from.height * 1.4
      : to.top + to.height / 2 - (from.top + from.height / 2)
  const animation = host.animate(
    [
      { transform: 'none', opacity: 1 },
      {
        transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 24}px) rotate(-6deg) scale(1.06)`,
        opacity: 1,
        offset: 0.35,
      },
      {
        transform: `translate(${dx}px, ${dy}px) rotate(4deg) scale(0.42)`,
        opacity: 0,
      },
    ],
    { duration: FLY_MS, easing: EASE_IN_OUT, fill: 'forwards' },
  )
  const finish = () => {
    host.remove()
    onLand()
  }
  animation.addEventListener('finish', finish)
  animation.addEventListener('cancel', () => host.remove())
}

// A blind draw: the card back rises from the deck to the middle of the
// screen, growing and turning face up, holds there, then shrinks into the
// hand. Both faces sit in a bare market panel so the card rules apply.
const revealDraw = (
  back: Element,
  face: Element,
  from: DOMRect,
  aspect: number,
  to: DOMRect | null,
  onLand: () => void,
): void => {
  const width = Math.min(REVEAL_WIDTH, window.innerWidth * 0.4)
  const height = width * aspect
  const left = window.innerWidth / 2 - width / 2
  const top = window.innerHeight * 0.42 - height / 2

  const host = document.createElement('div')
  host.className = 'panel market card-flight card-reveal'
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  })
  const flipper = document.createElement('div')
  flipper.className = 'card-reveal-flipper'
  back.classList.add('card-reveal-back')
  face.classList.add('card-reveal-face')
  back.removeAttribute('disabled')
  flipper.append(face, back)
  host.appendChild(flipper)
  document.body.appendChild(host)

  const centerX = left + width / 2
  const centerY = top + height / 2
  const startScale = from.width / width
  const startX = from.left + from.width / 2 - centerX
  const startY = from.top + from.height / 2 - centerY
  const endX = to === null ? 0 : to.left + to.width / 2 - centerX
  const endY = to === null ? -height : to.top + to.height / 2 - centerY

  const total = REVEAL_IN_MS + REVEAL_HOLD_MS + REVEAL_OUT_MS
  const arrived = REVEAL_IN_MS / total
  const leaving = (REVEAL_IN_MS + REVEAL_HOLD_MS) / total
  const motion = host.animate(
    [
      {
        transform: `translate(${startX}px, ${startY}px) scale(${startScale})`,
        easing: EASE_OUT,
      },
      { transform: 'none', offset: arrived },
      { transform: 'none', offset: leaving, opacity: 1, easing: EASE_IN_OUT },
      {
        transform: `translate(${endX}px, ${endY}px) rotate(4deg) scale(0.3)`,
        opacity: 0,
      },
    ],
    { duration: total, fill: 'forwards' },
  )
  flipper.animate(
    [
      { transform: 'rotateY(180deg)', easing: EASE_OUT },
      { transform: 'rotateY(0deg)', offset: arrived },
      { transform: 'rotateY(0deg)' },
    ],
    { duration: total, fill: 'forwards' },
  )
  motion.addEventListener('finish', () => {
    host.remove()
    onLand()
  })
  motion.addEventListener('cancel', () => host.remove())
}

// The new card deals in from the deck, turning face up as it arrives.
const dealIn = (button: HTMLElement, deckRect: DOMRect | null): void => {
  const rect = button.getBoundingClientRect()
  const dx =
    deckRect === null
      ? 0
      : deckRect.left + deckRect.width / 2 - (rect.left + rect.width / 2)
  const dy =
    deckRect === null
      ? 40
      : deckRect.top + deckRect.height / 2 - (rect.top + rect.height / 2)
  button.animate(
    [
      {
        transform: `translate(${dx}px, ${dy}px) rotateY(90deg) scale(0.7)`,
        opacity: 0,
      },
      {
        transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) rotateY(60deg) scale(0.9)`,
        opacity: 1,
        offset: 0.45,
      },
      { transform: 'none', opacity: 1 },
    ],
    {
      duration: DEAL_MS,
      delay: DEAL_DELAY_MS,
      easing: EASE_OUT,
      fill: 'backwards',
    },
  )
}

const watchMarketRow = (list: HTMLElement): (() => void) => {
  let before = snapshot(list)
  let frame = 0

  const settle = () => {
    frame = 0
    const after = snapshot(list)
    const previous = before
    before = after
    if (prefersReducedMotion()) {
      return
    }

    const items = slotItems(list)
    let tookFaceUp = false
    previous.slots.forEach((old, index) => {
      const now = after.slots[index]
      const item = items[index]
      if (now === undefined || item === undefined || now.face === old.face) {
        return
      }
      if (old.face !== 'empty' && old.ghost !== null) {
        tookFaceUp = true
        const yours = old.enabled
        flyAway(
          old.ghost,
          onScreen(list, old.box),
          yours ? handTarget() : null,
          () => {
            if (yours) bumpHandTab()
          },
        )
      }
      const button = buttonIn(item)
      if (button !== null) {
        dealIn(
          button,
          after.deckBox === null ? null : onScreen(list, after.deckBox),
        )
      }
    })

    // A blind draw: the deck shrank, no face-up card moved, and it was
    // your turn to draw.
    if (
      !tookFaceUp &&
      previous.deckEnabled &&
      after.deckCount < previous.deckCount &&
      previous.deckGhost !== null &&
      previous.deckBox !== null
    ) {
      const face = drawnCardFace(previous.handCounts)
      const sample = after.slots[0]?.box
      const aspect =
        sample === undefined || sample.width === 0
          ? 1.4
          : sample.height / sample.width
      if (face === null) {
        flyAway(
          previous.deckGhost,
          onScreen(list, previous.deckBox),
          handTarget(),
          bumpHandTab,
        )
      } else {
        revealDraw(
          previous.deckGhost,
          face,
          onScreen(list, previous.deckBox),
          aspect,
          handTarget(),
          bumpHandTab,
        )
      }
    }
  }

  // One batch per render: several attributes change together.
  const observer = new MutationObserver(() => {
    if (frame === 0) {
      frame = requestAnimationFrame(settle)
    }
  })
  observer.observe(list, {
    subtree: true,
    attributes: true,
    attributeFilter: [FACE, COUNT, 'disabled'],
  })

  // Layout moves (rotation, tab switches) change where cards sit.
  const resizeObserver = new ResizeObserver(() => {
    before = snapshot(list)
  })
  resizeObserver.observe(list)

  return () => {
    observer.disconnect()
    resizeObserver.disconnect()
    cancelAnimationFrame(frame)
  }
}

export const AnimateMarketRow: Mount.MountAction<never> = {
  name: 'AnimateMarketRow',
  f: element =>
    Stream.callback<never>(() =>
      Effect.acquireRelease(
        Effect.sync(() =>
          element instanceof HTMLElement ? watchMarketRow(element) : () => {},
        ),
        stop => Effect.sync(stop),
      ),
    ),
}
