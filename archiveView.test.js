// ABOUTME: Covers restore and permanent-delete sequencing for an archived chore.
// ABOUTME: Keeps a pending archive settled before anything is removed for good.

import test from 'node:test'
import assert from 'node:assert/strict'
import { restoredTaskStatus, runArchiveAction } from './archiveView.js'
import { archiveTaskOptimistically } from './tasksView.js'
import { createUndoQueue } from './undoToast.js'

const archivedTask = {
  _id: 'task-1',
  name: 'Clean attic',
  status: 'archived',
  categoryId: 'category-1',
  locationIds: ['location-1'],
  estimatedDuration: 10,
  scheduledDate: '2026-08-16',
  schedule: { type: 'one_off' }
}

test('restore status follows the normalized schedule type', () => {
  assert.equal(restoredTaskStatus({ schedule: { type: 'one_off' } }), 'active')
  assert.equal(restoredTaskStatus({ schedule: { type: 'periodic' } }), 'approved_recurring')
  assert.equal(restoredTaskStatus({ schedule: { type: 'fixed' } }), 'approved_recurring')
})

test('Restore settles a matching pending archive without a datastore write', async () => {
  const calls = []
  const result = await runArchiveAction({
    action: 'restore',
    task: archivedTask,
    undo: async key => { calls.push(['undo', key]); return { result: { restored: true } } },
    update: async (...args) => calls.push(['update', ...args]),
    refresh: async () => calls.push(['refresh'])
  })

  assert.deepEqual(calls, [['undo', 'task:task-1']])
  assert.deepEqual(result, { ok: true, pendingArchiveRestored: true })
})

test('Restore writes the inferred status only when no pending archive exists', async () => {
  const calls = []
  const result = await runArchiveAction({
    action: 'restore',
    task: { ...archivedTask, schedule: { type: 'fixed' } },
    undo: async key => { calls.push(['undo', key]); return null },
    update: async (...args) => calls.push(['update', ...args]),
    refresh: async () => calls.push(['refresh'])
  })

  assert.deepEqual(calls, [
    ['undo', 'task:task-1'],
    ['update', 'task-1', { status: 'approved_recurring' }],
    ['refresh']
  ])
  assert.deepEqual(result, { ok: true, pendingArchiveRestored: false })
})

test('Delete permanently settles the pending archive before it removes anything', async () => {
  const calls = []
  const result = await runArchiveAction({
    action: 'delete',
    task: archivedTask,
    commit: async key => calls.push(['commit', key]),
    remove: async id => calls.push(['delete', id]),
    refresh: async () => calls.push(['refresh'])
  })

  assert.deepEqual(calls, [
    ['commit', 'task:task-1'],
    ['delete', 'task-1'],
    ['refresh']
  ])
  assert.deepEqual(result, { ok: true, deleted: true })
})

test('a caught pending archive commit failure restores cache and aborts permanent deletion', async () => {
  const original = {
    ...archivedTask,
    status: 'active',
    nested: { value: ['preserved'] }
  }
  let cached = original
  let queuedAction
  let deleteCalls = 0
  let refreshCalls = 0
  archiveTaskOptimistically(original, {
    replace: replacement => { cached = replacement },
    clearEditing: () => {},
    render: () => {},
    queue: action => { queuedAction = action; return Promise.resolve(action) },
    update: async () => { throw new Error('archive write failed') },
    showFailure: () => {}
  })

  const result = await runArchiveAction({
    action: 'delete',
    task: cached,
    commit: async key => ({ action: queuedAction, result: await queuedAction.commit(key) }),
    remove: async () => { deleteCalls++ },
    refresh: async () => { refreshCalls++ }
  })

  assert.deepEqual(cached, original)
  assert.equal(deleteCalls, 0)
  assert.equal(refreshCalls, 0)
  assert.deepEqual(result, {
    ok: false,
    message: "Couldn't archive that. The chore is unchanged."
  })
})

function expiryArchiveHarness ({ update }) {
  let timerCallback
  const calls = []
  const queue = createUndoQueue({
    schedule: callback => { timerCallback = callback; return 1 },
    cancel: () => {}
  })
  const original = {
    ...archivedTask,
    status: 'active',
    nested: { exact: ['snapshot'] }
  }
  let cached = structuredClone(original)
  const queued = archiveTaskOptimistically(original, {
    replace: replacement => { cached = replacement },
    clearEditing: () => {},
    render: () => {},
    queue: queue.pendingUndo,
    update: async (...args) => {
      calls.push(['archive', ...args])
      return update(...args)
    },
    showFailure: message => calls.push(['failure', message]),
    pending: new Map()
  }).queued
  return {
    calls,
    original,
    cached: () => cached,
    queue,
    queued,
    fireExpiry: () => timerCallback()
  }
}

test('an archive that failed on expiry cannot authorize permanent deletion', async () => {
  const harness = expiryArchiveHarness({
    update: async () => { throw new Error('archive offline') }
  })
  await harness.queued
  let deleteCalls = 0
  let refreshCalls = 0

  await harness.fireExpiry()
  const result = await runArchiveAction({
    action: 'delete',
    task: harness.cached(),
    commit: harness.queue.commit,
    remove: async () => { deleteCalls++ },
    refresh: async () => { refreshCalls++ }
  })

  assert.deepEqual(harness.calls, [
    ['archive', 'task-1', { status: 'archived' }],
    ['failure', "Couldn't archive that. The chore is unchanged."]
  ])
  assert.deepEqual(harness.cached(), harness.original)
  assert.equal(deleteCalls, 0)
  assert.equal(refreshCalls, 0)
  assert.deepEqual(result, {
    ok: false,
    message: "Couldn't archive that. The chore is unchanged."
  })
})

test('an archive that succeeded on expiry permits exactly one permanent deletion', async () => {
  const harness = expiryArchiveHarness({ update: async () => ({ ok: true }) })
  await harness.queued
  let deleteCalls = 0
  let refreshCalls = 0

  await harness.fireExpiry()
  const result = await runArchiveAction({
    action: 'delete',
    task: harness.cached(),
    commit: harness.queue.commit,
    remove: async () => { deleteCalls++ },
    refresh: async () => { refreshCalls++ }
  })

  assert.deepEqual(harness.calls, [
    ['archive', 'task-1', { status: 'archived' }]
  ])
  assert.equal(harness.cached().status, 'archived')
  assert.equal(deleteCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.deepEqual(result, { ok: true, deleted: true })
})

test('archive action failures return factual inline messages without raw exceptions', async () => {
  const restore = await runArchiveAction({
    action: 'restore', task: archivedTask,
    undo: async () => null,
    update: async () => { throw new Error('raw restore error') },
    refresh: async () => {}
  })
  const deletion = await runArchiveAction({
    action: 'delete', task: archivedTask,
    commit: async () => null,
    remove: async () => { throw new Error('raw delete error') },
    refresh: async () => {}
  })

  assert.deepEqual(restore, {
    ok: false,
    message: "Couldn't restore that. The chore is unchanged."
  })
  assert.deepEqual(deletion, {
    ok: false,
    message: "Couldn't delete that. The chore is still in Archive."
  })
})
