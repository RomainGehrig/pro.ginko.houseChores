// ABOUTME: Tests reopening a resolved chore: what the task gets back and what time returns.
// ABOUTME: An outcome recorded by accident must be undoable without ending the session.

import test from 'node:test'
import assert from 'node:assert/strict'
import { taskFieldsBeforeUpdate, reopenPlan } from './reopenLogic.js'

test('the snapshot keeps exactly the fields the completion is about to change', () => {
  const task = {
    _id: 't1', name: 'Water the plants', status: 'active',
    scheduledDate: '2026-08-10', lastCompletedDate: 1754000000000
  }
  assert.deepEqual(
    taskFieldsBeforeUpdate(task, { lastCompletedDate: 1755000000000, scheduledDate: '2026-08-17' }),
    { lastCompletedDate: 1754000000000, scheduledDate: '2026-08-10' }
  )
})

test('a chore never completed before records null rather than nothing', () => {
  assert.deepEqual(
    taskFieldsBeforeUpdate({ _id: 't1', status: 'active' },
      { lastCompletedDate: 1755000000000, status: 'archived' }),
    { lastCompletedDate: null, status: 'active' }
  )
})

test('a skipped chore changes nothing, so there is nothing to snapshot', () => {
  assert.equal(taskFieldsBeforeUpdate({ _id: 't1' }, null), null)
})

test('reopening the latest outcome returns the time it claimed', () => {
  const execution = {
    _id: 'e2', taskId: 't2', activeElapsedMs: 900000, rawDurationMs: 300000,
    taskFieldsBefore: { lastCompletedDate: null, scheduledDate: '2026-08-10' }
  }
  const plan = reopenPlan(execution, [
    { _id: 'e1', activeElapsedMs: 600000, rawDurationMs: 600000 },
    execution
  ])

  assert.deepEqual(plan.taskUpdate, { lastCompletedDate: null, scheduledDate: '2026-08-10' })
  assert.deepEqual(plan.sessionUpdate, { checkpointElapsedMs: 600000 })
  assert.equal(plan.restoresSchedule, true)
})

test('reopening an earlier outcome leaves the checkpoint where the later one put it', () => {
  const execution = { _id: 'e1', taskId: 't1', activeElapsedMs: 600000, rawDurationMs: 600000 }
  const plan = reopenPlan(execution, [
    execution,
    { _id: 'e2', activeElapsedMs: 900000, rawDurationMs: 300000 }
  ])

  assert.equal(plan.sessionUpdate, null)
})

test('an outcome recorded before snapshots existed still reopens, and says the schedule stays', () => {
  const execution = { _id: 'e1', taskId: 't1', activeElapsedMs: 600000, rawDurationMs: 600000 }
  const plan = reopenPlan(execution, [execution])

  assert.equal(plan.taskUpdate, null)
  assert.equal(plan.restoresSchedule, false)
})

test('the checkpoint never goes below zero', () => {
  const execution = { _id: 'e1', taskId: 't1', activeElapsedMs: 100, rawDurationMs: 5000 }
  assert.deepEqual(reopenPlan(execution, [execution]).sessionUpdate, { checkpointElapsedMs: 0 })
})
