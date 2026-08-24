import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isAsNeededTask,
  isTaskEligible,
  normalizeTaskAvailability,
  taskModeFields,
  taskModeOf,
  taskReadinessOf
} from './taskModeLogic.js'

test('missing and unknown task modes remain scheduled and eligible', () => {
  assert.equal(taskModeOf({}), 'scheduled')
  assert.equal(taskModeOf({ taskMode: 'future_mode' }), 'scheduled')
  assert.equal(taskReadinessOf({}), null)
  assert.equal(isTaskEligible({}), true)
})

test('as-needed tasks are eligible only when explicitly ready', () => {
  assert.equal(isAsNeededTask({ taskMode: 'as_needed' }), true)
  assert.equal(taskReadinessOf({ taskMode: 'as_needed' }), 'waiting')
  assert.equal(isTaskEligible({ taskMode: 'as_needed' }), false)
  assert.equal(isTaskEligible({ taskMode: 'as_needed', readiness: 'waiting' }), false)
  assert.equal(isTaskEligible({ taskMode: 'as_needed', readiness: 'ready' }), true)
})

test('normalization emits explicit compatible fields without mutating input', () => {
  const legacy = { _id: 'legacy', name: 'Dust shelves' }
  assert.deepEqual(normalizeTaskAvailability(legacy), {
    _id: 'legacy', name: 'Dust shelves', taskMode: 'scheduled', readiness: null
  })
  assert.equal('taskMode' in legacy, false)
  assert.deepEqual(normalizeTaskAvailability({ taskMode: 'as_needed', readiness: 'bad' }), {
    taskMode: 'as_needed', readiness: 'waiting'
  })
})

test('mode changes clear stale readiness and never revive it later', () => {
  const ready = { taskMode: 'as_needed', readiness: 'ready' }
  assert.deepEqual(taskModeFields(ready, 'scheduled'), {
    taskMode: 'scheduled', readiness: null
  })
  assert.deepEqual(taskModeFields({ ...ready, taskMode: 'scheduled' }, 'as_needed'), {
    taskMode: 'as_needed', readiness: 'waiting'
  })
  assert.deepEqual(taskModeFields(ready, 'as_needed'), {
    taskMode: 'as_needed', readiness: 'ready'
  })
})
