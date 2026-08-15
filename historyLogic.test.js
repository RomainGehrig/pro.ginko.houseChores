// ABOUTME: Unit tests for the pure history join/summarise logic.
// ABOUTME: Run with: node --test historyLogic.test.js

import { test } from 'node:test'
import assert from 'node:assert'
import { buildHistory, displayMinutes } from './historyLogic.js'

const tasks = [
  { _id: 't1', name: 'Pay electricity bill', estimatedDuration: 10 },
  { _id: 't2', name: 'File tax receipts', estimatedDuration: 25 }
]

test('sorts sessions newest first, missing startTime last', () => {
  const sessions = [
    { _id: 's1', startTime: 1000, status: 'completed' },
    { _id: 's2', startTime: 3000, status: 'completed' },
    { _id: 's3', startTime: null, status: 'completed' },
    { _id: 's4', startTime: 2000, status: 'completed' }
  ]
  const result = buildHistory(sessions, [], tasks)
  assert.deepEqual(result.map(s => s.id), ['s2', 's4', 's1', 's3'])
})

test('counts outcomes and totals actual minutes including cancelled', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const executions = [
    { _id: 'e1', sessionId: 's1', taskId: 't1', startTime: 1000, actualDuration: 12, outcome: 'done' },
    { _id: 'e2', sessionId: 's1', taskId: 't2', startTime: 2000, actualDuration: 2, outcome: 'cancelled' }
  ]
  const [summary] = buildHistory(sessions, executions, tasks)
  assert.equal(summary.taskCount, 2)
  assert.deepEqual(summary.outcomeCounts, { done: 1, already_done: 0, cancelled: 1 })
  assert.equal(summary.totalActualMinutes, 14)
})

test('history distinguishes resumable, completed, and interrupted sessions', () => {
  const result = buildHistory([
    { _id: 'active', startTime: 4000, status: 'active' },
    { _id: 'paused', startTime: 3000, status: 'paused' },
    { _id: 'interrupted', startTime: 2000, status: 'interrupted' },
    { _id: 'completed', startTime: 1000, status: 'completed' }
  ], [], tasks)
  assert.deepEqual(result.map(row => [row.id, row.statusLabel]), [
    ['active', 'in progress'],
    ['paused', 'paused'],
    ['interrupted', 'interrupted'],
    ['completed', null]
  ])
})

test('history preserves raw millisecond precision and falls back to legacy minutes', () => {
  const [summary] = buildHistory([{ _id: 's1', status: 'completed' }], [
    { sessionId: 's1', taskId: 't1', rawDurationMs: 90000, actualDuration: 99, outcome: 'done' },
    { sessionId: 's1', taskId: 't2', actualDuration: 2, outcome: 'cancelled' },
    { sessionId: 's1', taskId: 't1', rawDurationMs: 0, actualDuration: 99, outcome: 'done' }
  ], tasks)
  assert.deepEqual(summary.entries.map(entry => entry.actualDuration), [1.5, 2, 0])
  assert.equal(summary.totalActualMinutes, 3.5)
})

test('history treats blank raw milliseconds as missing legacy data', () => {
  const [summary] = buildHistory([{ _id: 's1', status: 'completed' }], [
    { sessionId: 's1', taskId: 't1', rawDurationMs: null, actualDuration: 12, outcome: 'done' },
    { sessionId: 's1', taskId: 't2', rawDurationMs: '', actualDuration: 7, outcome: 'cancelled' }
  ], tasks)

  assert.deepEqual(summary.entries.map(entry => entry.actualDuration), [12, 7])
  assert.equal(summary.totalActualMinutes, 19)
})

test('a session with no executions has zero tasks and no entries', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const [summary] = buildHistory(sessions, [], tasks)
  assert.equal(summary.taskCount, 0)
  assert.deepEqual(summary.entries, [])
  assert.equal(summary.totalActualMinutes, 0)
})

test('an execution with an unknown taskId renders as Unknown task', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const executions = [
    { _id: 'e1', sessionId: 's1', taskId: 'gone', startTime: 1000, actualDuration: 5, outcome: 'done' }
  ]
  const [summary] = buildHistory(sessions, executions, tasks)
  assert.equal(summary.entries[0].taskName, 'Unknown task')
})

test('entries within a session are ordered by startTime ascending', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const executions = [
    { _id: 'e2', sessionId: 's1', taskId: 't2', startTime: 5000, actualDuration: 3, outcome: 'done' },
    { _id: 'e1', sessionId: 's1', taskId: 't1', startTime: 2000, actualDuration: 4, outcome: 'done' }
  ]
  const [summary] = buildHistory(sessions, executions, tasks)
  assert.deepEqual(summary.entries.map(e => e.taskName), ['Pay electricity bill', 'File tax receipts'])
})

test('executions are matched to their own session only', () => {
  const sessions = [
    { _id: 's1', startTime: 2000, status: 'completed' },
    { _id: 's2', startTime: 1000, status: 'completed' }
  ]
  const executions = [
    { _id: 'e1', sessionId: 's1', taskId: 't1', startTime: 2000, actualDuration: 4, outcome: 'done' },
    { _id: 'e2', sessionId: 's2', taskId: 't2', startTime: 1000, actualDuration: 6, outcome: 'done' }
  ]
  const result = buildHistory(sessions, executions, tasks)
  assert.deepEqual(result.find(s => s.id === 's1').entries.map(e => e.taskName), ['Pay electricity bill'])
  assert.deepEqual(result.find(s => s.id === 's2').entries.map(e => e.taskName), ['File tax receipts'])
})

test('a session reports the clock its budget was measured against', () => {
  const [ran] = buildHistory([{
    _id: 's1', status: 'completed', startTime: 1000, endTime: 900000,
    accumulatedActiveMs: 26 * 60000, activeStartedAt: null
  }], [
    { sessionId: 's1', taskId: 't1', rawDurationMs: 14 * 60000, outcome: 'done' }
  ], tasks)
  assert.equal(ran.activeMinutes, 26)

  const [running] = buildHistory([{
    _id: 's2', status: 'active', startTime: 1000, endTime: null,
    accumulatedActiveMs: 5 * 60000, activeStartedAt: 2000
  }], [], tasks)
  assert.equal(running.activeMinutes, 5)
})

test('a session written before the app kept its own clock reports what the chores recorded', () => {
  const [summary] = buildHistory([{ _id: 's1', status: 'completed', accumulatedActiveMs: null }], [
    { sessionId: 's1', taskId: 't1', actualDuration: 12, outcome: 'done' },
    { sessionId: 's1', taskId: 't2', actualDuration: 7, outcome: 'cancelled' }
  ], tasks)
  assert.equal(summary.activeMinutes, 19)
})

test('an entry carries the estimate its chore now holds, so drift has something to read', () => {
  const [summary] = buildHistory([{ _id: 's1', status: 'completed' }], [
    { sessionId: 's1', taskId: 't1', startTime: 1, actualDuration: 14, outcome: 'done' },
    { sessionId: 's1', taskId: 'gone', startTime: 2, actualDuration: 3, outcome: 'done' }
  ], tasks)
  assert.deepEqual(summary.entries.map(entry => entry.estimatedDuration), [10, null])
})

test('measured minutes are shown whole, and any time at all counts as a minute', () => {
  assert.equal(displayMinutes(10.951499999), 11)
  assert.equal(displayMinutes(0.0917166), 1)
  assert.equal(displayMinutes(0), 0)
  assert.equal(displayMinutes(null), 0)
  assert.equal(displayMinutes(1.5), 2)
})
