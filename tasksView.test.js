import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeTaskGroupsHtml,
  archivedTaskCardHtml,
  buildActiveTaskScheduleFields,
  buildApprovedTaskFields,
  buildTaskReferenceFields
} from './tasksView.js'
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

test('archived non-editing cards retain location reference state', () => {
  const task = {
    _id: 'task-1',
    name: 'Clean attic',
    categoryId: 'category-1',
    locationIds: ['location-1'],
    estimatedDuration: 10,
    scheduledDate: '2026-08-16',
    schedule: { type: 'one_off' }
  }
  const snapshot = {
    categories: [{ _id: 'category-1', name: 'Cleaning', status: 'active' }],
    locations: [{ _id: 'location-1', name: 'Attic', status: 'archived' }]
  }

  const markup = archivedTaskCardHtml({ ...task, status: 'archived' }, snapshot)
  assert.match(markup, /Attic/)
  assert.match(markup, /archived-badge">Archived/)
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
  assert.match(markup, /data-id="ripe"[\s\S]*class="row-stamp fig">—</)
  assert.match(markup, /data-id="ripe"[\s\S]*class="edit-task-btn"/)
  assert.match(markup, /data-id="ripe"[\s\S]*class="archive-btn"/)
})

test('active task group renderer has a factual empty state', () => {
  assert.equal(
    activeTaskGroupsHtml([], { categories: [], locations: [] }, '2026-08-08'),
    '<p class="empty">No active tasks.</p>'
  )
})
