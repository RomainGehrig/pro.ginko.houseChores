// ABOUTME: Unit tests for due-group assignment and saturating chore-ripeness ordering.
// ABOUTME: Run with: node --test slip.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import { cadenceDays, daysSinceCompletion, dueGroup, groupAndSort, slip } from './slip.js'

test('cadenceDays normalizes every supported recurring schedule shape', () => {
  const cases = [
    [{ type: 'periodic', every: 3, unit: 'day' }, 3],
    [{ type: 'periodic', every: 2, unit: 'week' }, 14],
    [{ type: 'periodic', every: 2, unit: 'month' }, 60],
    [{ type: 'periodic', every: 2, unit: 'year' }, 730],
    [{ type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1, 3, 5] } }, 7 / 3],
    [{ type: 'fixed', pattern: { kind: 'month_day', day: 15 } }, 30],
    [{ type: 'fixed', pattern: { kind: 'annual_date', month: 11, day: 3 } }, 365],
    [{ type: 'one_off' }, null]
  ]

  for (const [schedule, expected] of cases) {
    assert.equal(cadenceDays(schedule), expected)
  }
})

test('cadenceDays returns null for incomplete or invalid schedule shapes', () => {
  assert.equal(cadenceDays(null), null)
  assert.equal(cadenceDays({ type: 'periodic', every: 0, unit: 'day' }), null)
  assert.equal(cadenceDays({ type: 'fixed', pattern: { kind: 'weekdays' } }), null)
  assert.equal(cadenceDays({ type: 'fixed', pattern: { kind: 'weekdays', weekdays: [] } }), null)
  assert.equal(cadenceDays({ type: 'fixed', pattern: { kind: 'weekdays', weekdays: [0, 8] } }), null)
})

test('slip saturates recurring ripeness without turning long delays into unbounded scores', () => {
  const task = {
    scheduledDate: '2026-08-05',
    schedule: { type: 'periodic', every: 3, unit: 'day' }
  }

  assert.equal(slip(task, '2026-08-05'), 0)
  assert.equal(slip(task, '2026-08-08'), 1)
  assert.equal(slip(task, '2026-08-11'), 1.5)
  assert.equal(slip(task, '2026-09-30'), 2)
  assert.equal(slip({ ...task, scheduledDate: null }, '2026-08-08'), 0)
  assert.equal(slip({ ...task, schedule: { type: 'one_off' } }, '2026-08-08'), 0)
})

// The bands are read forward from today, not off a calendar: "this week" is the
// next seven days wherever the week happens to break, and "this month" the next
// thirty. Anything further out is simply later.
test('dueGroup assigns calendar bands at today, seven and thirty day boundaries', () => {
  const groupFor = scheduledDate => dueGroup({ scheduledDate }, '2026-08-08')

  assert.equal(groupFor('2026-08-07'), 'READY')
  assert.equal(groupFor('2026-08-08'), 'TODAY')
  assert.equal(groupFor('2026-08-09'), 'THIS WEEK')
  assert.equal(groupFor('2026-08-15'), 'THIS WEEK')
  assert.equal(groupFor('2026-08-16'), 'THIS MONTH')
  assert.equal(groupFor('2026-09-07'), 'THIS MONTH')
  assert.equal(groupFor('2026-09-08'), 'LATER')
  assert.equal(groupFor(null), 'SOMEDAY')
  assert.equal(dueGroup({
    taskMode: 'as_needed', readiness: 'ready', readySince: '2026-08-08',
    scheduledDate: '2030-01-01'
  }, '2026-08-08'), 'READY')
})

