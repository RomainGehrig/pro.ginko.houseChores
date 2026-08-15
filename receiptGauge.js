// ABOUTME: Geometry for the Receipt's two-track gauge — scale, ticks and label placement.
// ABOUTME: Pure arithmetic so dragging, drawing and testing all read from one source.

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 45, 60, 120]
const NEAR_EDGE = 0.12
const FAR_EDGE = 0.97

const positive = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

// The scale is derived from whatever the gauge has to show, with a quarter of
// headroom so a figure at the top of the track is still legible. While a handle
// is being dragged the caller freezes it, or the ground would move underfoot.
export function gaugeSpan ({ actual, estimate, suggestion, past = [], frozen } = {}) {
  const held = positive(frozen)
  if (held) return held
  const largest = Math.max(
    positive(actual), positive(estimate), positive(suggestion),
    ...past.map(positive), 0
  )
  return largest * 1.25 || 10
}

export function gaugePercent (value, span) {
  const scale = positive(span)
  if (!scale) return 0
  return Math.max(0, Math.min(100, (Number(value) || 0) / scale * 100))
}

// A step that reads three to seven times across keeps the axis informative
// without crowding it; only round minute figures are ever used.
export function gaugeTicks (span) {
  const scale = positive(span)
  if (!scale) return []
  const step = TICK_STEPS.find(candidate => {
    const count = Math.floor(scale / candidate)
    return count >= 3 && count <= 7
  }) || TICK_STEPS.find(candidate => Math.floor(scale / candidate) <= 7) ||
    Math.max(1, Math.round(scale / 5))

  const ticks = []
  for (let value = step; value <= scale; value += step) {
    ticks.push({ value, label: String(value), percent: gaugePercent(value, scale) })
  }
  return ticks
}

// Close to the left edge there is no room to the left of the mark, so the label
// hops to the other side rather than being clipped.
export function pinPlacement (value, span) {
  const scale = positive(span)
  if (!scale) return 'after'
  return (Number(value) || 0) / scale < NEAR_EDGE ? 'after' : 'before'
}

export function handleOffset (value, span) {
  const scale = positive(span)
  if (!scale) return 0
  const fraction = (Number(value) || 0) / scale
  if (fraction < NEAR_EDGE) return 0
  return fraction > FAR_EDGE ? -22 : -11
}
