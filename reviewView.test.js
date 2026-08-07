// ABOUTME: Tests review persistence when users correct measured task durations.
// ABOUTME: Ensures exact timing is replaced only after an explicit correction.

import test from 'node:test'
import assert from 'node:assert/strict'
import * as reviewView from './reviewView.js'

test('review duration input marks a valid correction without accepting blank input', () => {
  const applyDurationCorrection = reviewView.applyDurationCorrection
  assert.equal(typeof applyDurationCorrection, 'function')
  const execution = { actualDuration: 42 }

  assert.equal(applyDurationCorrection(execution, '10'), true)
  assert.equal(execution.actualDuration, 10)
  assert.equal(execution.durationCorrected, true)

  assert.equal(applyDurationCorrection(execution, ''), false)
  assert.equal(execution.actualDuration, 10)
})

test('review persistence mirrors an explicit duration correction into exact fields', async () => {
  const updates = []
  const saveExecutionReviews = reviewView.saveExecutionReviews
  assert.equal(typeof saveExecutionReviews, 'function')

  await saveExecutionReviews([{
    _id: 'execution-corrected',
    actualDuration: 10,
    rawDurationMs: 42 * 60000,
    actualSeconds: 42 * 60,
    durationCorrected: true,
    difficultyRating: 3,
    notes: 'Forgot to pause'
  }, {
    _id: 'execution-untouched',
    actualDuration: 4,
    rawDurationMs: 215000,
    actualSeconds: 215,
    difficultyRating: null,
    notes: ''
  }], async (id, fields) => updates.push({ id, fields }))

  assert.deepEqual(updates, [{
    id: 'execution-corrected',
    fields: {
      actualDuration: 10,
      rawDurationMs: 600000,
      actualSeconds: 600,
      difficultyRating: 3,
      notes: 'Forgot to pause'
    }
  }, {
    id: 'execution-untouched',
    fields: {
      actualDuration: 4,
      difficultyRating: null,
      notes: ''
    }
  }])
})
