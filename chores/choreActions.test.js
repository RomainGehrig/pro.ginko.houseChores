// ABOUTME: Tests shared chore-header actions used by Chores and Quick Session details.
// ABOUTME: Keeps completion confirmation and failure facts identical on both surfaces.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  armOrConfirmDone, completionFailureMessage, disarmDone
} from './choreActions.js'

function buttonElement () {
  const attributes = new Map([['aria-pressed', 'false']])
  return {
    textContent: 'Mark as done',
    getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value)
  }
}

test('completion asks once, confirms on the second press, and can stand down', () => {
  const button = buttonElement()

  assert.equal(armOrConfirmDone(button), false)
  assert.equal(button.getAttribute('aria-pressed'), 'true')
  assert.equal(button.textContent, 'Tap again to confirm')

  disarmDone(button)
  assert.equal(button.getAttribute('aria-pressed'), 'false')
  assert.equal(button.textContent, 'Mark as done')

  assert.equal(armOrConfirmDone(button), false)
  assert.equal(armOrConfirmDone(button), true)
})

test('completion failures retain the useful underlying cause', () => {
  assert.equal(
    completionFailureMessage({
      ok: false,
      stage: 'write',
      message: 'Could not save task: offline'
    }),
    "Couldn't record that. The chore is unchanged. Reason: offline."
  )
  assert.equal(
    completionFailureMessage({
      ok: false,
      stage: 'refresh',
      message: 'Task saved, but could not refresh tasks: connection reset'
    }),
    "Recorded, but couldn't refresh the chores. Reason: connection reset."
  )
  assert.equal(
    completionFailureMessage({
      ok: false,
      stage: 'validation',
      message: 'That chore is no longer in this list. Nothing was changed.'
    }),
    'That chore is no longer in this list. Nothing was changed.'
  )
  assert.equal(completionFailureMessage({ ok: true }), '')
})
