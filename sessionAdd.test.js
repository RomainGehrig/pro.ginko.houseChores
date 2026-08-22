// ABOUTME: Unit tests for where "Add to session" sends a chore, and what it says afterwards.
// ABOUTME: Every line here must be a fact about the session, never a verdict on the user.

import test from 'node:test'
import assert from 'node:assert/strict'

import { sessionAddActionLabel, sessionAddNote, sessionAddTarget } from './sessionAdd.js'

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

test('adding to the next session says where it went and what is in it', () => {
  assert.equal(
    sessionAddNote({ name: 'Descale the kettle', target: 'next', added: true, count: 3, minutes: 25 }),
    'Descale the kettle is in your Quick session · 3 chores · 25 min')
})

test('taking one out of the next session reports what is left', () => {
  assert.equal(
    sessionAddNote({ name: 'Descale the kettle', target: 'next', added: false, count: 1, minutes: 5 }),
    'Descale the kettle is out of your Quick session · 1 chore · 5 min')
})

test('taking the last one out says the session is empty rather than counting nothing', () => {
  assert.equal(
    sessionAddNote({ name: 'Descale the kettle', target: 'next', added: false, count: 0, minutes: 0 }),
    'Descale the kettle is out. Your Quick session is empty again.')
})

test('adding to the session under way names that session, not the next one', () => {
  assert.equal(
    sessionAddNote({ name: 'Descale the kettle', target: 'running', added: true, count: 4 }),
    'Descale the kettle is in the session you are doing · 4 chores')
})

test('a chore with no estimate still reads as a chore, with no minutes claimed for it', () => {
  assert.equal(
    sessionAddNote({ name: 'Sort the post', target: 'next', added: true, count: 1, minutes: 0 }),
    'Sort the post is in your Quick session · 1 chore · no time set yet')
})
