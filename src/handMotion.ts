import { Effect, Stream } from 'effect'
import type { Mount } from 'foldkit'

// Animates the hand row as cards come and go. The view only ever renders
// the colors the player holds, so a card leaving the hand is simply gone
// from the next render. This watches the list's children instead: a card
// that appears slides in, a card that disappears leaves a ghost copy that
// slides out, and the cards that stay glide to their new slots (FLIP).
//
// It is purely presentational. It never dispatches a Message, so its
// stream stays silent for the element's lifetime and its observers are
// released when the element unmounts.

/** The data attribute (without its `data-` prefix) naming each hand card. */
export const HAND_CARD_DATA = 'card'
const CARD_KEY = `data-${HAND_CARD_DATA}`
const ENTER_MS = 340
const LEAVE_MS = 240
const MOVE_MS = 300
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const cardKey = (node: Node): string | null =>
  node instanceof HTMLElement ? node.getAttribute(CARD_KEY) : null

const measure = (list: HTMLElement): Map<string, Box> => {
  const base = list.getBoundingClientRect()
  const boxes = new Map<string, Box>()
  for (const child of Array.from(list.children)) {
    const key = cardKey(child)
    if (key !== null) {
      const rect = child.getBoundingClientRect()
      boxes.set(key, {
        x: rect.left - base.left,
        y: rect.top - base.top,
        width: rect.width,
        height: rect.height,
      })
    }
  }
  return boxes
}

const animateEnter = (card: HTMLElement): void => {
  card.animate(
    [
      {
        opacity: 0,
        transform: 'translate(22px, -14px) rotate(4deg) scale(0.86)',
      },
      { opacity: 1, transform: 'none' },
    ],
    { duration: ENTER_MS, easing: EASE_OUT },
  )
}

const animateMove = (card: HTMLElement, dx: number, dy: number): void => {
  card.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
    { duration: MOVE_MS, easing: EASE_OUT },
  )
}

// The removed card is already out of the virtual DOM, so its ghost lives
// in document.body where the renderer never looks.
const animateLeave = (card: HTMLElement, list: HTMLElement, box: Box) => {
  const base = list.getBoundingClientRect()
  const ghost = card.cloneNode(true)
  if (!(ghost instanceof HTMLElement)) {
    return
  }
  ghost.setAttribute('aria-hidden', 'true')
  ghost.removeAttribute(CARD_KEY)
  ghost.classList.add('hand-ghost')
  Object.assign(ghost.style, {
    left: `${base.left + window.scrollX + box.x}px`,
    top: `${base.top + window.scrollY + box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  })
  document.body.appendChild(ghost)
  const animation = ghost.animate(
    [
      { opacity: 1, transform: 'none' },
      {
        opacity: 0,
        transform: 'translate(-10px, 18px) rotate(-5deg) scale(0.82)',
      },
    ],
    { duration: LEAVE_MS, easing: EASE_IN, fill: 'forwards' },
  )
  const removeGhost = () => ghost.remove()
  animation.addEventListener('finish', removeGhost)
  animation.addEventListener('cancel', removeGhost)
}

const watchHandRow = (list: HTMLElement): (() => void) => {
  let boxes = measure(list)

  const onMutations = (records: ReadonlyArray<MutationRecord>) => {
    const previous = boxes
    boxes = measure(list)
    if (prefersReducedMotion()) {
      return
    }

    const removed = new Set<HTMLElement>()
    const added = new Set<HTMLElement>()
    for (const record of records) {
      for (const node of Array.from(record.removedNodes)) {
        if (node instanceof HTMLElement && node.parentNode !== list) {
          removed.add(node)
        }
      }
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof HTMLElement && node.parentNode === list) {
          added.add(node)
        }
      }
    }

    for (const card of removed) {
      const key = cardKey(card)
      const box = key === null ? undefined : previous.get(key)
      if (box !== undefined) {
        animateLeave(card, list, box)
      }
    }

    for (const child of Array.from(list.children)) {
      if (!(child instanceof HTMLElement)) {
        continue
      }
      const key = cardKey(child)
      const before = key === null ? undefined : previous.get(key)
      const after = key === null ? undefined : boxes.get(key)
      if (added.has(child) && before === undefined) {
        if (key !== null) {
          animateEnter(child)
        }
      } else if (before !== undefined && after !== undefined) {
        const dx = before.x - after.x
        const dy = before.y - after.y
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          animateMove(child, dx, dy)
        }
      }
    }
  }

  const mutationObserver = new MutationObserver(onMutations)
  mutationObserver.observe(list, { childList: true })

  const resizeObserver = new ResizeObserver(() => {
    boxes = measure(list)
  })
  resizeObserver.observe(list)

  return () => {
    mutationObserver.disconnect()
    resizeObserver.disconnect()
  }
}

export const AnimateHandRow: Mount.MountAction<never> = {
  name: 'AnimateHandRow',
  f: element =>
    Stream.callback<never>(() =>
      Effect.acquireRelease(
        Effect.sync(() =>
          element instanceof HTMLElement ? watchHandRow(element) : () => {},
        ),
        stop => Effect.sync(stop),
      ),
    ),
}
