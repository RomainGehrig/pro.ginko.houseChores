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
