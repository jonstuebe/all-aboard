import { Effect, Queue, Stream } from 'effect'
import type { Mount } from 'foldkit'

import { Message } from './message'

// Lets a finger slide across the player-count segments. Press anywhere on the
// strip and the dark thumb follows the finger exactly; the count under it is
// picked as it passes, and on release the thumb glides into that slot. Each
// segment carries its count in `data-count`. Clicks and the keyboard still go
// through each button's own OnClick; this only adds the drag.
//
// While dragging, this writes the thumb's `left` inline. The view never sets
// a style on the thumb, so a re-render leaves it alone, and clearing it on
// release hands the position back to the CSS slot from --picked.

/** The data attribute (without its `data-` prefix) holding a segment's count. */
export const SEGMENT_COUNT_DATA = 'count'
const COUNT_KEY = `data-${SEGMENT_COUNT_DATA}`
const THUMB_CLASS = 'wizard-segment-thumb'
const DRAGGING_CLASS = 'is-dragging'
const DRAG_THRESHOLD_PX = 3

type Layout = Readonly<{
  segments: ReadonlyArray<HTMLElement>
  stripLeft: number
  trackLeft: number
  segmentWidth: number
}>

const measure = (strip: HTMLElement): Layout | null => {
  const segments = Array.from(
    strip.querySelectorAll<HTMLElement>(`[${COUNT_KEY}]`),
  )
  const first = segments[0]
  if (first === undefined) return null
  const stripLeft = strip.getBoundingClientRect().left
  const firstRect = first.getBoundingClientRect()
  return {
    segments,
    stripLeft,
    trackLeft: firstRect.left - stripLeft,
    segmentWidth: firstRect.width,
  }
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

const watchStrip = (
  strip: HTMLElement,
  emit: (count: number) => void,
): (() => void) => {
  let maybePointerId: number | null = null
  let maybeLayout: Layout | null = null
  let startX = 0
  let isDragging = false
  let lastCount: number | null = null
  let shouldSwallowClick = false

  const thumb = (): HTMLElement | null =>
    strip.querySelector<HTMLElement>(`.${THUMB_CLASS}`)

  const followTo = (clientX: number): void => {
    const layout = maybeLayout
    if (layout === null) return
    const { segments, stripLeft, trackLeft, segmentWidth } = layout
    const maxOffset = segmentWidth * (segments.length - 1)
    const offset = clamp(
      clientX - stripLeft - trackLeft - segmentWidth / 2,
      0,
      maxOffset,
    )
    const maybeThumb = thumb()
    if (maybeThumb !== null) {
      maybeThumb.classList.add(DRAGGING_CLASS)
      maybeThumb.style.left = `${trackLeft + offset}px`
    }
    const index = Math.round(offset / segmentWidth)
    const count = Number(segments[index]?.getAttribute(COUNT_KEY))
    if (Number.isFinite(count) && count !== lastCount) {
      lastCount = count
      emit(count)
    }
  }

  const release = (): void => {
    const maybeThumb = thumb()
    if (maybeThumb !== null) {
      maybeThumb.classList.remove(DRAGGING_CLASS)
      maybeThumb.style.removeProperty('left')
    }
    maybePointerId = null
    maybeLayout = null
    isDragging = false
  }

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    maybeLayout = measure(strip)
    if (maybeLayout === null) return
    maybePointerId = event.pointerId
    startX = event.clientX
    isDragging = false
    lastCount = null
    shouldSwallowClick = false
  }

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== maybePointerId) return
    if (!isDragging && Math.abs(event.clientX - startX) < DRAG_THRESHOLD_PX) {
      return
    }
    if (!isDragging) {
      // Capture only once it is a drag, so a plain tap still lands on the
      // button as a click.
      isDragging = true
      shouldSwallowClick = true
      strip.setPointerCapture(event.pointerId)
    }
    followTo(event.clientX)
  }

  const onEnd = (event: PointerEvent): void => {
    if (event.pointerId === maybePointerId) release()
  }

  // A drag that ends over a button would also click the button it started
  // on, undoing the pick. Stop that click before it reaches the button.
  const onClickCapture = (event: MouseEvent): void => {
    if (shouldSwallowClick) {
      shouldSwallowClick = false
      event.stopPropagation()
      event.preventDefault()
    }
  }

  strip.addEventListener('click', onClickCapture, true)
  strip.addEventListener('pointerdown', onDown)
  strip.addEventListener('pointermove', onMove)
  strip.addEventListener('pointerup', onEnd)
  strip.addEventListener('pointercancel', onEnd)

  return () => {
    strip.removeEventListener('click', onClickCapture, true)
    strip.removeEventListener('pointerdown', onDown)
    strip.removeEventListener('pointermove', onMove)
    strip.removeEventListener('pointerup', onEnd)
    strip.removeEventListener('pointercancel', onEnd)
  }
}

export const DragSeatCount: Mount.MountAction<Message> = {
  name: 'DragSeatCount',
  f: element =>
    Stream.callback<Message>(queue =>
      Effect.acquireRelease(
        Effect.sync(() =>
          element instanceof HTMLElement
            ? watchStrip(element, count => {
                Queue.offerUnsafe(queue, Message.DraggedSeatCount({ count }))
              })
            : () => {},
        ),
        stop => Effect.sync(stop),
      ),
    ),
}
