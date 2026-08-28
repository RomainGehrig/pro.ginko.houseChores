// ABOUTME: Tests pure As needed screen markup and its neutral direct actions.
// ABOUTME: The screen reuses ledger facts while keeping inspection timing free of lateness language.

import test from 'node:test'
import assert from 'node:assert/strict'
import { asNeededScreenHtml } from './asNeededView.js'

const TODAY = '2026-08-24'
const SNAPSHOT = {
  categories: [{ _id: 'home', name: 'Home & <care>' }]
}

const task = (overrides = {}) => ({
  _id: 'waiting', name: 'Check rain barrel', status: 'active', taskMode: 'as_needed',
  readiness: 'waiting', categoryId: 'home', estimatedDuration: 10,
  scheduledDate: TODAY, schedule: { type: 'periodic', every: 2, unit: 'day' },
  lastCompletedDate: null,
  ...overrides
})

test('as-needed screen renders ordered counted groups with state-specific actions', () => {
  const markup = asNeededScreenHtml([
    task({ _id: 'waiting', scheduledDate: '2026-08-20' }),
    task({ _id: 'ready', name: 'Ready task', readiness: 'ready' })
  ], SNAPSHOT, TODAY, {})

  assert.ok(markup.indexOf('>Ready<') < markup.indexOf('>Check now<'))
  assert.match(markup, /Ready<\/span><span class="ledger-count fig">1</)
  assert.match(markup, /Check now<\/span><span class="ledger-count fig">1</)
  assert.match(markup, /class="as-needed-ready" data-id="waiting"[^>]*>Mark ready</)
  assert.match(markup, /class="as-needed-later" data-id="waiting"[^>]*>Check again later</)
  assert.match(markup, /class="as-needed-not-ready" data-id="ready"[^>]*>Not ready</)
  assert.match(markup, /class="as-needed-done" data-id="ready"[^>]*>Mark as done</)
  assert.match(markup, /class="as-needed-edit"[^>]*aria-haspopup="dialog"/)
  assert.doesNotMatch(markup, /overdue|\blate\b|\+\d+ d|danger|error/i)
})

test('as-needed screen escapes stored task and category names', () => {
  const markup = asNeededScreenHtml([
    task({ name: 'Check <script>', categoryId: 'home' })
  ], SNAPSHOT, TODAY, {})

  assert.match(markup, /Check &lt;script&gt;/)
  assert.match(markup, /Home &amp; &lt;care&gt;/)
  assert.doesNotMatch(markup, /<script>|<care>/)
})

test('as-needed screen arms the done action with the shared confirmation wording', () => {
  const markup = asNeededScreenHtml([
    task({ _id: 'ready', readiness: 'ready' })
  ], SNAPSHOT, TODAY, { confirmingDoneId: 'ready' })

  assert.match(markup, /class="as-needed-done" data-id="ready" aria-pressed="true"[^>]*>Tap again to confirm</)
})

test('one-off date continuation identifies its action and names the chore', () => {
  const markup = asNeededScreenHtml([
    task({ _id: 'once', name: 'Order filter', schedule: { type: 'one_off' } })
  ], SNAPSHOT, TODAY, {
    datePrompt: { taskId: 'once', action: 'later' }
  })

  assert.match(markup, /<label[^>]*>.*Order filter.*<input[^>]*type="date"[^>]*class="as-needed-date"[^>]*data-id="once"[^>]*data-action="later"/)
  assert.match(markup, /class="as-needed-date-save" data-id="once" data-action="later"[^>]*>Save date</)
  assert.match(markup, /class="as-needed-date-cancel" data-id="once"[^>]*>Cancel</)
})

test('one-off date continuation re-emits the date being entered across repaints', () => {
  const markup = asNeededScreenHtml([
    task({ _id: 'once', name: 'Order filter', schedule: { type: 'one_off' } })
  ], SNAPSHOT, TODAY, {
    datePrompt: { taskId: 'once', action: 'later', value: '2026-09-02' }
  })

  assert.match(markup, /class="as-needed-date"[^>]*value="2026-09-02"/)
})

test('as-needed empty state distinguishes no chores from no filter matches', () => {
  const none = asNeededScreenHtml([], SNAPSHOT, TODAY, {})
  const filtered = asNeededScreenHtml([task()], SNAPSHOT, TODAY, {
    filter: { query: 'does not match' }
  })

  assert.match(none, /No as-needed chores yet\./)
  assert.doesNotMatch(none, /matches this filter/)
  assert.match(filtered, /No as-needed chore matches this filter\./)
})
