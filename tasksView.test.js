import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeTaskCardHtml,
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

test('active and archived non-editing cards receive location reference state', () => {
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

  for (const markup of [
    activeTaskCardHtml(task, snapshot),
    archivedTaskCardHtml({ ...task, status: 'archived' }, snapshot)
  ]) {
    assert.match(markup, /Attic/)
    assert.match(markup, /archived-badge">Archived/)
  }
})
