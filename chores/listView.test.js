// ABOUTME: Tests the Chores ledger markup — bands, rows, the inline editor and the archive.
// ABOUTME: Guards the rule that a row states facts and never says how far behind the user is.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ESTIMATE_PRESETS,
  ledgerCategoryPillsHtml,
  ledgerViewsHtml,
  ripeMeterHtml,
  ledgerRowHtml,
  ledgerGroupsHtml,
  unscheduledListHtml,
  archiveListHtml
} from './listView.js'

const TODAY = '2026-08-15'
const SNAPSHOT = {
  categories: [{ _id: 'cat-1', name: 'Cleaning' }, { _id: 'cat-2', name: 'Admin' }],
  locations: [{ _id: 'loc-1', name: 'Kitchen' }]
}

const chore = (overrides = {}) => ({
  _id: 'task-1',
  name: 'Mop the hall',
  status: 'approved_recurring',
  categoryId: 'cat-1',
  locationIds: [],
  estimatedDuration: 15,
  schedule: { type: 'periodic', every: 7, unit: 'day' },
  lastCompletedDate: '2026-08-08',
  scheduledDate: '2026-08-15',
  ...overrides
})

test('the view tabs press the one that is showing', () => {
  const markup = ledgerViewsHtml(2, 'archive')
  assert.match(markup, /data-ledger-view="active"[^>]*aria-pressed="false"/)
  assert.match(markup, /data-ledger-view="archive"[^>]*aria-pressed="true"/)
  assert.match(markup, /Unscheduled 2/)
})

test('the ledger filters by category on pills, All first and pressed by default', () => {
  const markup = ledgerCategoryPillsHtml(SNAPSHOT.categories, '')
  assert.match(markup, /^<button type="button" class="pill" data-category-id=""[^>]*>All<\/button>/)
  assert.match(markup, /data-category-id=""[^>]*aria-pressed="true"/)
  assert.match(markup, /data-category-id="cat-1"[^>]*aria-pressed="false"[^>]*>Cleaning</)
  assert.doesNotMatch(markup, /cat-tab/, 'the ledger filter is pills, not the pool tabs')

  const chosen = ledgerCategoryPillsHtml(SNAPSHOT.categories, 'cat-2')
  assert.match(chosen, /data-category-id=""[^>]*aria-pressed="false"/)
  assert.match(chosen, /data-category-id="cat-2"[^>]*aria-pressed="true"/)
})

