// ABOUTME: Tests the chore edit modal's markup and the values it reads back.
// ABOUTME: The modal is the only place a chore's name can be changed.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  choreDoneButtonHtml, choreSessionButtonHtml, editModalHtml, readEditModal
} from './editModal.js'

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
  assert.match(markup, /archive-btn/)
})

// Marking a chore done is not an edit, so it belongs beside the title rather
// than at the head of the fields, where it pushed the actual editing down.
test('the body holds the fields alone, the completion control living in the header', () => {
  const markup = editModalHtml(chore(), SNAPSHOT, {})
  assert.doesNotMatch(markup, /done-btn/)
  assert.match(choreDoneButtonHtml(), /class="btn done-btn"[^>]*>Mark as done</)
  assert.match(choreDoneButtonHtml(false), /aria-pressed="false"/)
  assert.match(choreDoneButtonHtml(true), /aria-pressed="true"[^>]*>Tap again to confirm</)
})

// Archiving is neither an edit nor common, and a misfired one is a chore
// vanishing from the list. It reads as a quiet aside at the far end, never as a
// third answer sitting in the path of Cancel and Save.
test('archive waits past the fields as a quiet control, not a peer of the actions', () => {
  const markup = editModalHtml(chore(), SNAPSHOT, {})
  assert.ok(markup.indexOf('archive-btn') > markup.indexOf('f-locations'),
    'archive comes after the fields')
  assert.match(markup, /class="edit-archive"/)
  assert.match(markup, /class="btn btn-text archive-btn"/)
  assert.doesNotMatch(markup, /btn-primary|btn-ghost/)
})

test('a name with markup in it is text, not markup', () => {
  const markup = editModalHtml(chore({ name: '<img src=x onerror=alert(1)>' }), SNAPSHOT, {})
  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /value="&lt;img src=x onerror=alert\(1\)&gt;"/)
})

test('a pending error is stated in the body, beside the fields it is about', () => {
  const markup = editModalHtml(chore(), SNAPSHOT, { error: 'Choose a valid schedule.' })
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
  }), { name: 'Old name' })

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
  }), { name: 'Mop the hall' })
  assert.equal(result.ok, true)
  assert.equal(result.name, 'Mop the hall')
  assert.equal(result.estimatedDuration, 25, 'the edits beside it survive')
})

// The sheet has already closed by the time Save is read, so a refusal here
// costs the user every other edit they made — the name, the estimate, the
// category. An unreadable schedule reads as the one the chore already had,
// exactly as an emptied name and an emptied cadence box do.
test('an unreadable schedule keeps the one the chore had, and saves the rest', () => {
  const previous = {
    name: 'Mop',
    schedule: { type: 'periodic', every: 2, unit: 'week' },
    scheduledDate: '2026-08-20'
  }
  const result = readEditModal(modalRoot({
    name: 'Mop the whole hall', estimate: '25', categoryId: 'cat-2', locationIds: ['loc-1'],
    type: 'fixed', fixedKind: 'unknown'
  }), previous)

  assert.equal(result.ok, true)
  assert.equal(result.name, 'Mop the whole hall', 'the edits beside it survive')
  assert.equal(result.estimatedDuration, 25)
  assert.equal(result.categoryId, 'cat-2')
  assert.deepEqual(result.schedule, {
    ok: true,
    schedule: { type: 'periodic', every: 2, unit: 'week' },
    scheduledDate: '2026-08-20'
  })
})

test('an empty estimate and no category read as nothing set, not as a refusal', () => {
  const result = readEditModal(modalRoot({
    name: 'Mop', estimate: '', categoryId: '', locationIds: [], scheduledDate: '', type: 'one_off'
  }), { name: 'Mop' })
  assert.equal(result.ok, true)
  assert.equal(result.estimatedDuration, null)
  assert.equal(result.categoryId, null)
  assert.deepEqual(result.locationIds, [])
  assert.equal(result.schedule.scheduledDate, null)
})

// Putting a chore in a session is the other thing you open a chore to do, so it
// stands beside marking it done rather than among the answers to the edit.
test('the session control rides in the title row, quieter than marking done', () => {
  const markup = choreSessionButtonHtml('Add to session')
  assert.match(markup, /class="btn btn-quiet session-btn"/)
  assert.match(markup, />Add to session</)
})

test('the session control takes whatever the moment calls it', () => {
  assert.match(choreSessionButtonHtml('Take out'), />Take out</)
})

// A chore already in a session under way has nowhere to go, and a control that
// could only refuse is worse than no control.
test('no label means no control at all, not a control that refuses', () => {
  assert.equal(choreSessionButtonHtml(null), '')
  assert.equal(choreSessionButtonHtml(''), '')
})

test('a label is text in the title row, not markup', () => {
  assert.match(choreSessionButtonHtml('<script>x</script>'), /&lt;script&gt;/)
})
