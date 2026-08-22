// ABOUTME: Unit tests for the shared list of chores hand-picked for the next session.
// ABOUTME: Both the pool and the Chores ledger write to it, so every change must reach both.

import test from 'node:test'
import assert from 'node:assert/strict'

import { sessionPicks } from './sessionPicks.js'

test.beforeEach(() => sessionPicks.reset())

test('the list starts empty', () => {
  assert.deepEqual(sessionPicks.getPickedIds(), [])
})

test('toggling drops a chore in, and toggling again takes it out', () => {
  assert.equal(sessionPicks.toggle('a'), true)
  assert.deepEqual(sessionPicks.getPickedIds(), ['a'])
  assert.equal(sessionPicks.toggle('a'), false)
  assert.deepEqual(sessionPicks.getPickedIds(), [])
})

test('toggling reports whether the chore is now in', () => {
  assert.equal(sessionPicks.toggle('a'), true)
  assert.equal(sessionPicks.isPicked('a'), true)
  assert.equal(sessionPicks.isPicked('b'), false)
})

test('the list keeps the order things were dropped in', () => {
  sessionPicks.toggle('c')
  sessionPicks.toggle('a')
  sessionPicks.toggle('b')
  assert.deepEqual(sessionPicks.getPickedIds(), ['c', 'a', 'b'])
})

test('the list handed out is a copy, so a caller cannot edit it in place', () => {
  sessionPicks.toggle('a')
  sessionPicks.getPickedIds().push('b')
  assert.deepEqual(sessionPicks.getPickedIds(), ['a'])
})

test('setting the list replaces it, dropping blanks and duplicates', () => {
  sessionPicks.set(['a', 'b', 'a', '', null, 'c'])
  assert.deepEqual(sessionPicks.getPickedIds(), ['a', 'b', 'c'])
})

test('setting nothing empties the list', () => {
  sessionPicks.toggle('a')
  sessionPicks.set(null)
  assert.deepEqual(sessionPicks.getPickedIds(), [])
})

test('subscribers hear about every change, wherever it came from', () => {
  const heard = []
  sessionPicks.subscribe(ids => heard.push(ids))
  sessionPicks.toggle('a')
  sessionPicks.set(['b'])
  assert.deepEqual(heard, [['a'], ['b']])
})

test('a subscriber can stop listening', () => {
  let calls = 0
  const stop = sessionPicks.subscribe(() => { calls += 1 })
  sessionPicks.toggle('a')
  stop()
  sessionPicks.toggle('b')
  assert.equal(calls, 1)
})

test('one subscriber throwing does not rob the others of the change', () => {
  const heard = []
  sessionPicks.subscribe(() => { throw new Error('no') })
  sessionPicks.subscribe(ids => heard.push(ids))
  sessionPicks.toggle('a')
  assert.deepEqual(heard, [['a']])
})
