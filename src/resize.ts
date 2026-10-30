/**
 * Drags a splitter. `move` gets the pointer x for every frame; `done` runs once on release.
 * The whole page shows the resize cursor and text selection is off while dragging.
 */
export function dragSplit(e: React.PointerEvent, move: (x: number) => void, done: () => void) {
  if (e.button !== 0) return
  e.preventDefault()
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  document.documentElement.classList.add('col-resizing')
  let frame = 0
  let x = e.clientX
  const onMove = (ev: PointerEvent) => {
    x = ev.clientX
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        move(x)
      })
  }
  const onUp = () => {
    cancelAnimationFrame(frame)
    move(x)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
    document.documentElement.classList.remove('col-resizing')
    done()
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
}

export function stored(key: string, fallback: number, min: number, max: number) {
  const v = Number(localStorage.getItem(key))
  return Number.isFinite(v) && v >= min && v <= max && localStorage.getItem(key) !== null ? v : fallback
}