test('the ripeness meter is a fill, a due tick and a fact — no colour of alarm', () => {
  const markup = ripeMeterHtml(chore(), TODAY)
  assert.match(markup, /class="ripe"/)
  assert.match(markup, /title="Ripe — exactly at its cadence"/)
  assert.match(markup, /width: ?50%/)
  assert.match(markup, /ripe-due/)
  assert.doesNotMatch(markup, /red|#c0392b|overdue|late/i)
})

test('a chore with no cadence shows no meter at all', () => {
  assert.equal(ripeMeterHtml(chore({ schedule: { type: 'one_off' } }), TODAY), '')
  assert.equal(ripeMeterHtml(chore({ lastCompletedDate: null }), TODAY), '')
})

test('a closed row states the facts and carries no editor', () => {
  const markup = ledgerRowHtml(chore(), SNAPSHOT, TODAY, {})
  assert.match(markup, /Mop the hall/)
  assert.match(markup, /last done <span class="fig">7<\/span>d ago/)
  assert.match(markup, /15 min/)
  assert.match(markup, /aria-expanded="false"/)
  assert.doesNotMatch(markup, /ledger-row-editor/)
  assert.doesNotMatch(markup, /overdue|late|behind/i)
})

test('a row wears its category, and the flag carries the reason when there is none', () => {
  assert.match(ledgerRowHtml(chore(), SNAPSHOT, TODAY, {}),
    /<span class="row-cat tag tag-sage">Cleaning<\/span>/)

  const uncategorised = ledgerRowHtml(chore({ categoryId: null }), SNAPSHOT, TODAY, {})
  assert.match(uncategorised, /<span class="row-cat tag tag-sage">—<\/span>/)
  assert.doesNotMatch(uncategorised, /row-flag/, 'no category is not a fault to flag')

  // The design writes "Unavailable" into both the tag and the flag. Said twice
  // on one row it reads as two problems, so the tag shows there is no name and
  // the flag is the one place that says why.
  const gone = ledgerRowHtml(chore({ categoryId: 'cat-gone' }), SNAPSHOT, TODAY, {})
  assert.match(gone, /<span class="row-cat tag tag-sage">—<\/span>/)
  assert.match(gone, /<span class="row-flag">Unavailable<\/span>/)

  const archived = ledgerRowHtml(chore(),
    { categories: [{ _id: 'cat-1', name: 'Cleaning', status: 'archived' }] }, TODAY, {})
  assert.match(archived, /<span class="row-cat tag tag-sage">Cleaning<\/span>/,
    'an archived category still names the chore it holds')
  assert.match(archived, /<span class="row-flag">Archived<\/span>/)

  // A category is a name the user typed, and this database holds one carrying
  // a script probe. It reaches the row as text or not at all.
  const hostile = ledgerRowHtml(chore(),
    { categories: [{ _id: 'cat-1', name: 'QA <svg onload="boom()">' }] }, TODAY, {})
  assert.match(hostile, /QA &lt;svg onload=&quot;boom\(\)&quot;&gt;/)
  assert.doesNotMatch(hostile, /<svg/)
})

test('the band stamp repeats the group for the eye, not for the screen reader', () => {
  const markup = ledgerRowHtml(chore({ scheduledDate: '2026-08-10' }), SNAPSHOT, TODAY, {})
  assert.match(markup, /<span class="row-band" aria-hidden="true">Ready<\/span>/)
})

test('an open row carries the whole editor, with no Save to press', () => {
  const markup = ledgerRowHtml(chore(), SNAPSHOT, TODAY, { openTaskId: 'task-1' })
  assert.match(markup, /aria-expanded="true"/)
  assert.match(markup, /ledger-row-editor/)
  assert.match(markup, /class="[^"]*est-input/)
  assert.match(markup, /data-estimate="30"/)
  assert.match(markup, /schedule-editor/)
  assert.match(markup, /data-field="category"/)
  assert.match(markup, /f-location/)
  assert.match(markup, /archive-btn/)
  assert.doesNotMatch(markup, /save-task-edit-btn/)
})

// The unscheduled list is where a chore goes to be given a day, so the row that
// opens there must carry the same schedule controls as any other. Leaving them
// out also refused every other edit in that view, because the row reads its
// schedule back from the editor before it saves anything.
test('a row opened from the unscheduled list can still be given a day', () => {
  const loose = chore({ scheduledDate: null, lastCompletedDate: null })
  const markup = ledgerRowHtml(loose, SNAPSHOT, TODAY, { openTaskId: 'task-1' },
    { band: null, tag: 'No day set' })
  assert.match(markup, /schedule-editor/)
  assert.match(markup, /data-schedule-field="date"/)
  assert.match(markup, /Leave it blank and the chore waits in Unscheduled\./)
})

test('every preset the design offers is on the row', () => {
  const markup = ledgerRowHtml(chore(), SNAPSHOT, TODAY, { openTaskId: 'task-1' })
  assert.deepEqual(ESTIMATE_PRESETS, [5, 10, 15, 20, 30, 45, 60])
  for (const preset of ESTIMATE_PRESETS) {
    assert.match(markup, new RegExp('data-estimate="' + preset + '"'))
  }
  assert.match(markup, /data-estimate="15"[^>]*aria-pressed="true"/)
})

test('marking a chore done asks a second time in its own label', () => {
  const closed = ledgerRowHtml(chore(), SNAPSHOT, TODAY, { openTaskId: 'task-1' })
  assert.match(closed, /class="pill done-btn"[^>]*aria-pressed="false"[^>]*>Done</)

  const confirming = ledgerRowHtml(chore(), SNAPSHOT, TODAY,
    { openTaskId: 'task-1', confirmDoneId: 'task-1' })
  assert.match(confirming, /aria-pressed="true"[^>]*>Tap again to confirm</)
})

test('a row shows its own error and nothing else does', () => {
  const markup = ledgerRowHtml(chore(), SNAPSHOT, TODAY,
    { openTaskId: 'task-1', rowError: 'Give the cadence a number of at least 1.' })
  assert.match(markup, /Give the cadence a number of at least 1\./)
})

