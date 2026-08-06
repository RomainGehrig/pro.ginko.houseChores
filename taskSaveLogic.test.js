// ABOUTME: Unit tests for task write and post-write refresh error boundaries.
// ABOUTME: Run with: node --test taskSaveLogic.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import { saveTaskWithRefresh } from './taskSaveLogic.js'

test('reports a task write failure without attempting refresh', async () => {
  let refreshed = false
  const result = await saveTaskWithRefresh(
    async () => { throw new Error('write offline') },
    async () => { refreshed = true }
  )

  assert.deepEqual(result, {
    ok: false,
    stage: 'write',
    message: 'Could not save task: write offline'
  })
  assert.equal(refreshed, false)
})

test('reports a post-write refresh failure as a confirmed save', async () => {
  const result = await saveTaskWithRefresh(
    async () => {},
    async () => { throw new Error('task list offline') }
  )

  assert.deepEqual(result, {
    ok: false,
    stage: 'refresh',
    message: 'Task saved, but could not refresh tasks: task list offline'
  })
})

test('reports success only after write and refresh both finish', async () => {
  assert.deepEqual(
    await saveTaskWithRefresh(async () => {}, async () => {}),
    { ok: true, stage: null, message: '' }
  )
})
