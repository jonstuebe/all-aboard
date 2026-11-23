// Pinch, drag and trackpad zoom for the rail map, and nothing else on the
// page. It zooms by rewriting the map SVG's viewBox, so track, trains and
// city names stay sharp at any zoom. The view always renders the same
// viewBox, so Foldkit never patches it and the zoom survives re-renders.
// Zoom is view-only state: it lives on the element, never in the Model.
//
// Gestures:
// - two fingers on the map: zoom around the fingers and pan with them
// - one finger, once zoomed in: pan (at full size it scrolls the page)
// - trackpad pinch (a wheel event with ctrlKey): zoom around the pointer
// - mouse drag, once zoomed in: pan
// - the `.map-reset` button: back to the whole map
// A gesture that moved swallows the click that would follow, so panning
// across a route never claims it.

type Box = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }

const BOARD = '.board'
const MAX_SCALE = 4
const TAP_SLOP = 8
const CLICK_GUARD_MS = 400

const baseBoxes = new WeakMap<SVGSVGElement, Box>()

const state: {
  svg: SVGSVGElement | null
  mode: 'none' | 'pinch' | 'pan'
  startBox: Box
  startPoint: Point
  startDistance: number
  anchor: Point
  moved: boolean
  swallowClicksUntil: number
} = {
  svg: null,
  mode: 'none',
  startBox: { x: 0, y: 0, w: 1, h: 1 },
  startPoint: { x: 0, y: 0 },
  startDistance: 1,
  anchor: { x: 0, y: 0 },
  moved: false,
  swallowClicksUntil: 0,
}

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const parseBox = (value: string | null): Box | undefined => {
  const parts = (value ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part)))
    return undefined
  const [x = 0, y = 0, w = 1, h = 1] = parts
  return { x, y, w, h }
}

const baseBox = (svg: SVGSVGElement): Box => {
  const known = baseBoxes.get(svg)
  if (known) return known
  const box = parseBox(svg.getAttribute('viewBox')) ?? {
    x: 0,
    y: 0,
    w: 1,
    h: 1,
  }
  baseBoxes.set(svg, box)
  return box
}

const currentBox = (svg: SVGSVGElement): Box =>
  parseBox(svg.getAttribute('viewBox')) ?? baseBox(svg)

const isZoomed = (svg: SVGSVGElement): boolean =>
  currentBox(svg).w < baseBox(svg).w - 0.5

// Keeps the zoom between full size and MAX_SCALE, and the visible window
// inside the map, so you can never pan off into nothing.
const clampBox = (svg: SVGSVGElement, box: Box): Box => {
  const base = baseBox(svg)
  const w = clampNumber(box.w, base.w / MAX_SCALE, base.w)
  const h = (w * base.h) / base.w
  return {
    x: clampNumber(box.x, base.x, base.x + base.w - w),
    y: clampNumber(box.y, base.y, base.y + base.h - h),
    w,
    h,
  }
}

const writeBox = (svg: SVGSVGElement, box: Box): void => {
  const { x, y, w, h } = clampBox(svg, box)
  svg.setAttribute(
    'viewBox',
    `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`,
  )
  const frame = svg.parentElement
  if (frame) frame.dataset.zoomed = String(isZoomed(svg))
}

// Screen pixels per map unit, and where the map's corner lands on screen,
// for a given viewBox (the SVG letterboxes with xMidYMid meet).
const layout = (svg: SVGSVGElement, box: Box) => {
  const rect = svg.getBoundingClientRect()
  const scale = Math.min(rect.width / box.w, rect.height / box.h)
  return {
    scale,
    left: rect.left + (rect.width - box.w * scale) / 2,
    top: rect.top + (rect.height - box.h * scale) / 2,
  }
}

const toMap = (svg: SVGSVGElement, box: Box, screen: Point): Point => {
  const { scale, left, top } = layout(svg, box)
  return {
    x: box.x + (screen.x - left) / scale,
    y: box.y + (screen.y - top) / scale,
  }
}

// A viewBox of width `w` that puts map point `anchor` under `screen`.
const zoomTo = (
  svg: SVGSVGElement,
  w: number,
  anchor: Point,
  screen: Point,
): Box => {
  const base = baseBox(svg)
  const width = clampNumber(w, base.w / MAX_SCALE, base.w)
  const box = { x: 0, y: 0, w: width, h: (width * base.h) / base.w }
  const { scale, left, top } = layout(svg, box)
  return {
    ...box,
    x: anchor.x - (screen.x - left) / scale,
    y: anchor.y - (screen.y - top) / scale,
  }
}

const boardOf = (target: EventTarget | null): SVGSVGElement | null => {
  if (!(target instanceof Element)) return null
  const board = target.closest(BOARD)
  return board instanceof SVGSVGElement ? board : null
}