test('the groups are labelled, counted, and drop the bands that are empty', () => {
  const markup = ledgerGroupsHtml([
    chore({ _id: 'a', name: 'Ready one', scheduledDate: '2026-08-10' }),
    chore({ _id: 'b', name: 'Today one', scheduledDate: TODAY }),
    chore({ _id: 'c', name: 'Today two', scheduledDate: TODAY })
  ], SNAPSHOT, TODAY, {})

  assert.match(markup, /Ready<\/span><span class="ledger-count fig">1</)
  assert.match(markup, /Today<\/span><span class="ledger-count fig">2</)
  assert.doesNotMatch(markup, />Someday</)
  assert.equal((markup.match(/class="ledger-group is-near"/g) || []).length, 2,
    'the two bands nearest to hand are the stamped ones')
})

test('the search and the category narrow the same list', () => {
  const tasks = [
    chore({ _id: 'a', name: 'Mop the hall' }),
    chore({ _id: 'b', name: 'File the receipts', categoryId: 'cat-2' })
  ]
  const searched = ledgerGroupsHtml(tasks, SNAPSHOT, TODAY, { filter: { query: 'receipt' } })
  assert.match(searched, /File the receipts/)
  assert.doesNotMatch(searched, /Mop the hall/)

  const byCategory = ledgerGroupsHtml(tasks, SNAPSHOT, TODAY, { filter: { category: 'Cleaning' } })
  assert.match(byCategory, /Mop the hall/)
  assert.doesNotMatch(byCategory, /File the receipts/)
})

test('a filter that matches nothing says so, and says how to widen it', () => {
  const markup = ledgerGroupsHtml([chore()], SNAPSHOT, TODAY, { filter: { query: 'zzz' } })
  assert.match(markup, /Nothing matches/)
  assert.match(markup, /Clear the search, or widen the category\./)
})

test('the unscheduled list explains why these sit out of the bands', () => {
  const loose = chore({ _id: 'u1', name: 'Sort the loft', schedule: { type: 'one_off' }, scheduledDate: null, lastCompletedDate: null })
  const markup = unscheduledListHtml([loose, chore()], SNAPSHOT, TODAY, {})
  assert.match(markup, /1 with no day set/)
  assert.match(markup, /No day set — these sit out of the bands until you give them one\./)
  assert.match(markup, /Sort the loft/)
  assert.match(markup, /No day set/)
  assert.doesNotMatch(markup, /Mop the hall/)

  // A cadence says how often, not when to start, so a rhythm with no day waits
  // here too rather than being stamped with one.
  const rhythm = chore({ _id: 'u2', name: 'Descale the kettle', scheduledDate: null })
  assert.match(unscheduledListHtml([rhythm], SNAPSHOT, TODAY, {}), /Descale the kettle/)
})

test('nothing unscheduled reads as a fact, not an achievement', () => {
  const markup = unscheduledListHtml([chore()], SNAPSHOT, TODAY, {})
  assert.match(markup, /Everything has a day/)
  assert.match(markup, /Nothing is waiting for a date\./)
})

test('an archived chore offers Restore, and a delete that asks twice', () => {
  const archived = chore({ _id: 'z', name: 'Wash the car', status: 'archived' })
  const markup = archiveListHtml([archived], SNAPSHOT, TODAY, {})
  assert.match(markup, /1 archived/)
  assert.match(markup, /Wash the car/)
  assert.match(markup, /restore-task-btn[^>]*>Restore</)
  assert.match(markup, /delete-task-btn[^>]*aria-pressed="false"[^>]*>Delete permanently</)
  assert.match(markup, /Archived chores keep their category, location and schedule\./)

  const confirming = archiveListHtml([archived], SNAPSHOT, TODAY, { confirmDeleteId: 'z' })
  assert.match(confirming, /aria-pressed="true"[^>]*>Tap again to delete permanently</)
})

test('an empty archive says what would put something in it', () => {
  const markup = archiveListHtml([], SNAPSHOT, TODAY, {})
  assert.match(markup, /Nothing archived/)
  assert.match(markup, /Archiving a chore from the list puts it here, with its category, location and schedule intact\./)
})
