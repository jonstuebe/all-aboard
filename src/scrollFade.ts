// Marks sideways-scrolling rows (`.scroll-fade`) with which ends have
// content cut off, so styles.css can fade those edges. The view re-renders
// the row freely, so state lives in data attributes the view never sets, and
// is re-checked on scroll, resize and any DOM change.

const SELECTOR = '.scroll-fade'
const SLACK = 2

const mark = (row: Element): void => {
  if (!(row instanceof HTMLElement)) return
  const { scrollLeft, scrollWidth, clientWidth } = row
  const atStart = scrollLeft <= SLACK
  const atEnd = scrollLeft + clientWidth >= scrollWidth - SLACK
  if (row.dataset.fadeStart !== String(!atStart))
    row.dataset.fadeStart = String(!atStart)
  if (row.dataset.fadeEnd !== String(!atEnd))
    row.dataset.fadeEnd = String(!atEnd)
}

const markAll = (): void => document.querySelectorAll(SELECTOR).forEach(mark)

export const trackScrollFades = (): void => {
  const pending = { queued: false }
  const queue = (): void => {
    if (pending.queued) return
    pending.queued = true
    requestAnimationFrame(() => {
      pending.queued = false
      markAll()
    })
  }

  document.addEventListener(
    'scroll',
    event => {
      if (event.target instanceof Element && event.target.matches(SELECTOR))
        mark(event.target)
    },
    { capture: true, passive: true },
  )
  window.addEventListener('resize', queue, { passive: true })
  new MutationObserver(queue).observe(document.body, {
    childList: true,
    subtree: true,
  })
  queue()
}
