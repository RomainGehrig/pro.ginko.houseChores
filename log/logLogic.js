// ABOUTME: Pure view model for the Log — its ranges, its chart geometry and its per-session copy.
// ABOUTME: Every figure here reports what happened; none of them scores it.

import { formatDuration } from '../helpers.js'
import { displayMinutes } from '../historyLogic.js'

const DAY_MS = 24 * 60 * 60 * 1000
const BAR_MAX = 88
const BAR_MIN = 6

export const LOG_RANGES = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'Everything', days: null }
]

export const LOG_SUBLINE = 'What actually happened. Nothing here is a score.'

export function logRanges (activeKey) {
  return LOG_RANGES.map(range => ({ ...range, active: range.key === activeKey }))
}

export function sessionsInRange (sessions, rangeKey, now) {
  const range = LOG_RANGES.find(candidate => candidate.key === rangeKey) || LOG_RANGES.at(-1)
  if (!range.days) return [...(sessions || [])]
  const earliest = now - range.days * DAY_MS
  return (sessions || []).filter(session => Number(session?.startTime) >= earliest)
}

const isResolved = entry => entry?.outcome !== 'cancelled'

const countChores = sessions => sessions.reduce((total, session) =>
  total + (session.entries || []).filter(isResolved).length, 0)

export function logHeadline (sessions = []) {
  if (!sessions.length) return 'Nothing recorded yet'
  const chores = countChores(sessions)
  const minutes = displayMinutes(sessions.reduce((total, session) =>
    total + (Number(session.totalActualMinutes) || 0), 0))
  return sessions.length + ' session' + (sessions.length === 1 ? '' : 's') +
    ' · ' + chores + ' chore' + (chores === 1 ? '' : 's') +
    ' · ' + formatDuration(minutes)
}

export function sessionSummaryLine (session) {
  const chores = (session?.entries || []).filter(isResolved).length
  return chores + ' chore' + (chores === 1 ? '' : 's') +
    ' · ' + formatDuration(displayMinutes(session?.totalActualMinutes)) + ' recorded' +
    ' · ' + formatDuration(displayMinutes(session?.activeMinutes)) + ' active'
}

// Oldest on the left, so the chart reads the way time does. It scales to its own
// tallest bar: there is no target line to fall short of.
export function activeBars (sessions = [], now) {
  const ordered = [...sessions].sort((left, right) =>
    (Number(left.startTime) || 0) - (Number(right.startTime) || 0))
  const peak = Math.max(1, ...ordered.map(session => Number(session.activeMinutes) || 0))

  return ordered.map(session => {
    const minutes = displayMinutes(session.activeMinutes)
    const label = relativeDay(session.startTime, now)
    return {
      id: session.id,
      label,
      title: label + ' · ' + formatDuration(minutes) + ' active',
      height: Math.max(BAR_MIN, Math.round(((Number(session.activeMinutes) || 0) / peak) * BAR_MAX))
    }
  })
}

// Both directions read the same way, in the same colour. Going over is a
// measurement the next estimate learns from, not a failure to report.
export function budgetLine (session) {
  const budget = Number(session?.timeBudgetMinutes)
  if (!Number.isFinite(budget) || budget <= 0) return 'No budget was set'
  const active = displayMinutes(session?.activeMinutes)
  const set = formatDuration(budget)
  if (active === budget) return 'Exactly the ' + set + ' set'
  return active > budget
    ? formatDuration(active - budget) + ' past the ' + set + ' set'
    : formatDuration(budget - active) + ' inside the ' + set + ' set'
}

const OUTCOME_TOOK = { cancelled: 'Skipped', already_done: 'Already done' }

// A time omitted on the Receipt arrives here as an absence. The chore was still
// done, so the row says what happened and stops — it does not invent a figure.
const hasRecordedTime = entry => entry?.actualDuration != null

export function tookLine (entry) {
  if (OUTCOME_TOOK[entry?.outcome]) return OUTCOME_TOOK[entry.outcome]
  return hasRecordedTime(entry)
    ? 'Took ' + formatDuration(displayMinutes(entry.actualDuration))
    : 'Time not recorded'
}

export function driftLine (entry) {
  if (!isResolved(entry) || entry?.outcome === 'already_done') return ''
  if (!hasRecordedTime(entry)) return ''
  const estimate = Number(entry?.estimatedDuration)
  if (!Number.isFinite(estimate) || estimate <= 0) return ''
  const actual = displayMinutes(entry?.actualDuration)
  if (actual === estimate) return 'same as the estimate'
  return actual > estimate
    ? formatDuration(actual - estimate) + ' over'
    : formatDuration(estimate - actual) + ' under'
}

// The bar illustrates the drift line. Where there is no comparison to state —
// a skip, an already-done, a chore with no estimate — it draws nothing rather
// than an unexplained sliver.
export function driftFillPercent (entry) {
  if (!driftLine(entry)) return 0
  const actual = displayMinutes(entry?.actualDuration)
  const estimate = Number(entry?.estimatedDuration) || 0
  const span = Math.max(actual, estimate, 1)
  return Math.min(100, Math.round((actual / span) * 100))
}

// How long ago, not how late. Nothing in the Log counts down to anything.
export function relativeDay (timestamp, now) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || !value) return ''
  const dayOf = ms => {
    const date = new Date(ms)
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
  }
  const days = dayOf(now) - dayOf(value)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return days + 'd ago'
}
