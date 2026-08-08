import test from 'node:test'
import assert from 'node:assert/strict'
import {
  archiveTaskOptimistically,
  buildActiveTaskScheduleFields,
  buildApprovedTaskFields,
  buildTaskReferenceFields
} from './tasksView.js'
import { activeTaskGroupsHtml } from './chores/listView.js'
import { LEGACY_CATEGORY_SELECTION } from './categoryLocationLogic.js'

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

test('active task groups render due-first ledger headings and rows', () => {
  const tasks = [{
    _id: 'later', name: 'Later task', status: 'active', estimatedDuration: 10,
    scheduledDate: '2026-08-20', schedule: { type: 'one_off' }
  }, {
    _id: 'ripe', name: 'Ripe task', status: 'approved_recurring', estimatedDuration: 15,
    scheduledDate: '2026-08-07', lastCompletedDate: null,
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }]

  const markup = activeTaskGroupsHtml(tasks, { categories: [], locations: [] }, '2026-08-08')

  assert.ok(markup.indexOf('>READY<') < markup.indexOf('>LATER<'))
  assert.match(markup, /<section class="ledger-group" aria-labelledby="ledger-ready">/)
  assert.match(markup, /<h3 id="ledger-ready" class="ledger-eyebrow stamp"><span>READY<\/span><span class="ledger-count fig">1<\/span><\/h3>/)
  assert.match(markup, /<ul class="ledger">[\s\S]*class="task-card ledger-row" data-id="ripe"/)
  assert.match(markup, /data-id="ripe"[\s\S]*class="row-stamp">—</)
  assert.match(markup, /data-id="ripe"[\s\S]*class="edit-task-btn"/)
  assert.match(markup, /data-id="ripe"[\s\S]*class="archive-btn"/)
})

test('active task group renderer has a factual empty state', () => {
  assert.equal(
    activeTaskGroupsHtml([], { categories: [], locations: [] }, '2026-08-08'),
    '<p class="empty">No active tasks.</p>'
  )
})

test('active task renderer receives editing state without global coordinator state', () => {
  const task = {
    _id: 'task-editing', name: 'Clean kitchen', status: 'active', estimatedDuration: 10,
    scheduledDate: '2026-08-08', schedule: { type: 'one_off' }
  }

  const markup = activeTaskGroupsHtml([task], { categories: [], locations: [] }, '2026-08-08', {
    editingTaskId: 'task-editing',
    taskEditorError: 'Choose a schedule'
  })

  assert.match(markup, /class="task-edit-form"/)
  assert.match(markup, /Choose a schedule/)
  assert.match(markup, /class="save-task-edit-btn"/)
  assert.match(markup, /class="cancel-task-edit-btn"/)
})
