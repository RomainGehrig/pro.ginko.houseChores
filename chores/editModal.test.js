// ABOUTME: Tests the chore edit modal's markup and the values it reads back.
// ABOUTME: The modal is the only place a chore's name can be changed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { editModalHtml, readEditModal } from './editModal.js'

const SNAPSHOT = {
  categories: [
    { _id: 'cat-1', name: 'Cleaning', status: 'active' },
    { _id: 'cat-2', name: 'Admin', status: 'active' }
  ],
  locations: [
    { _id: 'loc-1', name: 'Kitchen', status: 'active' },
    { _id: 'loc-2', name: 'Office', status: 'active' }
  ]
}

const chore = (overrides = {}) => ({
  _id: 'task-1',
  name: 'Mop the hall',
  status: 'active',
  estimatedDuration: 15,
  categoryId: 'cat-1',
  locationIds: ['loc-1'],
  schedule: { type: 'periodic', every: 1, unit: 'week' },
  scheduledDate: '2026-08-20',
  lastCompletedDate: '2026-08-13',
  ...overrides
})

test('the modal carries the whole chore, name first', () => {
  const markup = editModalHtml(chore(), SNAPSHOT, {})

  // The name is the one field the ledger never let you touch.
  assert.match(markup, /<input[^>]*class="input edit-name"[^>]*value="Mop the hall"/)
  assert.match(markup, /aria-label="Chore name"/)

  assert.match(markup, /class="[^"]*est-input[^"]*"[^>]*value="15"/)
  assert.match(markup, /data-estimate="15"[^>]*aria-pressed="true"/)
  assert.match(markup, /schedule-editor/)
  assert.match(markup, /data-schedule-field="date"/)
  assert.match(markup, /data-field="category"[^>]*data-value="cat-1"[^>]*aria-pressed="true"/)
  assert.match(markup, /class="f-location"[^>]*value="loc-1"[^>]*checked/)
  assert.match(markup, /class="pill done-btn"[^>]*>Recently done</)
  assert.match(markup, /archive-btn/)
})

test('a name with markup in it is text, not markup', () => {
  const markup = editModalHtml(chore({ name: '<img src=x onerror=alert(1)>' }), SNAPSHOT, {})
  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /value="&lt;img src=x onerror=alert\(1\)&gt;"/)
})

test('the confirming Done label and a pending error both come through', () => {
  const markup = editModalHtml(chore(), SNAPSHOT,
    { confirmDone: true, error: 'Choose a valid schedule.' })
  assert.match(markup, /aria-pressed="true"[^>]*>Tap again to confirm</)
  assert.match(markup, /class="task-card-error" role="alert">Choose a valid schedule\./)
})

function modalRoot (values) {
  const nodes = new Map([
    ['.edit-name', { value: values.name }],
    ['.est-input', { value: values.estimate }],
    ['.f-category', { value: values.categoryId }],
    ['[data-schedule-field="date"]', { value: values.scheduledDate }],
    ['[data-schedule-field="type"]', { value: values.type }],
    ['[data-schedule-field="every"]', { value: values.every }],
    ['[data-schedule-field="unit"]', { value: values.unit }],
    ['[data-schedule-field="fixed-kind"]', { value: values.fixedKind || '' }],
    ['[data-schedule-field="month-day"]', { value: '1' }],
    ['[data-schedule-field="annual-month"]', { value: '1' }],
    ['[data-schedule-field="annual-day"]', { value: '1' }]
  ])
  return {
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector => selector === '.f-location:checked'
      ? (values.locationIds || []).map(value => ({ value }))
      : []
  }
}

test('reads every edited value back, the name trimmed', () => {
  const result = readEditModal(modalRoot({
    name: '  Mop the hall  ',
    estimate: '25',
    categoryId: 'cat-2',
    locationIds: ['loc-1', 'loc-2'],
    scheduledDate: '2026-09-01',
    type: 'periodic',
    every: '2',
    unit: 'week'
  }), 'Old name')

  assert.deepEqual(result, {
    ok: true,
    name: 'Mop the hall',
    estimatedDuration: 25,
    categoryId: 'cat-2',
    locationIds: ['loc-1', 'loc-2'],
    schedule: {
      ok: true,
      scheduledDate: '2026-09-01',
      schedule: { type: 'periodic', every: 2, unit: 'week' }
    }
  })
})

// An emptied box is someone part-way through retyping, not a decision to have
// no name — the same reading the cadence field already gets. Refusing here
// would also throw away every other edit made alongside it.
test('an emptied name reads as the name it already had, and never refuses', () => {
  const result = readEditModal(modalRoot({
    name: '   ', estimate: '25', categoryId: '', locationIds: [], type: 'one_off'
  }), 'Mop the hall')
  assert.equal(result.ok, true)
  assert.equal(result.name, 'Mop the hall')
  assert.equal(result.estimatedDuration, 25, 'the edits beside it survive')
})

test('an unreadable schedule reports itself rather than saving half a chore', () => {
  const result = readEditModal(modalRoot({
    name: 'Mop', estimate: '', categoryId: '', locationIds: [],
    type: 'fixed', fixedKind: 'unknown'
  }), 'Mop')
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Choose a valid schedule.')
})

test('an empty estimate and no category read as nothing set, not as a refusal', () => {
  const result = readEditModal(modalRoot({
    name: 'Mop', estimate: '', categoryId: '', locationIds: [], scheduledDate: '', type: 'one_off'
  }), 'Mop')
  assert.equal(result.ok, true)
  assert.equal(result.estimatedDuration, null)
  assert.equal(result.categoryId, null)
  assert.deepEqual(result.locationIds, [])
  assert.equal(result.schedule.scheduledDate, null)
})
