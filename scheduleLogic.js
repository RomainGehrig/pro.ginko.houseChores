// ABOUTME: Pure local-calendar scheduling rules for household tasks.
// ABOUTME: Normalizes schedule data without DOM, Freezr, or UTC date semantics.

const PERIOD_UNITS = new Set(['day', 'week', 'month', 'year'])
const ACTIVE_STATUSES = new Set(['active', 'approved_recurring'])
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function daysInMonth (year, month) {
  return new Date(year, month, 0, 12).getDate()
}

export function parseLocalDate (value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function formatLocalDate ({ year, month, day }) {
  return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
}

export function localDateFromDate (date = new Date()) {
  return formatLocalDate({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  })
}

function localDateObject (value) {
  const parts = parseLocalDate(value)
  return parts ? new Date(parts.year, parts.month - 1, parts.day, 12) : null
}

function clampedDate (year, month, requestedDay) {
  return formatLocalDate({
    year,
    month,
    day: Math.min(requestedDay, daysInMonth(year, month))
  })
}

function addCalendarDays (value, count) {
  const date = localDateObject(value)
  date.setDate(date.getDate() + count)
  return localDateFromDate(date)
}

export function addCalendarPeriod (value, every, unit) {
  if (unit === 'day') return addCalendarDays(value, every)
  if (unit === 'week') return addCalendarDays(value, every * 7)
  const { year, month, day } = parseLocalDate(value)
  const offset = unit === 'month' ? every : every * 12
  const zeroBased = (month - 1) + offset
  const targetYear = year + Math.floor(zeroBased / 12)
  const targetMonth = ((zeroBased % 12) + 12) % 12 + 1
  return clampedDate(targetYear, targetMonth, day)
}

function isoWeekday (value) {
  return localDateObject(value).getDay() || 7
}

function nextFixedDate (pattern, threshold) {
  if (pattern.kind === 'weekdays') {
    let candidate = addCalendarDays(threshold, 1)
    while (!pattern.weekdays.includes(isoWeekday(candidate))) candidate = addCalendarDays(candidate, 1)
    return candidate
  }

  const { year, month } = parseLocalDate(threshold)
  if (pattern.kind === 'month_day') {
    const sameMonth = clampedDate(year, month, pattern.day)
    if (sameMonth > threshold) return sameMonth
    const nextMonth = month === 12
      ? { year: year + 1, month: 1 }
      : { year, month: month + 1 }
    return clampedDate(nextMonth.year, nextMonth.month, pattern.day)
  }

  const sameYear = clampedDate(year, pattern.month, pattern.day)
  return sameYear > threshold
    ? sameYear
    : clampedDate(year + 1, pattern.month, pattern.day)
}

export function suggestScheduledDate (schedule, referenceDate) {
  const normalizedSchedule = normalizeSchedule(schedule)
  const reference = parseLocalDate(referenceDate)
  if (normalizedSchedule?.type !== 'fixed' || !reference) return null

  return scheduleMatchesDate(normalizedSchedule, referenceDate)
    ? formatLocalDate(reference)
    : nextFixedDate(normalizedSchedule.pattern, referenceDate)
}

export function nextScheduledDate (task, completionDate) {
  const schedule = normalizeSchedule(task.schedule)
  if (schedule?.type === 'one_off') return null
  if (schedule?.type === 'periodic') {
    return addCalendarPeriod(completionDate, schedule.every, schedule.unit)
  }
  const threshold = task.scheduledDate > completionDate ? task.scheduledDate : completionDate
  return nextFixedDate(schedule.pattern, threshold)
}

export function taskUpdateForOutcome (task, outcome, completion) {
  if (outcome === 'cancelled') return null

  const schedule = normalizeSchedule(task.schedule)
  if (schedule?.type === 'one_off') {
    return { lastCompletedDate: completion.completedAt, status: 'archived' }
  }

  return {
    lastCompletedDate: completion.completedAt,
    scheduledDate: nextScheduledDate(task, completion.completionDate)
  }
}

function joinNames (names) {
  if (names.length < 2) return names[0]
  if (names.length === 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function scheduleSummary (schedule) {
  const normalizedSchedule = normalizeSchedule(schedule)
  if (!normalizedSchedule) return ''
  if (normalizedSchedule.type === 'one_off') return 'Once'
  if (normalizedSchedule.type === 'periodic') {
    const { every, unit } = normalizedSchedule
    return `About every ${every === 1 ? '' : every + ' '}${unit}${every === 1 ? '' : 's'} after completion`
  }

  const { pattern } = normalizedSchedule
  if (pattern.kind === 'weekdays') {
    return `Every ${joinNames(pattern.weekdays.map(day => WEEKDAY_NAMES[day - 1]))}`
  }
  if (pattern.kind === 'month_day') return `Monthly on day ${pattern.day}`
  return `Every year on ${MONTH_NAMES[pattern.month - 1]} ${pattern.day}`
}

export function formatScheduledDate (value, locales) {
  const parts = parseLocalDate(value)
  return parts
    ? new Date(parts.year, parts.month - 1, parts.day, 12).toLocaleDateString(locales)
    : ''
}

function normalizeFixedPattern (pattern) {
  if (pattern?.kind === 'weekdays') {
    if (!Array.isArray(pattern.weekdays)) return null
    const weekdays = [...new Set(pattern.weekdays.map(Number))]
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 7)
      .sort((a, b) => a - b)
    return weekdays.length ? { kind: 'weekdays', weekdays } : null
  }
  if (pattern?.kind === 'month_day') {
    const day = Number(pattern.day)
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { kind: 'month_day', day } : null
  }
  if (pattern?.kind === 'annual_date') {
    const month = Number(pattern.month)
    const day = Number(pattern.day)
    return Number.isInteger(month) && month >= 1 && month <= 12 &&
      Number.isInteger(day) && day >= 1 && day <= 31
      ? { kind: 'annual_date', month, day }
      : null
  }
  return null
}

export function normalizeSchedule (value) {
  if (value?.type === 'one_off') return { type: 'one_off' }
  if (value?.type === 'periodic') {
    const every = Number(value.every)
    return Number.isInteger(every) && every > 0 && PERIOD_UNITS.has(value.unit)
      ? { type: 'periodic', every, unit: value.unit }
      : null
  }
  if (value?.type === 'fixed') {
    const pattern = normalizeFixedPattern(value.pattern)
    return pattern ? { type: 'fixed', pattern } : null
  }
  return null
}

export function scheduleMatchesDate (schedule, scheduledDate) {
  const normalizedSchedule = normalizeSchedule(schedule)
  const date = parseLocalDate(scheduledDate)
  if (!normalizedSchedule || !date) return false
  if (normalizedSchedule.type !== 'fixed') return true

  const { pattern } = normalizedSchedule
  if (pattern.kind === 'weekdays') {
    const weekday = new Date(date.year, date.month - 1, date.day, 12).getDay() || 7
    return pattern.weekdays.includes(weekday)
  }
  if (pattern.kind === 'month_day') {
    return date.day === Math.min(pattern.day, daysInMonth(date.year, date.month))
  }
  return pattern.month === date.month &&
    date.day === Math.min(pattern.day, daysInMonth(date.year, pattern.month))
}

// The date is never a reason to refuse. Only a one-off is asked for one, so
// demanding it back from a periodic chore would stop the user on a control
// they were never shown. When it is missing the schedule supplies it: a fixed
// chore from its own pattern, anything else from today.
export function validateScheduleInput (input = {}, today = localDateFromDate()) {
  const schedule = normalizeSchedule(input.schedule)
  if (!schedule) return { ok: false, message: 'Choose a valid schedule.' }

  const chosen = parseLocalDate(input.scheduledDate)
  const reference = parseLocalDate(today) ? String(today) : localDateFromDate()
  const scheduledDate = chosen
    ? formatLocalDate(chosen)
    : (suggestScheduledDate(schedule, reference) || reference)

  return { ok: true, scheduledDate, schedule }
}

function localDateFromTimestamp (timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : localDateFromDate(date)
}

export function normalizeTaskSchedule (task, today) {
  const normalizedTask = { ...(task || {}) }
  const existingSchedule = normalizeSchedule(normalizedTask.schedule)
  const legacyRecurrence = Number(normalizedTask.recurrence)
  normalizedTask.schedule = existingSchedule || (normalizedTask.schedule == null &&
    Number.isInteger(legacyRecurrence) && legacyRecurrence > 0
    ? { type: 'periodic', every: legacyRecurrence, unit: 'day' }
    : { type: 'one_off' })

  const existingScheduledDate = parseLocalDate(normalizedTask.scheduledDate)
  const legacyScheduledDate = normalizedTask.scheduledDate == null
    ? localDateFromTimestamp(normalizedTask.nextDueDate)
    : null
  if (existingScheduledDate) {
    normalizedTask.scheduledDate = formatLocalDate(existingScheduledDate)
  } else if (legacyScheduledDate) {
    normalizedTask.scheduledDate = legacyScheduledDate
  } else if (ACTIVE_STATUSES.has(normalizedTask.status)) {
    const currentDate = parseLocalDate(today)
    normalizedTask.scheduledDate = currentDate ? formatLocalDate(currentDate) : localDateFromDate()
  } else {
    normalizedTask.scheduledDate = null
  }

  normalizedTask.suggestedSchedule = normalizeSchedule(normalizedTask.suggestedSchedule)
  return normalizedTask
}