test('groupAndSort orders groups by date band, active ripeness, then drafts', () => {
  const tasks = [
    {
      _id: 'annual', name: 'Annual planning', status: 'active', scheduledDate: '2026-08-07',
      schedule: { type: 'periodic', every: 1, unit: 'year' }
    },
    {
      _id: 'draft', name: 'Draft guess', status: 'proposed', scheduledDate: '2026-08-07',
      schedule: { type: 'periodic', every: 1, unit: 'day' }
    },
    {
      _id: 'short', name: 'Water plants', status: 'approved_recurring', scheduledDate: '2026-08-07',
      schedule: { type: 'periodic', every: 3, unit: 'day' }
    },
    { _id: 'today', name: 'Today', status: 'active', scheduledDate: '2026-08-08', schedule: { type: 'one_off' } },
    { _id: 'week', name: 'This week', status: 'active', scheduledDate: '2026-08-15', schedule: { type: 'one_off' } },
    { _id: 'month', name: 'This month', status: 'active', scheduledDate: '2026-08-16', schedule: { type: 'one_off' } },
    { _id: 'later', name: 'Later', status: 'active', scheduledDate: '2026-09-08', schedule: { type: 'one_off' } },
    { _id: 'someday', name: 'Someday', status: 'active', scheduledDate: null, schedule: { type: 'one_off' } }
  ]

  assert.deepEqual(
    groupAndSort(tasks, '2026-08-08').map(group => ({
      name: group.name,
      taskIds: group.tasks.map(task => task._id)
    })),
    [
      { name: 'READY', taskIds: ['short', 'annual', 'draft'] },
      { name: 'TODAY', taskIds: ['today'] },
      { name: 'THIS WEEK', taskIds: ['week'] },
      { name: 'THIS MONTH', taskIds: ['month'] },
      { name: 'LATER', taskIds: ['later'] },
      { name: 'SOMEDAY', taskIds: ['someday'] }
    ]
  )
})

test('a ready as-needed chore is grouped as actionable despite its future check plan', () => {
  const tasks = [
    {
      _id: 'future-check', name: 'Empty dishwasher', status: 'active',
      taskMode: 'as_needed', readiness: 'ready', readySince: '2026-08-08',
      scheduledDate: '2030-01-01', schedule: { type: 'periodic', every: 2, unit: 'day' }
    },
    {
      _id: 'this-week', name: 'Water plants', status: 'active',
      scheduledDate: '2026-08-10', schedule: { type: 'one_off' }
    }
  ]

  assert.deepEqual(groupAndSort(tasks, '2026-08-08').map(group => [
    group.name, group.tasks.map(task => task._id)
  ]), [
    ['READY', ['future-check']],
    ['THIS WEEK', ['this-week']]
  ])
})

test('legacy ready chores use today when ordering inside the actionable band', () => {
  const tasks = [
    {
      _id: 'legacy-ready', name: 'Legacy ready', status: 'active',
      taskMode: 'as_needed', readiness: 'ready', scheduledDate: '2030-01-01',
      schedule: { type: 'periodic', every: 2, unit: 'day' }
    },
    {
      _id: 'ripe', name: 'Ripe scheduled', status: 'active', scheduledDate: '2026-08-01',
      schedule: { type: 'periodic', every: 2, unit: 'day' }
    }
  ]

  assert.deepEqual(
    groupAndSort(tasks, '2026-08-26')[0].tasks.map(task => task._id),
    ['ripe', 'legacy-ready']
  )
})

test('a completion reads the same whether the session stamped it or a date was typed', () => {
  const stamped = Date.UTC(2026, 7, 8, 14, 30)
  assert.equal(daysSinceCompletion(stamped, '2026-08-15'), 7)
  assert.equal(daysSinceCompletion('2026-08-08', '2026-08-15'), 7)
  assert.equal(daysSinceCompletion(String(stamped), '2026-08-15'), 7)
})

test('a completion in the future counts as no time elapsed, never as a negative', () => {
  assert.equal(daysSinceCompletion('2026-08-20', '2026-08-15'), 0)
  assert.equal(daysSinceCompletion(null, '2026-08-15'), null)
  assert.equal(daysSinceCompletion('2026-08-08', null), null)
})
