// ABOUTME: Tests the Receipt's pure copy — what the session measured, stated once.
// ABOUTME: Guards the neutral phrasing: drift is a fact, never a judgement.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  receiptHeadline, receiptSubline, receiptOffersLine, receiptSaveLabel, receiptDateLine,
  rowTimeLabel, driftChipLabel, actualCaption, estimateCaption, measuredNote,
  pastActualsLine, suggestionChipLabel, suggestionFlagText, resetEstimateLabel,
  offerLine, filedMessage
} from './receiptLogic.js'

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

test('a chore left unrecorded still counts, but adds no time', () => {
  const executions = [
    { outcome: 'done', actualDuration: 12 },
    { outcome: 'done', actualDuration: null, timeOmitted: true }
  ]
  assert.equal(receiptHeadline(executions), '2 chores · 12 min recorded')
})

test('the subline says where the figures came from', () => {
  assert.equal(receiptSubline(), 'Actuals as the session measured them. Correct anything that is wrong.')
})

test('the offers line leaves the decision with the user', () => {
  assert.equal(receiptOffersLine(0), 'No estimates need revising')
  assert.equal(receiptOffersLine(1), '1 estimate could be revised — your call')
  assert.equal(receiptOffersLine(3), '3 estimates could be revised — your call')
})

test('the save label files the session and names any estimate change', () => {
  assert.equal(receiptSaveLabel(0), 'File session')
  assert.equal(receiptSaveLabel(1), 'File session · update 1 estimate')
  assert.equal(receiptSaveLabel(2), 'File session · update 2 estimates')
})

test('filing reports itself plainly, with the estimate count when there is one', () => {
  assert.equal(filedMessage(0), 'Filed to the log')
  assert.equal(filedMessage(1), 'Filed · 1 estimate updated')
  assert.equal(filedMessage(3), 'Filed · 3 estimates updated')
})

test('the eyebrow dates the receipt from when the work actually ended', () => {
  const ended = new Date(2026, 7, 9, 18, 30).getTime()
  assert.equal(receiptDateLine(ended, 'en-GB'), 'Receipt · Sun 9 Aug')
  assert.equal(receiptDateLine(null), 'Receipt')
})

test('the card line says what happened to the chore', () => {
  assert.equal(rowTimeLabel({ outcome: 'done', actual: 12 }), 'Took 12 min')
  assert.equal(rowTimeLabel({ outcome: 'cancelled', actual: 12 }), 'Skipped')
  assert.equal(rowTimeLabel({ outcome: 'done', actual: 12, omitted: true }), 'No time recorded')
})

test('the drift chip is a signed figure, using a real minus sign', () => {
  assert.equal(driftChipLabel(20, 15), '+5 min')
  assert.equal(driftChipLabel(10, 15), '−5 min')
  assert.equal(driftChipLabel(15, 15), '')
})

test('the captions name each track of the gauge', () => {
  assert.equal(actualCaption(12, false), 'Took 12 min')
  assert.equal(actualCaption(12, true), 'Not recorded')
  assert.equal(estimateCaption(15), 'Estimate 15 min')
})

test('the note under the gauge keeps the measurement visible behind a correction', () => {
  assert.equal(measuredNote({ actual: 12, measured: 12 }), 'The session measured 12 min')
  assert.equal(measuredNote({ actual: 14, measured: 12 }), 'Edited — the session measured 12 min')
  assert.equal(measuredNote({ actual: null, measured: 12, omitted: true }),
    'Nothing goes to the log for this one')
})

test('previous actuals are listed as plain figures', () => {
  assert.equal(pastActualsLine([12, 15, 9]), 'Previously 12, 15, 9 min')
  assert.equal(pastActualsLine([]), '')
})

test('the suggestion is a toggle that says which way it will go', () => {
  assert.equal(suggestionChipLabel(15, 12), 'Use suggested 12 min')
  assert.equal(suggestionChipLabel(12, 12), 'Estimate is now 12 min')
  assert.equal(suggestionChipLabel(15, null), '')
  assert.equal(suggestionFlagText(15, 12), 'suggested')
  assert.equal(suggestionFlagText(12, 12), 'suggested (taken)')
})

test('the estimate can always be put back where it started', () => {
  assert.equal(resetEstimateLabel(15), 'Reset to 15 min')
})

test('the offer card states the move it is proposing, or the one already made', () => {
  assert.equal(offerLine({ estimate: 15, base: 15, suggestion: 12 }), 'Estimate 15 min → 12 min')
  assert.equal(offerLine({ estimate: 12, base: 15, suggestion: 12 }),
    'Estimate updated to 12 min — was 15 min')
})
