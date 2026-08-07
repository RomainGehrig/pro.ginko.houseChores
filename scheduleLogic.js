// ABOUTME: Pure local-calendar scheduling rules for household tasks.
// ABOUTME: Normalizes schedule data without DOM, Freezr, or UTC date semantics.

const PERIOD_UNITS = new Set(['day', 'week', 'month', 'year'])
const ACTIVE_STATUSES = new Set(['active', 'approved_recurring'])

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

function normalizeFixedPattern (pattern) {
  if (pattern?.kind === 'weekdays') {
    const weekdays = [...new Set((pattern.weekdays || []).map(Number))]
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

export function validateScheduleInput (input = {}, options = {}) {
  const date = parseLocalDate(input.scheduledDate)
  if (!date) return { ok: false, message: 'Enter a valid scheduled date.' }

  const schedule = normalizeSchedule(input.schedule)
  if (!schedule) return { ok: false, message: 'Choose a valid schedule.' }

  if (options.requirePatternMatch && !scheduleMatchesDate(schedule, input.scheduledDate)) {
    return { ok: false, message: 'The scheduled date must match the fixed calendar pattern.' }
  }

  return { ok: true, scheduledDate: formatLocalDate(date), schedule }
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
