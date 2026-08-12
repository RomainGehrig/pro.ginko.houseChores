// ABOUTME: Tests the Receipt's pure copy — what the session measured, stated once.
// ABOUTME: Guards the neutral phrasing: drift is a fact, never a judgement.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  driftLine, measuredLine, estimateLine, difficultyLabel,
  receiptHeadline, receiptSubline, receiptOffersLine, receiptSaveLabel, receiptDateLine
} from './receiptLogic.js'

test('drift states the difference from the estimate in both directions', () => {
  assert.equal(driftLine(20, 15), '5 min over the estimate')
  assert.equal(driftLine(10, 15), '5 min under the estimate')
  assert.equal(driftLine(15, 15), 'Exactly the estimate')
})

test('drift says nothing when there was no estimate to compare against', () => {
  assert.equal(driftLine(20, null), '')
  assert.equal(driftLine(20, 0), '')
})

test('drift never names a chore late or over budget', () => {
  const line = driftLine(90, 15)
  assert.doesNotMatch(line, /late|overdue|over budget|too long/i)
})

test('measured and estimate lines report the session figures', () => {
  assert.equal(measuredLine(12), 'Session measured 12 min')
  assert.equal(estimateLine(45), 'Estimate 45 min')
  assert.equal(estimateLine(null), '')
})

test('difficulty reads as a word, and says so when unrated', () => {
  assert.equal(difficultyLabel(1), 'Easy')
  assert.equal(difficultyLabel(3), 'Middling')
  assert.equal(difficultyLabel(5), 'A slog')
  assert.equal(difficultyLabel(null), 'Not rated')
  assert.equal(difficultyLabel(9), 'Not rated')
})

test('the headline counts what was recorded, skipping the skipped', () => {
  const executions = [
    { outcome: 'done', actualDuration: 12 },
    { outcome: 'already_done', actualDuration: 8 },
    { outcome: 'cancelled', actualDuration: 5 }
  ]
  assert.equal(receiptHeadline(executions), '2 chores · 20 min recorded')
  assert.equal(receiptHeadline([{ outcome: 'done', actualDuration: 7 }]), '1 chore · 7 min recorded')
  assert.equal(receiptHeadline([]), 'Nothing recorded yet')
})

test('the subline invites correction rather than confirmation', () => {
  assert.equal(receiptSubline(), 'Measured by the session. Correct anything that is wrong.')
})

test('the offers line leaves the decision with the user', () => {
  assert.equal(receiptOffersLine(0), 'No estimates need revising')
  assert.equal(receiptOffersLine(1), '1 estimate could be revised — your call')
  assert.equal(receiptOffersLine(3), '3 estimates could be revised — your call')
})

test('the save label names how many estimates will change', () => {
  assert.equal(receiptSaveLabel(0), 'Save corrections')
  assert.equal(receiptSaveLabel(1), 'Save · update 1 estimate')
  assert.equal(receiptSaveLabel(2), 'Save · update 2 estimates')
})

test('the eyebrow dates the receipt from when the work actually ended', () => {
  const ended = new Date(2026, 7, 9, 18, 30).getTime()
  assert.equal(receiptDateLine(ended, 'en-GB'), 'Receipt · Sun 9 Aug')
  assert.equal(receiptDateLine(null), 'Receipt')
})
