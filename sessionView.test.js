// ABOUTME: Tests Session-view feedback when starting restores existing work.
// ABOUTME: Prevents a newly proposed bundle from appearing to start when it was discarded.

import test from 'node:test'
import assert from 'node:assert/strict'
import * as sessionView from './sessionView.js'

function statusElement () {
  const attributes = new Map()
  return {
    textContent: '',
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name)
  }
}

test('restored session start explains that the proposed bundle was not started', () => {
  const showSessionStartNotice = sessionView.showSessionStartNotice
  assert.equal(typeof showSessionStartNotice, 'function')
  const status = statusElement()

  assert.equal(showSessionStartNotice({ restored: true }, status), true)
  assert.equal(
    status.textContent,
    'Resuming your unfinished session — the new bundle was not started.'
  )
  assert.equal(status.getAttribute('role'), 'status')
})

test('new session start does not add a restore notice', () => {
  const showSessionStartNotice = sessionView.showSessionStartNotice
  assert.equal(typeof showSessionStartNotice, 'function')
  const status = statusElement()

  assert.equal(showSessionStartNotice({ restored: false }, status), false)
  assert.equal(status.textContent, '')
})

test('missing and valid budgets update the inline session status without disabling controls', () => {
  const status = statusElement()
  const propose = { disabled: false }
  const custom = { disabled: false }

  assert.equal(sessionView.updateBudgetStatus(status, false), false)
  assert.equal(status.textContent, 'Choose or enter a time budget first.')
  assert.equal(status.getAttribute('role'), 'status')
  assert.equal(propose.disabled, false)
  assert.equal(custom.disabled, false)

  assert.equal(sessionView.updateBudgetStatus(status, true), true)
  assert.equal(status.textContent, '')
  assert.equal(propose.disabled, false)
  assert.equal(custom.disabled, false)
})

test('Quick Session task details put outside completion beside the session action', () => {
  const model = sessionView.quickDetailSheetModel({
    _id: 'task-1',
    name: 'Clean kitchen',
    estimatedDuration: 20,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, [], '2026-08-23', true)

  assert.match(model.headerActionHtml, /class="btn done-btn"[^>]*>Mark as done</)
  assert.match(model.headerActionHtml, /class="btn btn-quiet session-btn"[^>]*>Take out</)
  assert.deepEqual(model.actions, [
    { label: 'Close', value: null, className: 'btn btn-ghost' }
  ])
})

test('a failed Quick Session completion is stated inline without changing the chore', () => {
  const status = statusElement()

  assert.equal(sessionView.showQuickCompletionResult(status, {
    ok: false, stage: 'write', message: 'Could not save task: offline'
  }), false)
  assert.equal(status.textContent, "Couldn't record that. The chore is unchanged.")
  assert.equal(status.getAttribute('role'), 'alert')
  assert.equal(status.getAttribute('data-state'), 'error')
})

test('a recorded completion distinguishes a failed list refresh from a failed write', () => {
  const status = statusElement()

  assert.equal(sessionView.showQuickCompletionResult(status, {
    ok: false, stage: 'refresh', message: 'Task saved, but could not refresh tasks: offline'
  }), false)
  assert.equal(status.textContent, "Recorded, but couldn't refresh the chores.")
  assert.equal(status.getAttribute('role'), 'status')
  assert.equal(status.getAttribute('data-state'), 'info')
})

test('a successful Quick Session completion clears any earlier failure', () => {
  const status = statusElement()
  status.textContent = "Couldn't record that. The chore is unchanged."
  status.setAttribute('role', 'alert')
  status.setAttribute('data-state', 'error')

  assert.equal(sessionView.showQuickCompletionResult(status, {
    ok: true, stage: null, message: ''
  }), true)
  assert.equal(status.textContent, '')
  assert.equal(status.getAttribute('role'), 'status')
  assert.equal(status.getAttribute('data-state'), '')
})

// Once a session is under way the picks are no longer what you are putting
// together — they are the session. Leaving them behind makes the ledger and the
// floating readout describe a session that has already happened.
test('starting a session empties the picks, and a restored one leaves them alone', async () => {
  const { sessionPicks } = await import('./sessionPicks.js')

  sessionPicks.set(['a', 'b'])
  sessionView.clearPicksForStart({ restored: false })
  assert.deepEqual(sessionPicks.getPickedIds(), [])

  sessionPicks.set(['a', 'b'])
  sessionView.clearPicksForStart({ restored: true })
  assert.deepEqual(sessionPicks.getPickedIds(), ['a', 'b'],
    'the new bundle was not started, so it is still the one being put together')
  sessionPicks.set([])
})
