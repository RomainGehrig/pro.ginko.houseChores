// ABOUTME: Tests the lines the Doing screen states about a running session.
// ABOUTME: Guards the rule that going past the time you set is a readout, never a fault.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  autoPauseNote,
  concludedSummary,
  fitsLabel,
  pauseLabel,
  progressLine,
  quickAddLabel,
  remainingLine,
  sessionStatusLine,
  spentLine,
  tookLabel
} from './doingLines.js'

const session = (overrides = {}) => ({
  _id: 's1', status: 'active', timeBudgetMinutes: 30,
  accumulatedActiveMs: 10 * 60000, lastResumedAt: null, ...overrides
})

test('the status line says what the clock is doing, in its own words', () => {
  assert.equal(sessionStatusLine(session()), 'Counting active time')
  assert.equal(sessionStatusLine(session({ status: 'paused' })), 'Paused — the clock is stopped')
  assert.equal(sessionStatusLine(session({ status: 'completed' })), 'Session concluded')
  assert.equal(sessionStatusLine(null), 'Paused — the clock is stopped')
})

test('progress is a position in the session, not a score', () => {
  assert.equal(progressLine(3, 1), '1 of 3 resolved')
  assert.equal(progressLine(0, 0), 'Nothing in the session')
  assert.equal(progressLine(1, 0), '0 of 1 resolved')
})

test('the remaining line reads the budget out and never scolds', () => {
  assert.equal(remainingLine(session(), 12 * 60000),
    'About 18 min left of the 30 min you set')
  assert.equal(remainingLine(session(), 30 * 60000),
    'You are at the time you set — carry on if you like')

  const over = remainingLine(session(), 47 * 60000)
  assert.equal(over, '17 min past the 30 min you set')
  assert.doesNotMatch(over, /over(due)?|late|behind|too long/i)
})

test('a session with no budget states the clock alone', () => {
  assert.equal(remainingLine(session({ timeBudgetMinutes: 0 }), 5 * 60000), '')
})

test('spent is the time the chores themselves claimed', () => {
  assert.equal(spentLine([
    { outcome: 'done', rawDurationMs: 7 * 60000 },
    { outcome: 'cancelled', rawDurationMs: 0 }
  ]), 'Time allocated to chores: 7 min')
  assert.equal(spentLine([{ outcome: 'done', rawDurationMs: 20000 }]),
    'Time allocated to chores: 20 sec')
  assert.equal(spentLine([]), 'Time allocated to chores: 0 sec')
})

test('a resolved chore says what it took, and a skipped one claims nothing', () => {
  assert.equal(tookLabel({ outcome: 'done', rawDurationMs: 7 * 60000 }), 'Took 7 min')
  assert.equal(tookLabel({ outcome: 'already_done', rawDurationMs: 0 }), 'No time claimed')
  assert.equal(tookLabel({ outcome: 'cancelled', rawDurationMs: 90000 }), 'No time claimed')
  assert.equal(tookLabel({ outcome: 'done', actualDuration: 12 }), 'Took 12 min')
})

// The button is one control with two jobs, so its label is the job it will do
// next — never the state it is already in.
test('the pause control names the thing it will do', () => {
  assert.equal(pauseLabel(session()), 'Pause')
  assert.equal(pauseLabel(session({ status: 'paused' })), 'Resume')
  assert.equal(pauseLabel(session({ status: 'completed' })), 'Reopen session')
})

test('the note explains why the session stopped on its own, and offers both ways on', () => {
  assert.equal(autoPauseNote(), 'Everything is resolved. Conclude, or add more.')
})

test('what fits changes its offer once you are past the time you set', () => {
  assert.equal(fitsLabel(8 * 60000), "Fits what's left")
  assert.equal(fitsLabel(0), 'Shortest ones, if you want to keep going')
  assert.equal(fitsLabel(-5 * 60000), 'Shortest ones, if you want to keep going')
})

test('the quick add offers the words you typed, as a chore', () => {
  assert.equal(quickAddLabel('Descale the kettle'), 'Add “Descale the kettle” as a new chore')
  assert.equal(quickAddLabel('  '), '')
  assert.equal(quickAddLabel(null), '')
})

test('the conclusion counts what happened, with no verdict on it', () => {
  const summary = concludedSummary(3, 2, 34 * 60000)
  assert.equal(summary, '3 chores · 34:00 active · 2 resolved')
  assert.doesNotMatch(summary, /great|well done|streak|score/i)
})
