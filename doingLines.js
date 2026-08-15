// ABOUTME: The lines the Doing screen states about a running session — status, budget, spent, conclusion.
// ABOUTME: Past the time you set is a readout in plain words; nothing here says you are behind.

import { formatDuration, formatTimer } from './helpers.js'

// Short spans read better in seconds than as "0 min", and the whole point of
// these lines is to hand back a fact the user did not already have.
const span = ms => {
  const value = Math.max(0, Number(ms) || 0)
  return value < 60000
    ? Math.round(value / 1000) + ' sec'
    : formatDuration(Math.round(value / 60000))
}

export function sessionStatusLine (session) {
  if (session?.status === 'completed') return 'Session concluded'
  if (session?.status === 'active') return 'Counting active time'
  return 'Paused — the clock is stopped'
}

// A position in the session, not a score: there is no target to fall short of.
export function progressLine (total, resolved) {
  if (!total) return 'Nothing in the session'
  return resolved + ' of ' + total + ' resolved'
}

// The budget is a guess the app made with you, so passing it is stated the same
// way as anything else — a measurement, in the same neutral words.
export function remainingLine (session, elapsedMs) {
  const budgetMs = (Number(session?.timeBudgetMinutes) || 0) * 60000
  if (!budgetMs) return ''
  const budget = formatDuration(Number(session.timeBudgetMinutes))
  const over = (Number(elapsedMs) || 0) - budgetMs
  if (over > 0) return span(over) + ' past the ' + budget + ' you set'
  const left = Math.round(-over / 60000)
  return left
    ? 'About ' + formatDuration(left) + ' left of the ' + budget + ' you set'
    : 'You are at the time you set — carry on if you like'
}

const claimedMs = execution => {
  if (execution?.outcome !== 'done') return 0
  const raw = execution?.rawDurationMs
  if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
    return Number(raw)
  }
  return (Number(execution?.actualDuration) || 0) * 60000
}

export const spentLine = executions =>
  'Time allocated to chores: ' + span((executions || []).reduce(
    (total, execution) => total + claimedMs(execution), 0))

// Only a chore actually done claims time. A skip and an already-done both
// happened, and neither took any of this session.
export const tookLabel = execution =>
  execution?.outcome === 'done' ? 'Took ' + span(claimedMs(execution)) : 'No time claimed'

export function pauseLabel (session) {
  if (session?.status === 'completed') return 'Reopen session'
  return session?.status === 'active' ? 'Pause' : 'Resume'
}

export const autoPauseNote = () => 'Everything is resolved. Conclude, or add more.'

export const fitsLabel = remainingMs =>
  (Number(remainingMs) || 0) > 0 ? "Fits what's left" : 'Short ones, if you want to keep going'

export function quickAddLabel (typed) {
  const title = String(typed ?? '').trim()
  return title ? 'Add “' + title + '” as a new chore' : ''
}

export const concludedSummary = (total, resolved, elapsedMs) =>
  total + ' chores · ' + formatTimer(Math.floor((Number(elapsedMs) || 0) / 1000)) +
  ' active · ' + resolved + ' resolved'
