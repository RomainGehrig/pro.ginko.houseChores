// ABOUTME: Upgrades stored task records from the old field names to the current shape.
// ABOUTME: The one place that still knows those names, and its whole job is to erase them.

import { localDateFromTimestamp, normalizeSchedule } from './scheduleLogic.js'

// `recurrence` and `suggestedRecurrenceDays` were day counts before schedules
// could say "every 2 weeks"; `nextDueDate` was a millisecond stamp before dates
// were local days. Each has a current field that says the same thing better.
const LEGACY_FIELDS = ['recurrence', 'nextDueDate', 'suggestedRecurrenceDays']

function periodicFromDays (value) {
  const days = Number(value)
  return Number.isInteger(days) && days > 0
    ? { type: 'periodic', every: days, unit: 'day' }
    : null
}

// Returns the record as it should now be stored, or null when it is already
// there. What was written down explicitly always beats what is inferred.
export function migratedTaskRecord (task) {
  if (!task || !LEGACY_FIELDS.some(field => field in task)) return null

  const migrated = { ...task }
  migrated.schedule = normalizeSchedule(task.schedule) ||
    periodicFromDays(task.recurrence) ||
    { type: 'one_off' }
  migrated.suggestedSchedule = normalizeSchedule(task.suggestedSchedule) ||
    periodicFromDays(task.suggestedRecurrenceDays)
  migrated.scheduledDate = task.scheduledDate ??
    localDateFromTimestamp(task.nextDueDate) ??
    null

  for (const field of LEGACY_FIELDS) delete migrated[field]
  return migrated
}

// freezr replaces the whole record on a write, so its own bookkeeping is left
// out of the payload rather than handed back as if the app had set it.
const withoutSystemFields = record => Object.fromEntries(
  Object.entries(record).filter(([key]) => !key.startsWith('_'))
)

// Reads as the new shape whatever the write does: a record that could not be
// rewritten is simply tried again next time, and the list still makes sense.
export async function upgradeLegacyTasks (tasks, write) {
  return Promise.all((tasks || []).map(async task => {
    const migrated = migratedTaskRecord(task)
    if (!migrated) return task
    try {
      await write(task._id, withoutSystemFields(migrated))
    } catch {}
    return migrated
  }))
}
