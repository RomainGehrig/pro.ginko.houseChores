// ABOUTME: Unit tests for doing-mode completion and end-session orchestration.
// ABOUTME: Protects retry state and forward progress across optional UI failures.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  continueAfterCompletion,
  endDoingSession,
  retryCompletionForStage
} from './doingCompletionLogic.js'

test('advances and renders once when filler refresh fails', async () => {
  const calls = []
  const fillerError = new Error('tasks offline')

  await continueAfterCompletion({
    offerFiller: async () => {
      calls.push('filler')
      throw fillerError
    },
    reportFillerFailure: error => calls.push(error),
    advanceBundle: () => calls.push('advance'),
    renderNextTask: () => calls.push('render')
  })

  assert.deepEqual(calls, ['filler', fillerError, 'advance', 'render'])
})

test('dispatches retries only to the failed persistence stage', async () => {
  const calls = []
  const executionResult = { ok: false, stage: 'execution' }
  const taskResult = { ok: true, stage: null }
  const retries = {
    retryExecution: async () => {
      calls.push('execution')
      return executionResult
    },
    retryTaskUpdate: async () => {
      calls.push('task_update')
      return taskResult
    }
  }

  assert.equal(await retryCompletionForStage('execution', retries), executionResult)
  assert.equal(await retryCompletionForStage('task_update', retries), taskResult)
  assert.deepEqual(calls, ['execution', 'task_update'])
})

test('declining pending-update discard leaves the session and retry state untouched', async () => {
  const calls = []
  const ended = await endDoingSession({
    hasPendingTaskUpdate: () => true,
    confirmDiscard: () => false,
    saveSession: async () => calls.push('save'),
    discardPendingTaskUpdate: () => calls.push('discard'),
    clearPendingContinuation: () => calls.push('clear'),
    showReview: async () => calls.push('review')
  })

  assert.equal(ended, false)
  assert.deepEqual(calls, [])
})

test('failed session persistence retains the confirmed pending update for retry', async () => {
  const calls = []
  let controlsDisabled = false

  await assert.rejects(endDoingSession({
    hasPendingTaskUpdate: () => true,
    confirmDiscard: () => {
      calls.push('confirm')
      return true
    },
    saveSession: async () => {
      calls.push('save')
      throw new Error('session offline')
    },
    setCompletionControlsDisabled: disabled => {
      controlsDisabled = disabled
      calls.push('controls:' + disabled)
    },
    discardPendingTaskUpdate: () => calls.push('discard'),
    clearPendingContinuation: () => calls.push('clear'),
    showReview: async () => calls.push('review')
  }), /session offline/)

  assert.equal(controlsDisabled, false)
  assert.deepEqual(calls, ['confirm', 'controls:true', 'save', 'controls:false'])

  await retryCompletionForStage('task_update', {
    actionsBlocked: () => controlsDisabled,
    retryExecution: async () => calls.push('execution'),
    retryTaskUpdate: async () => calls.push('task_update')
  })
  assert.equal(calls.at(-1), 'task_update')
})

test('blocks completion retry while confirmed session persistence is pending', async () => {
  const calls = []
  let controlsDisabled = false
  let finishSave
  const savePending = new Promise(resolve => { finishSave = resolve })

  const endOptions = {
    actionsBlocked: () => controlsDisabled,
    hasPendingTaskUpdate: () => true,
    confirmDiscard: () => true,
    saveSession: async () => {
      calls.push('save')
      await savePending
    },
    setCompletionControlsDisabled: disabled => { controlsDisabled = disabled },
    discardPendingTaskUpdate: () => calls.push('discard'),
    clearPendingContinuation: () => calls.push('clear'),
    showReview: async () => calls.push('review')
  }
  const ending = endDoingSession(endOptions)
  await Promise.resolve()
  const duplicateEnding = endDoingSession(endOptions)

  const retryResult = await retryCompletionForStage('task_update', {
    actionsBlocked: () => controlsDisabled,
    retryExecution: async () => calls.push('execution'),
    retryTaskUpdate: async () => calls.push('task_update')
  })

  assert.equal(controlsDisabled, true)
  assert.equal(retryResult, null)
  assert.deepEqual(calls, ['save'])

  finishSave()
  await ending
  assert.equal(await duplicateEnding, false)
  assert.deepEqual(calls, ['save', 'discard', 'clear', 'review'])
})

test('confirmed discard happens only after session persistence succeeds', async () => {
  const calls = []
  const ended = await endDoingSession({
    hasPendingTaskUpdate: () => true,
    confirmDiscard: () => {
      calls.push('confirm')
      return true
    },
    saveSession: async () => calls.push('save'),
    setCompletionControlsDisabled: disabled => calls.push('controls:' + disabled),
    discardPendingTaskUpdate: () => calls.push('discard'),
    clearPendingContinuation: () => calls.push('clear'),
    showReview: async () => calls.push('review')
  })

  assert.equal(ended, true)
  assert.deepEqual(calls, ['confirm', 'controls:true', 'save', 'discard', 'clear', 'review', 'controls:false'])
})
