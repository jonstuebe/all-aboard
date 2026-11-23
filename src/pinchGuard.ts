// Stops pinch-to-zoom everywhere except the map. iOS Safari ignores
// `user-scalable=no` in the viewport meta, so the only reliable way is to
// cancel the gesture itself: Safari's own `gesture*` events, plus multi-touch
// `touchmove` for other mobile browsers. A pinch that starts on the map is
// left alone. Double-tap zoom is turned off in styles.css (touch-action).

const MAP_SELECTOR = '.board-frame'

const startsOnMap = (event: Event): boolean =>
  event.target instanceof Element && event.target.closest(MAP_SELECTOR) !== null

const cancelUnlessOnMap = (event: Event): void => {
  if (!startsOnMap(event)) event.preventDefault()
}

const cancelPinchUnlessOnMap = (event: TouchEvent): void => {
  if (event.touches.length > 1) cancelUnlessOnMap(event)
}

export const guardPinchZoom = (): void => {
  const options = { passive: false }
  document.addEventListener('gesturestart', cancelUnlessOnMap, options)
  document.addEventListener('gesturechange', cancelUnlessOnMap, options)
  document.addEventListener('touchmove', cancelPinchUnlessOnMap, options)
}
