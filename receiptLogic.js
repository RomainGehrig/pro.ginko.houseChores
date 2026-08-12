// ABOUTME: Pure copy for the Receipt — what the session measured, said once and neutrally.
// ABOUTME: Drift from an estimate is reported as a fact; nothing here scores the user.

import { formatDuration } from './helpers.js'

const DIFFICULTY_WORDS = ['Easy', 'Light', 'Middling', 'Hard', 'A slog']

const minutes = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const countLabel = (count, singular, plural) =>
  count + ' ' + (count === 1 ? singular : plural)

export function driftLine (actualMinutes, estimateMinutes) {
  const actual = minutes(actualMinutes)
  const estimate = minutes(estimateMinutes)
  if (actual === null || estimate === null) return ''
  const drift = actual - estimate
  if (drift === 0) return 'Exactly the estimate'
  return drift > 0
    ? formatDuration(drift) + ' over the estimate'
    : formatDuration(-drift) + ' under the estimate'
}

export function measuredLine (measuredMinutes) {
  const measured = minutes(measuredMinutes)
  return measured === null ? '' : 'Session measured ' + formatDuration(measured)
}

export function estimateLine (estimateMinutes) {
  const estimate = minutes(estimateMinutes)
  return estimate === null ? '' : 'Estimate ' + formatDuration(estimate)
}

export function difficultyLabel (rating) {
  const level = Number(rating)
  return DIFFICULTY_WORDS[level - 1] || 'Not rated'
}

export function receiptHeadline (executions) {
  const recorded = (executions || []).filter(execution => execution?.outcome !== 'cancelled')
  if (!recorded.length) return 'Nothing recorded yet'
  const total = recorded.reduce((sum, execution) => sum + (Number(execution.actualDuration) || 0), 0)
  return countLabel(recorded.length, 'chore', 'chores') + ' · ' + formatDuration(total) + ' recorded'
}

export function receiptSubline () {
  return 'Measured by the session. Correct anything that is wrong.'
}

export function receiptOffersLine (offerCount) {
  const count = Number(offerCount) || 0
  return count
    ? countLabel(count, 'estimate', 'estimates') + ' could be revised — your call'
    : 'No estimates need revising'
}

export function receiptDateLine (timestamp, locales) {
  const moment = Number(timestamp)
  if (!Number.isFinite(moment) || moment <= 0) return 'Receipt'
  const stamp = new Date(moment).toLocaleDateString(locales, {
    weekday: 'short', day: 'numeric', month: 'short'
  })
  return 'Receipt · ' + stamp
}

export function receiptSaveLabel (acceptedCount) {
  const count = Number(acceptedCount) || 0
  return count
    ? 'Save · update ' + countLabel(count, 'estimate', 'estimates')
    : 'Save corrections'
}
