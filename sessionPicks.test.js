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
  sessionPicks.subscribe((...args) => heard.push({
    args,
    pickedIds: sessionPicks.getPickedIds(),
    setAsideIds: sessionPicks.getExcludedIds()
  }))
  sessionPicks.toggle('a')
  sessionPicks.exclude('b')
  assert.deepEqual(heard, [{
    args: [],
    pickedIds: ['a'],
    setAsideIds: []
  }, {
    args: [],
    pickedIds: ['a'],
    setAsideIds: ['b']
  }])
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
  sessionPicks.subscribe(() => heard.push(sessionPicks.getPickedIds()))
  sessionPicks.toggle('a')
  assert.deepEqual(heard, [['a']])
})

// A pick is a chore you mean to do next. Once the chore has left the list it is
// not that any more — and an id that outlives its chore silently puts it back in
// the session if the chore is ever restored.
test('picks are kept only for the chores that are still there', () => {
  sessionPicks.set(['a', 'b', 'c'])
  assert.deepEqual(sessionPicks.retain(['a', 'c', 'd']), ['a', 'c'])
  assert.deepEqual(sessionPicks.getPickedIds(), ['a', 'c'])
})

test('keeping every pick changes nothing and tells nobody', () => {
  const heard = []
  sessionPicks.set(['a', 'b'])
  sessionPicks.subscribe(ids => heard.push(ids))
  assert.deepEqual(sessionPicks.retain(['a', 'b', 'c']), ['a', 'b'])
  assert.deepEqual(heard, [], 'a repaint for a change nobody made is a repaint nobody asked for')
})

test('a pick dropped with its chore reaches both screens', () => {
  const heard = []
  sessionPicks.set(['a', 'b'])
  sessionPicks.subscribe(() => heard.push(sessionPicks.getPickedIds()))
  sessionPicks.retain(['b'])
  assert.deepEqual(heard, [['b']])
})

test('retaining against nothing empties the list', () => {
  sessionPicks.set(['a', 'b'])
  assert.deepEqual(sessionPicks.retain([]), [])
})

test('task-list retention does not shorten a set-aside choice', () => {
  sessionPicks.set(['a', 'b'])
  sessionPicks.exclude('a')

  assert.deepEqual(sessionPicks.retain([]), [])
  assert.deepEqual(sessionPicks.getExcludedIds(), ['a'],
    'the exclusion lasts for the Quick-session draft, not for one task refresh')
})

test('setting a picked chore aside moves it out of the session draft', () => {
  sessionPicks.set(['a', 'b'])

  assert.equal(sessionPicks.exclude('a'), true)
  assert.deepEqual(sessionPicks.getPickedIds(), ['b'])
  assert.deepEqual(sessionPicks.getExcludedIds(), ['a'])
})

test('manually picking a set-aside chore brings it back', () => {
  sessionPicks.exclude('a')

  assert.equal(sessionPicks.toggle('a'), true)
  assert.deepEqual(sessionPicks.getPickedIds(), ['a'])
  assert.deepEqual(sessionPicks.getExcludedIds(), [])
})

test('restoring a set-aside chore makes it available without picking it', () => {
  sessionPicks.exclude('a')

  assert.equal(sessionPicks.include('a'), true)
  assert.deepEqual(sessionPicks.getPickedIds(), [])
  assert.deepEqual(sessionPicks.getExcludedIds(), [])
})

test('clearing the draft empties picks and exclusions without dropping subscribers', () => {
  const heard = []
  sessionPicks.set(['a'])
  sessionPicks.exclude('b')
  sessionPicks.subscribe(() => heard.push(sessionPicks.getPickedIds()))

  sessionPicks.clear()
  sessionPicks.toggle('c')

  assert.deepEqual(sessionPicks.getPickedIds(), ['c'])
  assert.deepEqual(sessionPicks.getExcludedIds(), [])
  assert.deepEqual(heard, [[], ['c']])
})
