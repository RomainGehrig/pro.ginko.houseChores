// ABOUTME: Pure due-group assignment and saturating ripeness ordering for chores.
// ABOUTME: Keeps prioritization arithmetic internal and separate from user-facing copy.

import { parseLocalDate } from './scheduleLogic.js'

const PERIOD_DAYS = { day: 1, week: 7, month: 30, year: 365 }
const DAY_MS = 24 * 60 * 60 * 1000
const DUE_GROUPS = ['READY', 'TODAY', 'THIS WEEK', 'LATER', 'SOMEDAY']

function dayNumber (value) {
  const parts = parseLocalDate(value)
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS : null
}

function daysBetween (from, to) {
  const fromDay = dayNumber(from)
  const toDay = dayNumber(to)
  return fromDay === null || toDay === null ? null : toDay - fromDay
}

export function cadenceDays (schedule) {
  if (!schedule || schedule.type === 'one_off') return null

  if (schedule.type === 'periodic') {
    const every = Number(schedule.every)
    const unitDays = PERIOD_DAYS[schedule.unit]
    return Number.isFinite(every) && every > 0 && unitDays ? every * unitDays : null
  }

  if (schedule.type !== 'fixed') return null
  const pattern = schedule.pattern
  if (pattern?.kind === 'weekdays') {
    const weekdayCount = new Set((pattern.weekdays || [])
      .map(Number)
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 7)).size
    return weekdayCount > 0 ? 7 / weekdayCount : null
  }
  if (pattern?.kind === 'month_day') return 30
  if (pattern?.kind === 'annual_date') return 365
  return null
}

export function slip (task, today) {
  const cadence = cadenceDays(task?.schedule)
  const lateDays = daysBetween(task?.scheduledDate, today)
  if (!cadence || lateDays === null || lateDays <= 0) return 0

  const cadencesLate = lateDays / cadence
  return Math.min(cadencesLate, 1) +
    Math.min(Math.max(cadencesLate - 1, 0) / 2, 1)
}

export function dueGroup (task, today) {
  const daysUntil = daysBetween(today, task?.scheduledDate)
  if (daysUntil === null) return 'SOMEDAY'
  if (daysUntil < 0) return 'READY'
  if (daysUntil === 0) return 'TODAY'
  if (daysUntil <= 7) return 'THIS WEEK'
  return 'LATER'
}

function compareTasks (today) {
  return (left, right) => {
    const leftDraft = left?.status === 'proposed'
    const rightDraft = right?.status === 'proposed'
    if (leftDraft !== rightDraft) return leftDraft ? 1 : -1

    const ripenessDifference = (leftDraft ? 0 : slip(left, today)) -
      (rightDraft ? 0 : slip(right, today))
    if (ripenessDifference !== 0) return -ripenessDifference

    const dateDifference = String(left?.scheduledDate || '').localeCompare(
      String(right?.scheduledDate || '')
    )
    if (dateDifference !== 0) return dateDifference

    const nameDifference = String(left?.name || '').localeCompare(String(right?.name || ''))
    if (nameDifference !== 0) return nameDifference
    return String(left?._id || '').localeCompare(String(right?._id || ''))
  }
}

export function groupAndSort (tasks, today) {
  const grouped = new Map(DUE_GROUPS.map(name => [name, []]))
  for (const task of tasks || []) grouped.get(dueGroup(task, today)).push(task)

  return DUE_GROUPS.map(name => ({
    name,
    tasks: grouped.get(name).sort(compareTasks(today))
  })).filter(group => group.tasks.length > 0)
}
