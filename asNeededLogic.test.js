// ABOUTME: Tests condition-gated chore inspection transitions and schedule summaries.
// ABOUTME: Keeps inspection dates factual and independent from execution completion wording.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asNeededScheduleSummary,
  deferReadinessFields,
  markReadyFields
} from './asNeededLogic.js'

test('mark ready records the confirmation day', () => {
  assert.deepEqual(markReadyFields('2026-08-24'), {
    readiness: 'ready', scheduledDate: '2026-08-24'
  })
})

test('periodic deferral advances from the check day', () => {
  assert.deepEqual(deferReadinessFields({
    schedule: { type: 'periodic', every: 3, unit: 'day' },
    scheduledDate: '2026-01-01'
  }, '2026-08-24'), {
    readiness: 'waiting', scheduledDate: '2026-08-27'
  })
})

test('fixed deferral ignores a stale future attention date and advances from the check', () => {
  assert.deepEqual(deferReadinessFields({
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] } },
    scheduledDate: '2026-12-25'
  }, '2026-08-24'), {
    readiness: 'waiting', scheduledDate: '2026-08-28'
  })
})

test('one-off deferral waits for a valid inline date', () => {
  const task = { schedule: { type: 'one_off' } }
  assert.equal(deferReadinessFields(task, '2026-08-24'), null)
  assert.equal(deferReadinessFields(task, '2026-08-24', 'not-a-date'), null)
  assert.deepEqual(deferReadinessFields(task, '2026-08-24', '2026-09-02'), {
    readiness: 'waiting', scheduledDate: '2026-09-02'
  })
})

test('schedule summaries speak about inspection', () => {
  assert.equal(asNeededScheduleSummary({ type: 'one_off' }), 'Check once')
  assert.equal(asNeededScheduleSummary({ type: 'periodic', every: 2, unit: 'day' }),
    'Check about every 2 days')
  assert.equal(asNeededScheduleSummary({
    type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] }
  }), 'Check every Friday')
})
