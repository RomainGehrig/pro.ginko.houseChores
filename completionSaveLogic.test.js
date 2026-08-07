// ABOUTME: Unit tests for the completion write boundary and its retry state.
// ABOUTME: Ensures schedule retries never duplicate recorded execution history.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompletionCoordinator } from './completionSaveLogic.js'

test('does not update a task when execution creation fails', async () => {
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { throw new Error('history offline') },
    updateTask: async () => { taskWrites += 1 }
  })
  const result = await coordinator.complete({
    execution: { taskId: 't1' },
    taskId: 't1',
    taskUpdate: { scheduledDate: '2026-08-21' }
  })
  assert.deepEqual(result, {
    ok: false,
    stage: 'execution',
    message: 'Could not record completion: history offline',
    canRetry: true
  })
  assert.equal(taskWrites, 0)
  assert.equal(coordinator.hasPendingTaskUpdate(), false)
})

test('retries only the task update after execution is recorded', async () => {
  let executionWrites = 0
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { executionWrites += 1 },
    updateTask: async () => {
      taskWrites += 1
      if (taskWrites === 1) throw new Error('task offline')
    }
  })
  const first = await coordinator.complete({
    execution: { taskId: 't1' },
    taskId: 't1',
    taskUpdate: { scheduledDate: '2026-08-21' }
  })
  assert.deepEqual(first, {
    ok: false,
    stage: 'task_update',
    message: 'Completion recorded, schedule not updated: task offline',
    canRetry: true
  })
  assert.equal((await coordinator.retryTaskUpdate()).ok, true)
  assert.equal(executionWrites, 1)
  assert.equal(taskWrites, 2)
  assert.equal(coordinator.hasPendingTaskUpdate(), false)
})

test('refuses a second completion while a task update is pending', async () => {
  let executionWrites = 0
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { executionWrites += 1 },
    updateTask: async () => {
      taskWrites += 1
      throw new Error('task offline')
    }
  })

  await coordinator.complete({
    execution: { taskId: 't1' },
    taskId: 't1',
    taskUpdate: { scheduledDate: '2026-08-21' }
  })
  const second = await coordinator.complete({
    execution: { taskId: 't2' },
    taskId: 't2',
    taskUpdate: { scheduledDate: '2026-08-22' }
  })

  assert.deepEqual(second, {
    ok: false,
    stage: 'task_update',
    message: 'Completion recorded, schedule not updated: task update already pending',
    canRetry: true
  })
  assert.equal(executionWrites, 1)
  assert.equal(taskWrites, 1)
})

test('retains a failed task update until it is explicitly discarded', async () => {
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => {},
    updateTask: async () => {
      taskWrites += 1
      throw new Error('task offline')
    }
  })

  await coordinator.complete({
    execution: { taskId: 't1' },
    taskId: 't1',
    taskUpdate: { scheduledDate: '2026-08-21' }
  })
  const retry = await coordinator.retryTaskUpdate()

  assert.equal(retry.stage, 'task_update')
  assert.equal(taskWrites, 2)
  assert.equal(coordinator.hasPendingTaskUpdate(), true)
  coordinator.discardPendingTaskUpdate()
  assert.equal(coordinator.hasPendingTaskUpdate(), false)
  assert.equal((await coordinator.retryTaskUpdate()).ok, true)
  assert.equal(taskWrites, 2)
})

test('records outcomes without a task update as a successful completion', async () => {
  let executionWrites = 0
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { executionWrites += 1 },
    updateTask: async () => { taskWrites += 1 }
  })

  const result = await coordinator.complete({
    execution: { taskId: 't1', outcome: 'cancelled' },
    taskId: 't1',
    taskUpdate: null
  })

  assert.deepEqual(result, {
    ok: true,
    stage: null,
    message: '',
    canRetry: false
  })
  assert.equal(executionWrites, 1)
  assert.equal(taskWrites, 0)
})

test('reuses one completion-attempt id when the execution commits before its response is lost', async () => {
  const executions = new Map()
  const attemptedIds = []
  let loseFirstResponse = true
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createAttemptId: () => 'completion-attempt-1',
    createExecution: async execution => {
      attemptedIds.push(execution.completionAttemptId)
      executions.set(execution.completionAttemptId, structuredClone(execution))
      if (loseFirstResponse) {
        loseFirstResponse = false
        throw new Error('response lost')
      }
    },
    updateTask: async () => { taskWrites++ }
  })

  const first = await coordinator.complete({
    execution: { taskId: 'task-1', outcome: 'done' },
    taskId: 'task-1',
    taskUpdate: { status: 'archived' }
  })
  const retry = await coordinator.retryExecution()

  assert.equal(first.stage, 'execution')
  assert.equal(retry.ok, true)
  assert.deepEqual(attemptedIds, ['completion-attempt-1', 'completion-attempt-1'])
  assert.equal(executions.size, 1)
  assert.equal(taskWrites, 1)
  assert.equal(coordinator.hasPendingExecution(), false)
})

test('writes execution then task then session checkpoint', async () => {
  const calls = []
  const coordinator = createCompletionCoordinator({
    createExecution: async execution => calls.push(['execution', execution.completionAttemptId]),
    updateTask: async (id, fields) => calls.push(['task', id, fields]),
    updateSession: async (id, fields) => calls.push(['session', id, fields])
  })
  const result = await coordinator.complete({
    execution: { taskId: 't1', sessionId: 's1', completionAttemptId: 'session-task-s1-t1' },
    taskId: 't1', taskUpdate: { scheduledDate: '2026-08-21' },
    sessionId: 's1', sessionUpdate: { checkpointElapsedMs: 12000 }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [
    ['execution', 'session-task-s1-t1'],
    ['task', 't1', { scheduledDate: '2026-08-21' }],
    ['session', 's1', { checkpointElapsedMs: 12000 }]
  ])
})

test('retries only session checkpoint after earlier stages succeeded', async () => {
  let executionWrites = 0
  let taskWrites = 0
  let sessionWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { executionWrites++ },
    updateTask: async () => { taskWrites++ },
    updateSession: async () => {
      sessionWrites++
      if (sessionWrites === 1) throw new Error('session offline')
    }
  })
  const first = await coordinator.complete({
    execution: { taskId: 't1', sessionId: 's1' },
    taskId: 't1', taskUpdate: { status: 'archived' },
    sessionId: 's1', sessionUpdate: { checkpointElapsedMs: 8000 }
  })
  assert.equal(first.stage, 'session_update')
  assert.equal((await coordinator.retrySessionUpdate()).ok, true)
  assert.deepEqual({ executionWrites, taskWrites, sessionWrites }, {
    executionWrites: 1, taskWrites: 1, sessionWrites: 2
  })
})

test('cancelled skips task update but advances the checkpoint', async () => {
  const calls = []
  const coordinator = createCompletionCoordinator({
    createExecution: async () => calls.push('execution'),
    updateTask: async () => calls.push('task'),
    updateSession: async () => calls.push('session')
  })
  const result = await coordinator.complete({
    execution: { taskId: 't1', sessionId: 's1', outcome: 'cancelled' },
    taskId: 't1', taskUpdate: null,
    sessionId: 's1', sessionUpdate: { checkpointElapsedMs: 3000 }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['execution', 'session'])
})
