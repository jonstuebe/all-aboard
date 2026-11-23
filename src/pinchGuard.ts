// Stops the browser's own pinch-to-zoom everywhere. iOS Safari ignores
// `user-scalable=no` in the viewport meta, so the only reliable way is to
// cancel the gesture itself: Safari's own `gesture*` events, plus multi-touch
// `touchmove` for other mobile browsers. The map zooms itself instead (see
// mapZoom.ts). Double-tap zoom is turned off in styles.css (touch-action).

const cancel = (event: Event): void => event.preventDefault()

const cancelPinch = (event: TouchEvent): void => {
  if (event.touches.length > 1) event.preventDefault()
}

export const guardPinchZoom = (): void => {
  const options = { passive: false }
  document.addEventListener('gesturestart', cancel, options)
  document.addEventListener('gesturechange', cancel, options)
  document.addEventListener('touchmove', cancelPinch, options)
}
