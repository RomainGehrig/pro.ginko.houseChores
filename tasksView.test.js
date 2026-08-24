import test from 'node:test'
import assert from 'node:assert/strict'
import * as tasksView from './tasksView.js'
import {
  archiveTaskOptimistically,
  buildActiveTaskScheduleFields,
  buildApprovedTaskFields,
  buildTaskReferenceFields
} from './tasksView.js'
import { LEGACY_CATEGORY_SELECTION } from './categoryLocationLogic.js'
import { sessionPicks } from './sessionPicks.js'

test('approval writes the reviewed schedule and clears AI suggestions', () => {
  assert.deepEqual(buildApprovedTaskFields({}, {
    categoryId: 'c1', category: 'Clean', locationIds: ['l1']
  }, 15, {
    ok: true,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  }), {
    categoryId: 'c1', category: 'Clean', locationIds: ['l1'],
    estimatedDuration: 15,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' },
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null,
    status: 'approved_recurring'
  })
})

test('active schedule edits preserve the current date unless explicitly changed', () => {
  const task = {
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  }
  assert.deepEqual(buildActiveTaskScheduleFields(task, {
    ok: true,
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] } }
  }), {
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] } },
    status: 'approved_recurring'
  })
})

test('outside completion advances the chore and removes it from the pending session', async () => {
  const nowMs = new Date(2026, 7, 23, 12, 0, 0).getTime()
  const writes = []
  const order = []
  sessionPicks.reset()
  sessionPicks.set(['task-1', 'task-2'])

  const result = await tasksView.markChoreRecentlyDone({
    _id: 'task-1',
    status: 'approved_recurring',
    scheduledDate: '2026-08-20',
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, {
    nowMs,
    update: async (...args) => { order.push('write'); writes.push(args) },
    refresh: async () => { order.push('refresh') }
  })

  assert.deepEqual(writes, [[
    'task-1',
    { lastCompletedDate: nowMs, scheduledDate: '2026-08-30' }
  ]])
  assert.deepEqual(order, ['write', 'refresh'])
  assert.deepEqual(sessionPicks.getPickedIds(), ['task-2'])
  assert.deepEqual(result, { ok: true, stage: null, message: '' })
  sessionPicks.reset()
})

test('a recorded completion leaves the pending session even when refresh fails', async () => {
  sessionPicks.reset()
  sessionPicks.set(['task-1', 'task-2'])

  const result = await tasksView.markChoreRecentlyDone({
    _id: 'task-1', schedule: { type: 'one_off' }
  }, {
    nowMs: new Date(2026, 7, 23, 12, 0, 0).getTime(),
    update: async () => {},
    refresh: async () => { throw new Error('refresh offline') }
  })

  assert.deepEqual(result, {
    ok: false,
    stage: 'refresh',
    message: 'Task saved, but could not refresh tasks: refresh offline'
  })
  assert.deepEqual(sessionPicks.getPickedIds(), ['task-2'])
  sessionPicks.reset()
})

test('a completion write failure keeps the pending chore and skips refresh', async () => {
  let refreshed = false
  sessionPicks.reset()
  sessionPicks.set(['task-1', 'task-2'])

  const result = await tasksView.markChoreRecentlyDone({
    _id: 'task-1', schedule: { type: 'one_off' }
  }, {
    nowMs: new Date(2026, 7, 23, 12, 0, 0).getTime(),
    update: async () => { throw new Error('write offline') },
    refresh: async () => { refreshed = true }
  })

  assert.deepEqual(result, {
    ok: false,
    stage: 'write',
    message: 'Could not save task: write offline'
  })
  assert.equal(refreshed, false)
  assert.deepEqual(sessionPicks.getPickedIds(), ['task-1', 'task-2'])
  sessionPicks.reset()
})

test('an unrelated task edit omits a legacy-only category while references are unavailable', () => {
  const fields = buildTaskReferenceFields({
    category: 'Legacy garden',
    categoryId: null,
    locationIds: ['missing-location']
  }, LEGACY_CATEGORY_SELECTION, ['missing-location'], {
    categories: [],
    locations: [],
    readiness: { categories: false, locations: false }
  })

  assert.deepEqual(fields, { locationIds: ['missing-location'] })
  assert.equal(Object.hasOwn(fields, 'category'), false)
  assert.equal(Object.hasOwn(fields, 'categoryId'), false)
})

test('active archive is optimistic and its queued commit writes only status', async () => {
  const original = {
    _id: 'task-archive', name: 'Clean attic', status: 'active',
    schedule: { type: 'one_off' }, metadata: { keep: true }
  }
  const replacements = []
  const rendered = []
  const queued = []
  const updates = []
  let editingCleared = 0

  const result = archiveTaskOptimistically(original, {
    replace: task => replacements.push(structuredClone(task)),
    clearEditing: () => { editingCleared++ },
    render: () => rendered.push('render'),
    queue: (action, ttl) => { queued.push({ action, ttl }); return Promise.resolve(action) },
    update: async (...args) => updates.push(args),
    showFailure: () => assert.fail('commit should not fail')
  })

  assert.equal(replacements[0].status, 'archived')
  assert.equal(editingCleared, 1)
  assert.deepEqual(rendered, ['render'])
  assert.equal(queued[0].ttl, 6000)
  assert.equal(queued[0].action.key, 'task:task-archive')
  assert.equal(queued[0].action.label, 'Archived')
  assert.deepEqual(updates, [])

  await queued[0].action.commit()
  assert.deepEqual(updates, [['task-archive', { status: 'archived' }]])
  assert.equal(await result.queued, queued[0].action)
})

test('an overlay-aware cache refresh keeps a pending archive out of active chores', async () => {
  const active = {
    _id: 'pending-archive', name: 'Clean loft', status: 'active',
    schedule: { type: 'one_off' }
  }
  const pending = new Map([['task:pending-archive', {
    archived: { ...active, status: 'archived' }
  }]])

  assert.equal(typeof tasksView.refreshTaskCache, 'function')
  const refreshed = await tasksView.refreshTaskCache({
    readTasks: async () => [{ ...active, serverVersion: 'still-active' }],
    pendingArchives: pending
  })

  assert.deepEqual(refreshed, [])
})

test('failed archive commit restores the exact cached record and reports factual status', async () => {
  const original = {
    _id: 'task-failure', name: 'Sweep cellar', status: 'approved_recurring',
    schedule: { type: 'periodic', every: 2, unit: 'week' }, nested: { value: ['kept'] }
  }
  const replacements = []
  const messages = []
  let queuedAction

  archiveTaskOptimistically(original, {
    replace: task => replacements.push(task),
    clearEditing: () => {},
    render: () => {},
    queue: action => { queuedAction = action; return Promise.resolve(action) },
    update: async () => { throw new Error('raw datastore failure') },
    showFailure: message => messages.push(message)
  })
  original.nested.value.push('later mutation')

  const commitResult = await queuedAction.commit()

  assert.deepEqual(replacements.at(-1), {
    _id: 'task-failure', name: 'Sweep cellar', status: 'approved_recurring',
    schedule: { type: 'periodic', every: 2, unit: 'week' }, nested: { value: ['kept'] }
  })
  assert.deepEqual(messages, ["Couldn't archive that. The chore is unchanged."])
  assert.deepEqual(commitResult, {
    ok: false,
    message: "Couldn't archive that. The chore is unchanged."
  })
  assert.deepEqual(await queuedAction.revert(), {
    taskId: 'task-failure',
    status: 'approved_recurring'
  })
})

function archiveRefreshHarness (original, update) {
  let cache = [structuredClone(original)]
  let queuedAction
  const pending = new Map()
  const renderSnapshots = []
  const messages = []
  archiveTaskOptimistically(original, {
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    clearEditing: () => {},
    render: () => renderSnapshots.push(structuredClone(cache)),
    queue: action => { queuedAction = action; return Promise.resolve(action) },
    update,
    showFailure: message => messages.push(message),
    pending
  })
  return {
    pending,
    queuedAction: () => queuedAction,
    refresh: fetched => {
      cache = tasksView.overlayPendingTaskArchives(fetched, pending)
      renderSnapshots.push(structuredClone(cache))
    },
    cache: () => cache,
    renderSnapshots,
    messages
  }
}

test('refresh during archive expiry keeps the optimistic overlay through successful settlement', async () => {
  const original = {
    _id: 'refresh-success', name: 'Clean pantry', status: 'active',
    nested: { order: ['exact', 'snapshot'] }
  }
  const harness = archiveRefreshHarness(original, async () => ({ _id: original._id }))

  assert.equal(harness.pending.size, 1)
  harness.refresh([{ ...structuredClone(original), serverVersion: 'still-active' }])
  assert.deepEqual(harness.cache(), [{ ...original, status: 'archived' }])

  assert.deepEqual(await harness.queuedAction().commit(), {
    ok: true,
    value: { _id: original._id }
  })
  assert.equal(harness.pending.size, 0)
  assert.deepEqual(harness.cache(), [{ ...original, status: 'archived' }])
})

test('refresh during archive expiry restores the exact original after failed settlement', async () => {
  const original = {
    _id: 'refresh-failure', name: 'Clean shed', status: 'approved_recurring',
    schedule: { type: 'periodic', every: 3, unit: 'week' }, nested: { keep: ['all'] }
  }
  const harness = archiveRefreshHarness(original, async () => { throw new Error('offline') })

  assert.equal(harness.pending.size, 1)
  harness.refresh([{ ...structuredClone(original), status: 'active', serverVersion: 'stale' }])
  assert.equal(harness.cache()[0].status, 'archived')

  assert.deepEqual(await harness.queuedAction().commit(), {
    ok: false,
    message: "Couldn't archive that. The chore is unchanged."
  })
  assert.equal(harness.pending.size, 0)
  assert.deepEqual(harness.cache(), [original])
  assert.deepEqual(harness.messages, ["Couldn't archive that. The chore is unchanged."])
})

test('refresh during the undo window restores the exact original on Undo', async () => {
  const original = {
    _id: 'refresh-undo', name: 'Clean balcony', status: 'active',
    metadata: { locations: ['outside'] }
  }
  const harness = archiveRefreshHarness(original, async () => assert.fail('Undo must not commit'))

  assert.equal(harness.pending.size, 1)
  harness.refresh([{ ...structuredClone(original), serverVersion: 'still-active' }])
  assert.equal(harness.cache()[0].status, 'archived')

  assert.deepEqual(await harness.queuedAction().revert(), {
    taskId: original._id,
    status: 'active'
  })
  assert.equal(harness.pending.size, 0)
  assert.deepEqual(harness.cache(), [original])
})

test('Inbox stays discoverable while only its zero count hides across render transitions', () => {
  const count = { hidden: false, textContent: '' }
  const labels = []
  const inbox = {
    hidden: true,
    querySelector: selector => selector === '.nav-count' ? count : null,
    setAttribute: (name, value) => labels.push([name, value])
  }

  assert.equal(typeof tasksView.renderInboxNavigation, 'function')
  tasksView.renderInboxNavigation(0, inbox)
  assert.equal(inbox.hidden, false)
  assert.equal(count.hidden, true)
  assert.equal(count.textContent, 0)
  assert.deepEqual(labels.at(-1), ['aria-label', 'Capture, no chores to confirm'])

  tasksView.renderInboxNavigation(1, inbox)
  assert.equal(inbox.hidden, false)
  assert.equal(count.hidden, false)
  assert.equal(count.textContent, 1)
  assert.deepEqual(labels.at(-1), ['aria-label', 'Capture, 1 to confirm'])

  tasksView.renderInboxNavigation(4, inbox)
  assert.equal(count.hidden, false)
  assert.equal(count.textContent, 4)
  assert.deepEqual(labels.at(-1), ['aria-label', 'Capture, 4 to confirm'])
})

test('the inbox and chores eyebrows count without judging', () => {
  assert.equal(tasksView.buildInboxCountLine(0), 'Capture · clear')
  assert.equal(tasksView.buildInboxCountLine(1), 'Capture · 1 waiting')
  assert.equal(tasksView.buildInboxCountLine(4), 'Capture · 4 waiting')

  assert.equal(tasksView.buildChoresCountLine(0), 'Chores · none yet')
  assert.equal(tasksView.buildChoresCountLine(1), 'Chores · 1 active')
  assert.equal(tasksView.buildChoresCountLine(9), 'Chores · 9 active')
})

test('the suggestion control is absent, not refusing, when suggestions are off', () => {
  assert.equal(tasksView.suggestionControlHtml('Mop', false), '')
  assert.match(tasksView.suggestionControlHtml('Mop', true), /class="pill-icon enrich-one-btn"/)
  assert.match(tasksView.suggestionControlHtml('Mop', true), /aria-label="Suggest details for Mop"/)
})