const pointOf = (touch: Touch): Point => ({
  x: touch.clientX,
  y: touch.clientY,
})

const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

const distance = (a: Point, b: Point): number =>
  Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))

const startPinch = (svg: SVGSVGElement, a: Point, b: Point): void => {
  const box = currentBox(svg)
  const centre = midpoint(a, b)
  Object.assign(state, {
    svg,
    mode: 'pinch',
    startBox: box,
    startDistance: distance(a, b),
    anchor: toMap(svg, box, centre),
    moved: true,
  })
}

const startPan = (svg: SVGSVGElement, point: Point, moved: boolean): void => {
  Object.assign(state, {
    svg,
    mode: 'pan',
    startBox: currentBox(svg),
    startPoint: point,
    moved,
  })
}

const panTo = (svg: SVGSVGElement, point: Point): void => {
  const dx = point.x - state.startPoint.x
  const dy = point.y - state.startPoint.y
  if (!state.moved && Math.hypot(dx, dy) < TAP_SLOP) return
  state.moved = true
  const { scale } = layout(svg, state.startBox)
  writeBox(svg, {
    ...state.startBox,
    x: state.startBox.x - dx / scale,
    y: state.startBox.y - dy / scale,
  })
}

const endGesture = (at: number): void => {
  if (state.moved) state.swallowClicksUntil = at + CLICK_GUARD_MS
  state.mode = 'none'
  state.svg = null
  state.moved = false
}

const onTouchStart = (event: TouchEvent): void => {
  const svg = boardOf(event.target) ?? state.svg
  if (!svg) return
  const [first, second] = Array.from(event.touches)
  if (first && second) startPinch(svg, pointOf(first), pointOf(second))
  else if (first && isZoomed(svg)) startPan(svg, pointOf(first), false)
}

const onTouchMove = (event: TouchEvent): void => {
  const { svg } = state
  if (!svg || state.mode === 'none') return
  const [first, second] = Array.from(event.touches)
  if (!first) return
  event.preventDefault()
  if (state.mode === 'pinch' && second) {
    const a = pointOf(first)
    const b = pointOf(second)
    const width = (state.startBox.w * state.startDistance) / distance(a, b)
    writeBox(svg, zoomTo(svg, width, state.anchor, midpoint(a, b)))
  } else if (state.mode === 'pan') {
    panTo(svg, pointOf(first))
  }
}

const onTouchEnd = (event: TouchEvent): void => {
  const { svg } = state
  if (!svg || state.mode === 'none') return
  const [remaining] = Array.from(event.touches)
  // Lifting one finger of a pinch carries on as a pan with the other.
  if (remaining && isZoomed(svg)) startPan(svg, pointOf(remaining), true)
  else if (!remaining) endGesture(event.timeStamp)
}

const onWheel = (event: WheelEvent): void => {
  if (!event.ctrlKey) return
  const svg = boardOf(event.target)
  if (!svg) return
  event.preventDefault()
  const box = currentBox(svg)
  const screen = { x: event.clientX, y: event.clientY }
  const width = box.w * Math.exp(event.deltaY * 0.01)
  writeBox(svg, zoomTo(svg, width, toMap(svg, box, screen), screen))
}

const onPointerDown = (event: PointerEvent): void => {
  if (event.pointerType !== 'mouse' || event.button !== 0) return
  const svg = boardOf(event.target)
  if (!svg || !isZoomed(svg)) return
  startPan(svg, { x: event.clientX, y: event.clientY }, false)
  const move = (moveEvent: PointerEvent): void => {
    if (state.svg)
      panTo(state.svg, { x: moveEvent.clientX, y: moveEvent.clientY })
  }
  const up = (upEvent: PointerEvent): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    endGesture(upEvent.timeStamp)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

const onClick = (event: MouseEvent): void => {
  if (event.target instanceof Element) {
    const reset = event.target.closest('.map-reset')
    const svg = reset?.parentElement?.querySelector(BOARD)
    if (svg instanceof SVGSVGElement) {
      writeBox(svg, baseBox(svg))
      return
    }
  }
  if (event.timeStamp < state.swallowClicksUntil && boardOf(event.target)) {
    event.preventDefault()
    event.stopPropagation()
  }
}

export const enableMapZoom = (): void => {
  const active = { passive: false }
  document.addEventListener('touchstart', onTouchStart, active)
  document.addEventListener('touchmove', onTouchMove, active)
  document.addEventListener('touchend', onTouchEnd)
  document.addEventListener('touchcancel', onTouchEnd)
  document.addEventListener('wheel', onWheel, active)
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('click', onClick, { capture: true })
}
