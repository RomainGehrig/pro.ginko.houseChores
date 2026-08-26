// ABOUTME: Tests condition-gated chore inspection transitions and schedule summaries.
// ABOUTME: Keeps inspection dates factual and independent from execution completion wording.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asNeededScheduleSummary,
  buildAsNeededGroups,
  deferReadinessFields,
  markReadyFields
} from './asNeededLogic.js'

test('mark ready preserves the planned check date', () => {
  assert.deepEqual(markReadyFields('2026-08-24'), {
    readiness: 'ready'
  })
})

test('Not ready restores a still-future planned check instead of replacing it', () => {
  assert.deepEqual(deferReadinessFields({
    readiness: 'ready',
    schedule: { type: 'periodic', every: 1, unit: 'week' },
    scheduledDate: '2026-09-01'
  }, '2026-08-24'), {
    readiness: 'waiting', scheduledDate: '2026-09-01'
  })
  assert.deepEqual(deferReadinessFields({
    readiness: 'ready',
    schedule: { type: 'one_off' },
    scheduledDate: '2026-09-01'
  }, '2026-08-24'), {
    readiness: 'waiting', scheduledDate: '2026-09-01'
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

test('as-needed groups include only live as-needed chores in fixed neutral bands', () => {
  const categories = [{ _id: 'home', name: 'Home' }, { _id: 'admin', name: 'Admin' }]
  const task = (overrides = {}) => ({
    _id: 'task', name: 'Inspect', status: 'active', taskMode: 'as_needed',
    readiness: 'waiting', categoryId: 'home', scheduledDate: '2026-08-24',
    schedule: { type: 'periodic', every: 2, unit: 'day' },
    ...overrides
  })
  const tasks = [
    task({ _id: 'scheduled', taskMode: 'scheduled' }),
    task({ _id: 'archived', status: 'archived' }),
    task({ _id: 'ready-new', name: 'Ready new', readiness: 'ready', scheduledDate: '2026-08-23' }),
    task({ _id: 'ready-old', name: 'Ready old', readiness: 'ready', scheduledDate: '2026-08-01' }),
    task({ _id: 'past', name: 'Past check', scheduledDate: '2026-08-20' }),
    task({ _id: 'today', name: 'Today check' }),
    task({ _id: 'week', name: 'Weekly check', scheduledDate: '2026-08-27' }),
    task({ _id: 'month', name: 'Monthly check', scheduledDate: '2026-09-10' }),
    task({ _id: 'later', name: 'Later check', scheduledDate: '2026-10-01' }),
    task({ _id: 'undated', name: 'No date', scheduledDate: null })
  ]

  assert.deepEqual(
    buildAsNeededGroups(tasks, '2026-08-24', {}, categories)
      .map(group => [group.key, group.tasks.map(task => task._id)]),
    [
      ['ready', ['ready-old', 'ready-new']],
      ['check-now', ['past', 'today']],
      ['this-week', ['week']],
      ['this-month', ['month']],
      ['later', ['later']],
      ['someday', ['undated']]
    ]
  )
})

test('as-needed groups reuse Chores query and category filters', () => {
  const categories = [{ _id: 'home', name: 'Home' }, { _id: 'admin', name: 'Admin' }]
  const tasks = [
    {
      _id: 'mirror', name: 'Check mirror', status: 'active', taskMode: 'as_needed',
      readiness: 'waiting', categoryId: 'home', scheduledDate: '2026-08-20'
    },
    {
      _id: 'invoice', name: 'Check invoice', status: 'active', taskMode: 'as_needed',
      readiness: 'waiting', categoryId: 'admin', scheduledDate: '2026-08-24'
    }
  ]

  assert.deepEqual(
    buildAsNeededGroups(tasks, '2026-08-24', { query: 'mirror' }, categories)
      .flatMap(group => group.tasks.map(task => task._id)),
    ['mirror']
  )
  assert.deepEqual(
    buildAsNeededGroups(tasks, '2026-08-24', { category: 'Admin' }, categories)
      .flatMap(group => group.tasks.map(task => task._id)),
    ['invoice']
  )
})
