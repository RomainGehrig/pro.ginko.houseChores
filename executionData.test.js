// ABOUTME: Tests the task-execution persistence boundary.
// ABOUTME: Verifies completion-attempt IDs become datastore upsert identities.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createExecution } from './executionData.js'

test('repeated creates with one completion-attempt id upsert one execution record', async () => {
  const originalFreezr = globalThis.freezr
  const executions = new Map()
  let generatedId = 0
  globalThis.freezr = {
    create: async (collection, data, options = {}) => {
      const id = options.upsert && options.data_object_id
        ? options.data_object_id
        : 'generated-' + ++generatedId
      executions.set(id, { _id: id, ...structuredClone(data) })
      return executions.get(id)
    }
  }

  try {
    const execution = {
      taskId: 'task-1',
      outcome: 'done',
      completionAttemptId: 'completion-attempt-1'
    }
    await createExecution(execution)
    await createExecution(execution)

    assert.equal(executions.size, 1)
    assert.equal(executions.get('completion-attempt-1').taskId, 'task-1')
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})
