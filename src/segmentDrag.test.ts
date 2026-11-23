import { describe, expect, it } from 'vitest'

import { DOCK_TAB_DATA, thumbAt, watchStrip } from './segmentDrag'

// A strip at x=100 with 3px padding and three 60px segments 3px apart, like
// the phone dock's Draw / Hand / Tickets tabs.
const STRIP_LEFT = 100
const PADDING = 3
const WIDTH = 60
const GAP = 3
const TABS = ['Draw', 'Hand', 'Tickets']

const rectAt = (left: number, width: number): DOMRect =>
  new DOMRect(left, 0, width, 40)

const makeStrip = (): HTMLElement => {
  const strip = document.createElement('div')
  strip.getBoundingClientRect = () =>
    rectAt(STRIP_LEFT, 3 * WIDTH + 2 * GAP + 2 * PADDING)
  const thumb = document.createElement('span')
  thumb.className = 'dock-tab-thumb'
  strip.append(thumb)
  TABS.forEach((tab, index) => {
    const button = document.createElement('button')
    button.setAttribute(`data-${DOCK_TAB_DATA}`, tab)
    button.getBoundingClientRect = () =>
      rectAt(STRIP_LEFT + PADDING + index * (WIDTH + GAP), WIDTH)
    strip.append(button)
  })
  document.body.append(strip)
  return strip
}

const pointer = (type: string, clientX: number): PointerEvent =>
  new PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true })

// The centre of segment `index`, in client coordinates.
const centreOf = (index: number): number =>
  STRIP_LEFT + PADDING + index * (WIDTH + GAP) + WIDTH / 2

describe('thumbAt', () => {
  const layout = {
    stripLeft: STRIP_LEFT,
    trackLeft: PADDING,
    segmentWidth: WIDTH,
    stride: WIDTH + GAP,
  }

  it('picks the segment whose slot the thumb is nearest, gap included', () => {
    expect(thumbAt(layout, 3, centreOf(0)).index).toBe(0)
    expect(thumbAt(layout, 3, centreOf(1)).index).toBe(1)
    expect(thumbAt(layout, 3, centreOf(2)).index).toBe(2)
    expect(thumbAt(layout, 3, centreOf(2))).toEqual({
      offset: 2 * (WIDTH + GAP),
      index: 2,
    })
  })

  it('keeps the thumb inside the track past either end', () => {
    expect(thumbAt(layout, 3, 0)).toEqual({ offset: 0, index: 0 })
    expect(thumbAt(layout, 3, 9999)).toEqual({
      offset: 2 * (WIDTH + GAP),
      index: 2,
    })
  })
})

describe('watchStrip', () => {
  it('emits each tab once as a drag passes over it, then snaps the thumb back', () => {
    const strip = makeStrip()
    const picked: Array<string> = []
    const stop = watchStrip(
      strip,
      { dataKey: DOCK_TAB_DATA, thumbClass: 'dock-tab-thumb' },
      value => {
        picked.push(value)
      },
    )
    const thumb = strip.querySelector<HTMLElement>('.dock-tab-thumb')!

    strip.dispatchEvent(pointer('pointerdown', centreOf(0)))
    strip.dispatchEvent(pointer('pointermove', centreOf(0) + 10))
    strip.dispatchEvent(pointer('pointermove', centreOf(1)))
    expect(thumb.classList.contains('is-dragging')).toBe(true)
    expect(thumb.style.left).toBe(`${PADDING + WIDTH + GAP}px`)
    strip.dispatchEvent(pointer('pointermove', centreOf(1) + 5))
    strip.dispatchEvent(pointer('pointermove', centreOf(2)))
    strip.dispatchEvent(pointer('pointerup', centreOf(2)))

    expect(picked).toEqual(['Draw', 'Hand', 'Tickets'])
    expect(thumb.classList.contains('is-dragging')).toBe(false)
    expect(thumb.style.left).toBe('')
    stop()
    strip.remove()
  })

  it('leaves a tap alone so the button click picks it', () => {
    const strip = makeStrip()
    const picked: Array<string> = []
    const stop = watchStrip(
      strip,
      { dataKey: DOCK_TAB_DATA, thumbClass: 'dock-tab-thumb' },
      value => {
        picked.push(value)
      },
    )
    let clicks = 0
    strip.querySelectorAll('button')[1]!.addEventListener('click', () => {
      clicks += 1
    })

    strip.dispatchEvent(pointer('pointerdown', centreOf(1)))
    strip.dispatchEvent(pointer('pointermove', centreOf(1) + 1))
    strip.dispatchEvent(pointer('pointerup', centreOf(1) + 1))
    strip.querySelectorAll('button')[1]!.click()

    expect(picked).toEqual([])
    expect(clicks).toBe(1)
    stop()
    strip.remove()
  })
})
