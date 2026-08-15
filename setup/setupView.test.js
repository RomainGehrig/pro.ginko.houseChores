// ABOUTME: Tests the Setup screen markup — the vocabulary tabs, term rows and the AI switch.
// ABOUTME: Guards the copy that tells the user exactly what suggestions do and do not do.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aiPaneHtml,
  archiveTermWithUndo,
  mutationFeedback,
  setupTabsHtml,
  termRowHtml,
  vocabularyPaneHtml
} from './setupView.js'

const TASKS = [
  { _id: 't1', categoryId: 'cat-1', locationIds: ['loc-1'] },
  { _id: 't2', categoryId: 'cat-1', locationIds: [] }
]
const CATEGORIES = [
  { _id: 'cat-1', name: 'Cleaning', status: 'active' },
  { _id: 'cat-2', name: 'Admin', status: 'active' },
  { _id: 'cat-3', name: 'Retired', status: 'archived' }
]

test('the tabs press the one showing and name the pane they open', () => {
  const markup = setupTabsHtml('ai')
  assert.match(markup, /data-setup-tab="categories"[^>]*aria-pressed="false"[^>]*>Categories</)
  assert.match(markup, /data-setup-tab="ai"[^>]*aria-pressed="true"[^>]*>AI</)
})

test('a term states how many chores carry it, and offers rename and archive', () => {
  const markup = termRowHtml('category', CATEGORIES[0], { usage: 2 })
  assert.match(markup, /data-kind="category"/)
  assert.match(markup, /data-id="cat-1"/)
  assert.match(markup, /Cleaning/)
  assert.match(markup, /2 chores/)
  assert.match(markup, /data-action="rename"[^>]*>Rename</)
  assert.match(markup, /data-action="archive"[^>]*>Archive</)
  assert.doesNotMatch(markup, /reference-name-input/)
})

test('renaming happens in the row itself, seeded with the word it is replacing', () => {
  const markup = termRowHtml('category', CATEGORIES[0], { usage: 2, editing: true })
  assert.match(markup, /class="[^"]*term-name-input[^"]*"/)
  assert.match(markup, /value="Cleaning"/)
  assert.match(markup, /aria-label="Rename Cleaning"/)
  assert.doesNotMatch(markup, /data-action="rename"/)
})

test('an archived term says what still carries it and offers only Restore', () => {
  const markup = termRowHtml('category', CATEGORIES[2], { usage: 3, archived: true })
  assert.match(markup, /is-archived/)
  assert.match(markup, /3 chores still carry it/)
  assert.match(markup, /data-action="restore"[^>]*>Restore</)
  assert.doesNotMatch(markup, /data-action="archive"/)
})

test('a term name that looks like markup is shown as text', () => {
  const markup = termRowHtml('category', {
    _id: 'x" autofocus="', name: '<img src=x onerror=alert(1)>', status: 'active'
  }, { usage: 0, editing: true })
  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /data-id="x&quot; autofocus=&quot;"/)

  const quoted = termRowHtml('location', {
    _id: 'loc-q', name: 'Nan\'s "good" room', status: 'active'
  }, { usage: 0, editing: true })
  assert.match(quoted, /value="Nan&#39;s &quot;good&quot; room"/)
  assert.match(quoted, /aria-label="Rename Nan&#39;s &quot;good&quot; room"/)
})

test('a collection that failed to load outranks the message about the write', () => {
  assert.deepEqual(mutationFeedback({ error: 'Categories unavailable.' }, 'Category renamed.'),
    { message: 'Categories unavailable.', state: 'error' })
  assert.deepEqual(mutationFeedback({ warning: 'Locations may be stale.' }, 'Category renamed.'),
    { message: 'Locations may be stale.', state: 'warning' })
  assert.deepEqual(mutationFeedback({}, 'Category renamed.'),
    { message: 'Category renamed.', state: 'success' })
})

test('archiving a term keeps its assignments and offers the normal way back', async () => {
  const calls = []
  let queued
  await archiveTermWithUndo({
    kind: 'category',
    id: 'cat-1',
    config: {
      label: 'Category',
      archive: id => { calls.push(['archive', id]); return {} },
      restore: id => { calls.push(['restore', id]); return {} }
    },
    mutate: async (mutation, message) => {
      calls.push(['message', message])
      return { ok: true, snapshot: await mutation() }
    },
    queue: async action => { queued = action },
    render: () => calls.push(['render'])
  })

  assert.deepEqual(calls, [
    ['message', 'Category archived. Chores that carry it keep it.'],
    ['archive', 'cat-1'],
    ['render']
  ])
  assert.equal(queued.key, 'reference:category:cat-1')
  assert.equal(queued.label, 'Category archived')
  assert.equal(queued.commit(), null)

  assert.deepEqual(await queued.revert(), { kind: 'category', id: 'cat-1', status: 'active' })
  assert.deepEqual(calls.slice(3), [
    ['message', 'Category restored.'],
    ['restore', 'cat-1'],
    ['render']
  ])
})

test('a failed archive never opens a way back to something that did not happen', async () => {
  let queued = false
  const result = await archiveTermWithUndo({
    kind: 'location',
    id: 'loc-1',
    config: { label: 'Location', archive: () => {}, restore: () => {} },
    mutate: async () => ({ ok: false }),
    queue: async () => { queued = true },
    render: () => {}
  })

  assert.deepEqual(result, { ok: false })
  assert.equal(queued, false)
})

test('the categories pane counts live usage and separates the archived words', () => {
  const markup = vocabularyPaneHtml('category', CATEGORIES, TASKS, {})
  assert.match(markup, /<h2 id="categoriesHeading"[^>]*>Categories<\/h2>/)
  assert.match(markup, /Six are seeded on first run\. Rename or archive any of them\./)
  assert.match(markup, /data-id="cat-1"[\s\S]*?2 chores/)
  assert.match(markup, /data-id="cat-2"[\s\S]*?Not used yet/)
  assert.match(markup, /class="vocabulary-archived"[\s\S]*?>Archived</)
  assert.match(markup, /data-add-term="category"[^>]*>Add a category</)
})

test('the locations pane says what a location is for and offers its own add', () => {
  const markup = vocabularyPaneHtml('location', [
    { _id: 'loc-1', name: 'Kitchen', status: 'active' }
  ], TASKS, {})
  assert.match(markup, /A flat list, entirely yours — used to tag where a chore happens\./)
  assert.match(markup, /data-id="loc-1"[\s\S]*?1 chore</)
  assert.match(markup, /data-add-term="location"[^>]*>Add a location</)
  assert.doesNotMatch(markup, /vocabulary-archived/)
})

test('adding a term replaces its button with a field that names what it takes', () => {
  const markup = vocabularyPaneHtml('category', CATEGORIES, TASKS, { adding: 'category' })
  assert.match(markup, /class="[^"]*term-add-input[^"]*"[^>]*placeholder="New category"/)
  assert.doesNotMatch(markup, /data-add-term="category"/)
})

test('the switch states its own position and exactly what suggestions do', () => {
  const off = aiPaneHtml(false)
  assert.match(off, /role="switch"[^>]*aria-checked="false"/)
  assert.match(off, /id="aiSwitchLabel"[^>]*>Off</)
  assert.match(off, /Used in the Inbox, nowhere else\./)
  assert.match(off, /It never sets the date, never approves anything, and every field stays editable\./)
  assert.match(off, /The app is fully usable with this off\./)
  assert.match(off, /Chores, categories, locations, sessions and per-chore records live in your own storage\./)

  const on = aiPaneHtml(true)
  assert.match(on, /aria-checked="true"/)
  assert.match(on, />On</)
})
