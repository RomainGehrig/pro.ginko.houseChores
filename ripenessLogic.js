// ABOUTME: Ripeness as warmth — how ready a chore is to be picked up, on a 0..1 scale.
// ABOUTME: Feeds the Today pool's colour ramp and its ripest-first order.

import { slip, cadenceDays, daysBetween, groupAndSort } from './slip.js'

// Past its date, a chore occupies the warm end. The span below is what is left
// for the approach, so a chore due today already reads warmer than anything
// still ahead of it.
const AT_ITS_MOMENT = 0.66
const DEFAULT_HORIZON_DAYS = 14
const MINIMUM_HORIZON_DAYS = 7

const clamp = value => Math.min(Math.max(value, 0), 1)

// How far ahead a chore starts warming. A chore that comes round every other
// day should not glow a fortnight out; one with no cadence gets a plain
// two-week approach.
function horizonDays (task) {
  const cadence = cadenceDays(task?.schedule)
  return Math.max(cadence || DEFAULT_HORIZON_DAYS, MINIMUM_HORIZON_DAYS)
}

export function ripeness (task, today) {
  const daysUntil = daysBetween(today, task?.scheduledDate)

  // Undated chores are not waiting on anything, so nothing is pulling on them.
  if (daysUntil === null) return 0

  // slip saturates at 2, so a chore forgotten for a year cannot permanently
  // outrank one forgotten for a fortnight.
  if (daysUntil <= 0) return clamp(AT_ITS_MOMENT + (1 - AT_ITS_MOMENT) * (slip(task, today) / 2))

  return clamp(AT_ITS_MOMENT * (1 - Math.min(daysUntil / horizonDays(task), 1)))
}

// Mixed from the two tokens rather than computed in RGB, so the ramp follows
// the theme instead of pinning the light palette into the markup.
export function ripenessColor (fraction) {
  const percent = Math.round(clamp(Number(fraction) || 0) * 100)
  return 'color-mix(in srgb, var(--ripe-warm) ' + percent + '%, var(--ripe-cold))'
}

// groupAndSort already runs due band, then ripeness, then date, then name —
// which is exactly ripest-first once the bands are flattened.
export function poolOrder (tasks, today) {
  return groupAndSort(tasks || [], today).flatMap(group => group.tasks)
}
