// ABOUTME: Covers archived chore presentation and restore/delete action sequencing.
// ABOUTME: Keeps permanent deletion behind an explicit accessible-sheet decision.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  archivedTaskCardHtml,
  restoredTaskStatus,
  renderArchiveView,
  runArchiveAction
} from './archiveView.js'
import { archiveTaskOptimistically } from './tasksView.js'

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

test('archived card safely names the chore, references, state, and permanent controls', () => {
  const markup = archivedTaskCardHtml({
    ...archivedTask,
    _id: 'task-1" autofocus="',
    name: '<img src=x onerror=alert(1)>'
  }, {
    categories: [{ _id: 'category-1', name: '<Category>', status: 'active' }],
    locations: [{ _id: 'location-1', name: 'Attic & loft', status: 'archived' }]
  })

  assert.match(markup, /data-id="task-1&quot; autofocus=&quot;"/)
  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /&lt;img src=x onerror=alert\(<span class="fig">1<\/span>\)&gt;/)
  assert.match(markup, /&lt;Category&gt;/)
  assert.match(markup, /Attic &amp; loft/)
  assert.match(markup, /class="state-badge stamp">Archived</)
  assert.match(markup, /data-action="restore"[^>]*>Restore</)
  assert.match(markup, /data-action="delete"[^>]*>Delete permanently</)
})

test('restore status follows the normalized schedule type', () => {
  assert.equal(restoredTaskStatus({ schedule: { type: 'one_off' } }), 'active')
  assert.equal(restoredTaskStatus({ schedule: { type: 'periodic' } }), 'approved_recurring')
  assert.equal(restoredTaskStatus({ schedule: { type: 'fixed' } }), 'approved_recurring')
})

test('archive renderer owns archived cards and the navigation count', () => {
  const originalDocument = globalThis.document
  const cards = { innerHTML: '' }
  const count = { textContent: '' }
  globalThis.document = {
    getElementById: id => ({ archivedCards: cards, archiveNavCount: count })[id]
  }
  try {
    renderArchiveView([
      archivedTask,
      { ...archivedTask, _id: 'active', name: 'Active', status: 'active' }
    ], { categories: [], locations: [] })
    assert.equal(count.textContent, 1)
    assert.match(cards.innerHTML, /Clean attic/)
    assert.doesNotMatch(cards.innerHTML, /data-id="active"/)
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
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

test('Delete permanently is sequenced after the sheet and pending commit', async () => {
  const calls = []
  const result = await runArchiveAction({
    action: 'delete',
    task: archivedTask,
    confirmDelete: async options => {
      calls.push(['sheet', options.title, options.message, options.actions.map(action => action.value)])
      return 'delete'
    },
    commit: async key => calls.push(['commit', key]),
    remove: async id => calls.push(['delete', id]),
    refresh: async () => calls.push(['refresh'])
  })

  assert.deepEqual(calls, [
    ['sheet', 'Delete chore permanently?', 'Clean attic will be removed permanently.', ['keep', 'delete']],
    ['commit', 'task:task-1'],
    ['delete', 'task-1'],
    ['refresh']
  ])
  assert.deepEqual(result, { ok: true, deleted: true })
})

test('Keep dismisses permanent deletion without a write', async () => {
  const calls = []
  const result = await runArchiveAction({
    action: 'delete',
    task: archivedTask,
    confirmDelete: async () => 'keep',
    commit: async () => calls.push('commit'),
    remove: async () => calls.push('delete'),
    refresh: async () => calls.push('refresh')
  })

  assert.deepEqual(calls, [])
  assert.deepEqual(result, { ok: true, deleted: false })
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
    confirmDelete: async () => 'delete',
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

test('archive action failures return factual inline messages without raw exceptions', async () => {
  const restore = await runArchiveAction({
    action: 'restore', task: archivedTask,
    undo: async () => null,
    update: async () => { throw new Error('raw restore error') },
    refresh: async () => {}
  })
  const deletion = await runArchiveAction({
    action: 'delete', task: archivedTask,
    confirmDelete: async () => 'delete',
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
