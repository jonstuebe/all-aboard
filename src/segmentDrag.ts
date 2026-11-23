import { Effect, Queue, Stream } from 'effect'
import type { Mount } from 'foldkit'

import { Message } from './message'
import { DockTab } from './table'

// Lets a finger slide across a segmented control: the bot player-count picker
// on the home screen and the Draw / Hand / Tickets dock tabs at the table.
// Press anywhere on the strip and the thumb follows the finger exactly; the
// segment under it is picked as it passes, and on release the thumb glides
// into that slot. Each segment names its value in a data attribute. Clicks
// and the keyboard still go through each button's own OnClick; this only adds
// the drag.
//
// While dragging, this writes the thumb's `left` inline. The view never sets
// a style on the thumb, so a re-render leaves it alone, and clearing it on
// release hands the position back to the CSS slot from --picked.

const DRAGGING_CLASS = 'is-dragging'
const DRAG_THRESHOLD_PX = 3

/** How one segmented control is wired: where its values live, which element
 *  is its thumb, and what to emit when a segment is picked. */
export type SegmentDragConfig = Readonly<{
  /** The data attribute (without its `data-` prefix) holding each segment's
   *  value. Only elements carrying it count as segments. */
  dataKey: string
  thumbClass: string
}>

type Layout = Readonly<{
  segments: ReadonlyArray<HTMLElement>
  stripLeft: number
  trackLeft: number
  segmentWidth: number
  /** Distance from one segment's left edge to the next's, so a gap between
   *  segments is part of the travel. */
  stride: number
}>

const measure = (strip: HTMLElement, attribute: string): Layout | null => {
  const segments = Array.from(
    strip.querySelectorAll<HTMLElement>(`[${attribute}]`),
  )
  const first = segments[0]
  if (first === undefined) return null
  const stripLeft = strip.getBoundingClientRect().left
  const firstRect = first.getBoundingClientRect()
  const second = segments[1]
  const stride =
    second === undefined
      ? firstRect.width
      : second.getBoundingClientRect().left - firstRect.left
  return {
    segments,
    stripLeft,
    trackLeft: firstRect.left - stripLeft,
    segmentWidth: firstRect.width,
    stride,
  }
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

/** Where the thumb sits for a finger at `clientX`, as an offset from the first
 *  slot, and which segment that puts it over. */
export const thumbAt = (
  layout: Pick<Layout, 'stripLeft' | 'trackLeft' | 'segmentWidth' | 'stride'>,
  segmentTotal: number,
  clientX: number,
): Readonly<{ offset: number; index: number }> => {
  const { stripLeft, trackLeft, segmentWidth, stride } = layout
  const offset = clamp(
    clientX - stripLeft - trackLeft - segmentWidth / 2,
    0,
    stride * (segmentTotal - 1),
  )
  return { offset, index: stride > 0 ? Math.round(offset / stride) : 0 }
}

/** Wires the drag onto `strip`, calling `emit` with each newly picked
 *  segment's data value. Returns the teardown. */
export const watchStrip = (
  strip: HTMLElement,
  config: SegmentDragConfig,
  emit: (value: string) => void,
): (() => void) => {
  const attribute = `data-${config.dataKey}`
  let maybePointerId: number | null = null
  let maybeLayout: Layout | null = null
  let startX = 0
  let isDragging = false
  let lastValue: string | null = null
  let shouldSwallowClick = false

  const thumb = (): HTMLElement | null =>
    strip.querySelector<HTMLElement>(`.${config.thumbClass}`)

  const followTo = (clientX: number): void => {
    const layout = maybeLayout
    if (layout === null) return
    const { offset, index } = thumbAt(layout, layout.segments.length, clientX)
    const maybeThumb = thumb()
    if (maybeThumb !== null) {
      maybeThumb.classList.add(DRAGGING_CLASS)
      maybeThumb.style.left = `${layout.trackLeft + offset}px`
    }
    const value = layout.segments[index]?.getAttribute(attribute) ?? null
    if (value !== null && value !== lastValue) {
      lastValue = value
      emit(value)
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
    maybeLayout = measure(strip, attribute)
    if (maybeLayout === null) return
    maybePointerId = event.pointerId
    startX = event.clientX
    isDragging = false
    lastValue = null
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
      strip.setPointerCapture?.(event.pointerId)
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

/** A Mount that drags across the strip it is on, turning each picked
 *  segment's data value into a Message (or nothing, for a value it can't
 *  read). */
const segmentDrag = (
  name: string,
  config: SegmentDragConfig,
  toMessage: (value: string) => Message | null,
): Mount.MountAction<Message> => ({
  name,
  f: element =>
    Stream.callback<Message>(queue =>
      Effect.acquireRelease(
        Effect.sync(() =>
          element instanceof HTMLElement
            ? watchStrip(element, config, value => {
                const maybeMessage = toMessage(value)
                if (maybeMessage !== null) {
                  Queue.offerUnsafe(queue, maybeMessage)
                }
              })
            : () => {},
        ),
        stop => Effect.sync(stop),
      ),
    ),
})

// PLAYER COUNT

/** The data attribute (without its `data-` prefix) holding a segment's count. */
export const SEGMENT_COUNT_DATA = 'count'

export const DragSeatCount = segmentDrag(
  'DragSeatCount',
  { dataKey: SEGMENT_COUNT_DATA, thumbClass: 'wizard-segment-thumb' },
  value => {
    const count = Number(value)
    return Number.isFinite(count) ? Message.DraggedSeatCount({ count }) : null
  },
)

// DOCK TABS

/** The data attribute (without its `data-` prefix) naming a dock tab. */
export const DOCK_TAB_DATA = 'dock-tab'

const isDockTab = (value: string): value is DockTab =>
  DockTab.literals.some(tab => tab === value)

export const DragDockTab = segmentDrag(
  'DragDockTab',
  { dataKey: DOCK_TAB_DATA, thumbClass: 'dock-tab-thumb' },
  value => (isDockTab(value) ? Message.DraggedDockTab({ tab: value }) : null),
)
