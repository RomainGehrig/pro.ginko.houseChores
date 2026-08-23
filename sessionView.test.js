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

// Once a session is under way the picks are no longer what you are putting
// together — they are the session. Leaving them behind makes the ledger and the
// floating readout describe a session that has already happened.
test('starting a session empties the draft, and a restored one leaves it alone', async () => {
  const { sessionPicks } = await import('./sessionPicks.js')

  sessionPicks.set(['a', 'b'])
  sessionPicks.exclude('c')
  sessionView.clearPicksForStart({ restored: false })
  assert.deepEqual(sessionPicks.getPickedIds(), [])
  assert.deepEqual(sessionPicks.getExcludedIds(), [])

  sessionPicks.set(['a', 'b'])
  sessionPicks.exclude('c')
  sessionView.clearPicksForStart({ restored: true })
  assert.deepEqual(sessionPicks.getPickedIds(), ['a', 'b'],
    'the new bundle was not started, so it is still the one being put together')
  assert.deepEqual(sessionPicks.getExcludedIds(), ['c'])
  sessionPicks.clear()
})
