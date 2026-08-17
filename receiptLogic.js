// ABOUTME: Pure copy for the Receipt — what the session measured, said once and neutrally.
// ABOUTME: Drift from an estimate is reported as a fact; nothing here scores the user.

import { formatDuration } from './helpers.js'

const minutes = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const countLabel = (count, singular, plural) =>
  count + ' ' + (count === 1 ? singular : plural)

export function receiptHeadline (executions) {
  const recorded = (executions || []).filter(execution => execution?.outcome !== 'cancelled')
  if (!recorded.length) return 'Nothing recorded yet'
  const total = recorded.reduce(
    (sum, execution) => sum + (execution.timeOmitted ? 0 : Number(execution.actualDuration) || 0), 0)
  return countLabel(recorded.length, 'chore', 'chores') + ' · ' + formatDuration(total) + ' recorded'
}

export function receiptSubline () {
  return 'Actuals as the session measured them. Correct anything that is wrong.'
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
    ? 'File session · update ' + countLabel(count, 'estimate', 'estimates')
    : 'File session'
}

export function filedMessage (acceptedCount) {
  const count = Number(acceptedCount) || 0
  return count
    ? 'Filed · ' + countLabel(count, 'estimate', 'estimates') + ' updated'
    : 'Filed to the log'
}

// A skipped chore claims no work time at all, and an unrecorded one says so
// rather than showing a zero that would read as an achievement of nothing.
export function rowTimeLabel ({ outcome, actual, omitted } = {}) {
  if (outcome === 'cancelled') return 'Skipped'
  if (omitted) return 'No time recorded'
  const spent = minutes(actual)
  return spent === null ? 'No time recorded' : 'Took ' + formatDuration(spent)
}

export function driftChipLabel (actualMinutes, estimateMinutes) {
  const actual = minutes(actualMinutes)
  const estimate = minutes(estimateMinutes)
  if (actual === null || estimate === null) return ''
  const drift = actual - estimate
  if (drift === 0) return ''
  return (drift > 0 ? '+' : '−') + Math.abs(drift) + ' min'
}

export function actualCaption (actualMinutes, omitted) {
  if (omitted) return 'Not recorded'
  const actual = minutes(actualMinutes)
  return actual === null ? 'Not recorded' : 'Took ' + formatDuration(actual)
}

export function estimateCaption (estimateMinutes) {
  const estimate = minutes(estimateMinutes)
  return estimate === null ? 'No estimate' : 'Estimate ' + formatDuration(estimate)
}

// A correction never erases the measurement — the clock's figure stays on the
// card, because that honesty is what the estimate learns from.
export function measuredNote ({ actual, measured, omitted } = {}) {
  if (omitted) return 'Nothing goes to the log for this one'
  const seen = minutes(measured)
  if (seen === null) return ''
  return Number(actual) === Number(measured)
    ? 'The session measured ' + formatDuration(seen)
    : 'Edited — the session measured ' + formatDuration(seen)
}

export function pastActualsLine (past) {
  const figures = (past || []).map(minutes).filter(value => value !== null)
  return figures.length ? 'Previously ' + figures.join(', ') + ' min' : ''
}

export function suggestionChipLabel (estimateMinutes, suggestionMinutes) {
  const suggestion = minutes(suggestionMinutes)
  if (suggestion === null) return ''
  return Number(estimateMinutes) === suggestion
    ? 'Estimate is now ' + formatDuration(suggestion)
    : 'Use suggested ' + formatDuration(suggestion)
}

export function suggestionFlagText (estimateMinutes, suggestionMinutes) {
  return Number(estimateMinutes) === Number(suggestionMinutes)
    ? 'suggested (taken)'
    : 'suggested'
}

export function resetEstimateLabel (baseEstimateMinutes) {
  return 'Reset to ' + formatDuration(Number(baseEstimateMinutes))
}

export function offerLine ({ estimate, base, suggestion } = {}) {
  return Number(estimate) === Number(suggestion)
    ? 'Estimate updated to ' + formatDuration(suggestion) + ' — was ' + formatDuration(base)
    : 'Estimate ' + formatDuration(estimate) + ' → ' + formatDuration(suggestion)
}
