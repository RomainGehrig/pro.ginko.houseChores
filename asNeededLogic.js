// ABOUTME: Pure inspection transitions and schedule summaries for as-needed chores.
// ABOUTME: Reuses the calendar schedule arithmetic without deadline language.

import {
  cadencePhrase,
  nextScheduledDate,
  normalizeSchedule,
  parseLocalDate,
  scheduleSummary
} from './scheduleLogic.js'

export function markReadyFields (today) {
  return { readiness: 'ready', scheduledDate: today }
}

export function deferReadinessFields (task, checkedOn, selectedDate) {
  const schedule = normalizeSchedule(task?.schedule)
  if (schedule?.type === 'one_off') {
    if (!parseLocalDate(selectedDate)) return null
    return { readiness: 'waiting', scheduledDate: selectedDate }
  }

  const scheduledDate = nextScheduledDate({
    ...task,
    schedule,
    scheduledDate: checkedOn
  }, checkedOn)
  return { readiness: 'waiting', scheduledDate }
}

export function asNeededScheduleSummary (schedule) {
  const normalized = normalizeSchedule(schedule)
  if (!normalized) return ''
  if (normalized.type === 'one_off') return 'Check once'
  if (normalized.type === 'periodic') return `Check ${cadencePhrase(normalized)}`

  const summary = scheduleSummary(normalized)
  return `Check ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`
}
