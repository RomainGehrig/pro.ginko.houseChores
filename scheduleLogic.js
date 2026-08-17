// ABOUTME: Pure local-calendar scheduling rules for household tasks.
// ABOUTME: Normalizes schedule data without DOM, Freezr, or UTC date semantics.

const PERIOD_UNITS = new Set(['day', 'week', 'month', 'year'])
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

// Monday is 1 and Sunday is 7, the numbering the fixed patterns are stored in.
// A date it cannot read falls back to today, so a caller offering the user a
// weekday always has one to offer.
export function isoWeekday (value) {
  const date = localDateObject(value) || new Date()
  return date.getDay() || 7
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

// The rhythm in the words it was set in. A weekly chore is "about every week",
// never "about every 7" — the cadence in days with its unit dropped.
export function cadencePhrase (schedule) {
  const normalizedSchedule = normalizeSchedule(schedule)
  if (normalizedSchedule?.type !== 'periodic') return ''
  const { every, unit } = normalizedSchedule
  return `about every ${every === 1 ? '' : every + ' '}${unit}${every === 1 ? '' : 's'}`
}

export function scheduleSummary (schedule) {
  const normalizedSchedule = normalizeSchedule(schedule)
  if (!normalizedSchedule) return ''
  if (normalizedSchedule.type === 'one_off') return 'Once'
  if (normalizedSchedule.type === 'periodic') {
    return 'A' + cadencePhrase(normalizedSchedule).slice(1) + ' after completion'
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

// The date is never a reason to refuse, and never invented. A periodic or
// one-off chore may say today, some later day, or nothing at all — and nothing
// at all is an answer, not an omission: the chore waits in the unscheduled
// list until it is given a day. Only a fixed chore derives one, from the
// pattern that is its whole point.
export function validateScheduleInput (input = {}, today = localDateFromDate()) {
  const schedule = normalizeSchedule(input.schedule)
  if (!schedule) return { ok: false, message: 'Choose a valid schedule.' }

  const chosen = parseLocalDate(input.scheduledDate)
  const reference = parseLocalDate(today) ? String(today) : localDateFromDate()
  const scheduledDate = chosen
    ? formatLocalDate(chosen)
    : (suggestScheduledDate(schedule, reference) || null)

  return { ok: true, scheduledDate, schedule }
}

export function localDateFromTimestamp (timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : localDateFromDate(date)
}

// Reads a record in the current shape and makes it safe to use: an unusable
// schedule or date becomes a stated absence rather than a surprise downstream.
// The old field names are gone by the time this runs — taskMigration.js erases
// them on the way in — so nothing here has to know them.
export function normalizeTaskSchedule (task) {
  const normalizedTask = { ...(task || {}) }
  normalizedTask.schedule = normalizeSchedule(normalizedTask.schedule) || { type: 'one_off' }

  // Silence about the day survives the load. Stamping today onto a chore that
  // never named one would quietly move it into the week and out of the
  // unscheduled list, which is a decision the user did not make.
  const scheduledDate = parseLocalDate(normalizedTask.scheduledDate)
  normalizedTask.scheduledDate = scheduledDate ? formatLocalDate(scheduledDate) : null

  normalizedTask.suggestedSchedule = normalizeSchedule(normalizedTask.suggestedSchedule)
  return normalizedTask
}
