// ABOUTME: Unit tests for where "Add to session" sends a chore, and what it says afterwards.
// ABOUTME: Every line here must be a fact about the session, never a verdict on the user.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  sessionAddActionLabel, sessionAddNote, sessionAddTarget,
  sessionFloatModel, sessionMarkLabel, sessionMarks
} from './sessionAdd.js'

const session = (status, taskBundle = []) => ({ _id: 's1', status, taskBundle })

test('with no session under way, a chore goes to the next one', () => {
  assert.equal(sessionAddTarget(null, 'a'), 'next')
  assert.equal(sessionAddTarget(undefined, 'a'), 'next')
})

test('a finished session is not under way, so the chore goes to the next one', () => {
  assert.equal(sessionAddTarget(session('completed', []), 'a'), 'next')
  assert.equal(sessionAddTarget(session('interrupted', []), 'a'), 'next')
})

test('a session being done takes the chore, whether it is running or at a pause', () => {
  assert.equal(sessionAddTarget(session('active', ['b']), 'a'), 'running')
  assert.equal(sessionAddTarget(session('paused', ['b']), 'a'), 'running')
})

test('a chore already in the session under way is reported as such', () => {
  assert.equal(sessionAddTarget(session('active', ['a', 'b']), 'a'), 'in-running')
})

test('the action offers to add, and to take back out what is already picked', () => {
  assert.equal(sessionAddActionLabel('next', false), 'Add to session')
  assert.equal(sessionAddActionLabel('next', true), 'Take out')
  assert.equal(sessionAddActionLabel('running', false), 'Add to session')
})

// There is no taking a chore back out of a session already under way, so the
// sheet offers nothing rather than a control that would have to refuse.
test('a chore already in the session under way is offered no action', () => {
  assert.equal(sessionAddActionLabel('in-running', false), null)
  assert.equal(sessionAddActionLabel('in-running', true), null)
})

// The floating readout states what is in the session and keeps stating it, so
// the line about the chore that just moved says only that. Each says one thing.
test('adding to the next session says which chore went where, and no more', () => {
  assert.equal(
    sessionAddNote({ name: 'Descale the kettle', target: 'next', added: true }),
    'Descale the kettle is in your Quick session.')
})

test('taking one out says so in the same shape', () => {
  assert.equal(
    sessionAddNote({ name: 'Descale the kettle', target: 'next', added: false }),
    'Descale the kettle is out of your Quick session.')
})

test('adding to the session under way names that session, not the next one', () => {
  assert.equal(
    sessionAddNote({ name: 'Descale the kettle', target: 'running', added: true }),
    'Descale the kettle is in the session you are doing.')
})

test('a chore in the session under way is marked as being done', () => {
  const marks = sessionMarks(session('active', ['a']), [], ['a', 'b'])
  assert.deepEqual(marks, { a: 'doing' })
})

test('a chore picked for the next session is marked as picked', () => {
  assert.deepEqual(sessionMarks(null, ['b'], ['a', 'b']), { b: 'picked' })
})

// Starting a session should empty the picks, but a stale one must never make a
// chore read as two things at once.
test('the session under way wins over a pick left behind', () => {
  assert.deepEqual(sessionMarks(session('paused', ['a']), ['a'], ['a']), { a: 'doing' })
})

test('a finished session marks nothing, and leaves the picks reading as picks', () => {
  assert.deepEqual(sessionMarks(session('completed', ['a']), ['b'], ['a', 'b']), { b: 'picked' })
})

test('the stamp names which session the chore is in', () => {
  assert.equal(sessionMarkLabel('picked'), 'In session')
  assert.equal(sessionMarkLabel('doing'), 'Doing')
  assert.equal(sessionMarkLabel(null), '')
})

test('nothing in a session floats nothing', () => {
  assert.equal(sessionFloatModel({ kind: 'picked', count: 0, minutes: 0 }), null)
})

test('the float states what is in the Quick session and goes there', () => {
  assert.deepEqual(sessionFloatModel({ kind: 'picked', count: 3, minutes: 25 }), {
    kind: 'picked', label: 'Quick session', facts: '3 chores · 25 min', href: '#/today'
  })
})

test('while a session runs the float names that session and goes to it', () => {
  assert.deepEqual(sessionFloatModel({ kind: 'doing', count: 1, minutes: 5 }), {
    kind: 'doing', label: 'Doing', facts: '1 chore · 5 min', href: '#/doing'
  })
})

test('a session of chores nobody estimated floats the count, claiming no minutes', () => {
  assert.equal(
    sessionFloatModel({ kind: 'picked', count: 2, minutes: 0 }).facts,
    '2 chores · no time set yet')
})
