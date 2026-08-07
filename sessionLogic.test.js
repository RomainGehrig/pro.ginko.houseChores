// ABOUTME: Tests compact durable-session timing and transitions.
// ABOUTME: Protects reload, pause, outcome allocation, and legacy recovery.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeElapsedMs,
  chooseCurrentSession,
  conclusionFields,
  normalizationFields,
  outcomeTiming,
  pauseFields,
  remainingBudgetMs,
  resumeFields
} from './sessionLogic.js'

test('reload and background time derive from persisted timestamps', () => {
  assert.equal(activeElapsedMs({
    status: 'active', accumulatedActiveMs: 4000, activeStartedAt: 10000
  }, 19000), 13000)
})

test('pause freezes elapsed and resume starts a fresh active run', () => {
  assert.deepEqual(pauseFields({
    status: 'active', accumulatedActiveMs: 4000, activeStartedAt: 10000
  }, 16000), {
    status: 'paused', accumulatedActiveMs: 10000,
    activeStartedAt: null, pausedAt: 16000
  })
  assert.deepEqual(resumeFields(50000), {
    status: 'active', activeStartedAt: 50000, pausedAt: null
  })
  assert.equal(activeElapsedMs({
    status: 'active', accumulatedActiveMs: 10000, activeStartedAt: 50000
  }, 54000), 14000)
})

test('outcome receives active delta since the previous execution checkpoint', () => {
  assert.deepEqual(outcomeTiming({
    status: 'active', startTime: 1000,
    accumulatedActiveMs: 6000, activeStartedAt: 10000,
    checkpointElapsedMs: 7000
  }, [{ endTime: 9000 }], 15000), {
    startTime: 9000,
    endTime: 15000,
    rawDurationMs: 4000,
    activeElapsedMs: 11000,
    actualDuration: 1
  })
})

test('conclusion stores only elapsed time not allocated to executions', () => {
  assert.deepEqual(conclusionFields({
    status: 'paused', accumulatedActiveMs: 20000, activeStartedAt: null
  }, [
    { rawDurationMs: 7000 },
    { actualDuration: 0.1 }
  ], 50000), {
    status: 'completed', endTime: 50000, activeStartedAt: null,
    pausedAt: null, unassignedDurationMs: 7000
  })
})

test('legacy minutes establish the checkpoint without double allocation', () => {
  assert.deepEqual(normalizationFields({
    status: 'active', startTime: 1000
  }, [
    { endTime: 61000, actualDuration: 1 },
    { endTime: 121000, actualDuration: 1 }
  ], 181000), {
    accumulatedActiveMs: 0,
    activeStartedAt: 1000,
    checkpointElapsedMs: 120000
  })
})

test('newest unfinished session wins and older unfinished IDs are returned', () => {
  const result = chooseCurrentSession([
    { _id: 'old', status: 'active', startTime: 1000, _date_modified: 2000 },
    { _id: 'done', status: 'completed', startTime: 9000, _date_modified: 9000 },
    { _id: 'new', status: 'paused', startTime: 3000, _date_modified: 4000 }
  ])
  assert.equal(result.current._id, 'new')
  assert.deepEqual(result.interruptedIds, ['old'])
})

test('remaining budget uses elapsed clock time', () => {
  assert.equal(remainingBudgetMs({
    status: 'paused', timeBudgetMinutes: 1,
    accumulatedActiveMs: 25000, activeStartedAt: null
  }, 99999), 35000)
})
