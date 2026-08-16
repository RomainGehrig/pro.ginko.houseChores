// ABOUTME: Tests the one-way upgrade of stored task records to the current shape.
// ABOUTME: The point is that the old field names leave the record, not merely stop being read.

import test from 'node:test'
import assert from 'node:assert/strict'
import { migratedTaskRecord, upgradeLegacyTasks } from './taskMigration.js'

test('a day count becomes the schedule it always meant', () => {
  const migrated = migratedTaskRecord({
    _id: 't1', name: 'Clean the sinks', status: 'approved_recurring',
    recurrence: 7, scheduledDate: '2026-08-20'
  })

  assert.deepEqual(migrated, {
    _id: 't1', name: 'Clean the sinks', status: 'approved_recurring',
    schedule: { type: 'periodic', every: 7, unit: 'day' },
    suggestedSchedule: null,
    scheduledDate: '2026-08-20'
  })
  assert.ok(!('recurrence' in migrated), 'the old name is gone, not merely unread')
})

test('a due timestamp becomes the local day it stood for', () => {
  const migrated = migratedTaskRecord({
    _id: 't2', status: 'active', nextDueDate: new Date(2026, 7, 20, 12).getTime()
  })
  assert.equal(migrated.scheduledDate, '2026-08-20')
  assert.ok(!('nextDueDate' in migrated))
})

test('a schedule already written wins over the day count beside it', () => {
  const migrated = migratedTaskRecord({
    _id: 't3', recurrence: 365,
    schedule: { type: 'periodic', every: 1, unit: 'year' }
  })
  assert.deepEqual(migrated.schedule, { type: 'periodic', every: 1, unit: 'year' })
  assert.ok(!('recurrence' in migrated))
})

test('a suggested day count becomes a suggested schedule', () => {
  const migrated = migratedTaskRecord({ _id: 't4', suggestedRecurrenceDays: 7 })
  assert.deepEqual(migrated.suggestedSchedule, { type: 'periodic', every: 7, unit: 'day' })
  assert.ok(!('suggestedRecurrenceDays' in migrated))
})

// A record that never had a schedule and has no day count to read is a one-off,
// which is what the app assumed of it all along.
test('nothing to read from leaves a one-off, and an unusable count is dropped', () => {
  assert.deepEqual(migratedTaskRecord({ _id: 't5', recurrence: 0 }).schedule, { type: 'one_off' })
  assert.deepEqual(migratedTaskRecord({ _id: 't6', recurrence: 'weekly' }).schedule, { type: 'one_off' })
  assert.equal(migratedTaskRecord({ _id: 't7', suggestedRecurrenceDays: -3 }).suggestedSchedule, null)
})

test('a record already in the current shape is left entirely alone', () => {
  assert.equal(migratedTaskRecord({
    _id: 't8', schedule: { type: 'one_off' }, scheduledDate: null
  }), null)
  assert.equal(migratedTaskRecord(null), null)
})

// The record freezr holds is replaced wholesale, so its own bookkeeping must not
// be sent back as if it were the app's to set.
test('the write carries the chore and not freezr’s own bookkeeping', async () => {
  const written = []
  await upgradeLegacyTasks(
    [{ _id: 't9', name: 'Mop', recurrence: 14, _date_created: 1, _date_modified: 2, _accessibles: [] }],
    (id, fields) => { written.push([id, fields]); return Promise.resolve() }
  )

  assert.deepEqual(written, [['t9', {
    name: 'Mop',
    schedule: { type: 'periodic', every: 14, unit: 'day' },
    suggestedSchedule: null,
    scheduledDate: null
  }]])
})

test('upgrading returns the new shape for every record, touching only what needs it', async () => {
  const written = []
  const upgraded = await upgradeLegacyTasks([
    { _id: 'a', name: 'Old', recurrence: 7 },
    { _id: 'b', name: 'New', schedule: { type: 'one_off' } }
  ], (id, fields) => { written.push(id); return Promise.resolve() })

  assert.deepEqual(written, ['a'], 'the clean record is not rewritten')
  assert.deepEqual(upgraded.map(task => task.name), ['Old', 'New'])
  assert.deepEqual(upgraded[0].schedule, { type: 'periodic', every: 7, unit: 'day' })
  assert.ok(!('recurrence' in upgraded[0]))
})

// A failed write must not cost the user their list. The record stays as it was
// on disk and is tried again next time, but the screen reads the new shape.
test('a write that fails still yields a readable list', async () => {
  const upgraded = await upgradeLegacyTasks(
    [{ _id: 'a', name: 'Old', recurrence: 7 }],
    () => Promise.reject(new Error('offline'))
  )
  assert.deepEqual(upgraded[0].schedule, { type: 'periodic', every: 7, unit: 'day' })
})
