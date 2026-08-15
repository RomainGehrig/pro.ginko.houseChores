// ABOUTME: Tests the Setup screen's vocabulary arithmetic and copy.
// ABOUTME: A usage count is a fact about the word, never a score against the user.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SETUP_TABS,
  aiSwitchLabel,
  aiToggleMessage,
  archivedUsageLine,
  renamedTo,
  setupTabs,
  splitVocabulary,
  usageCount,
  usageLine
} from './vocabularyLogic.js'

const TASKS = [
  { _id: 't1', categoryId: 'cat-1', locationIds: ['loc-1'] },
  { _id: 't2', categoryId: 'cat-1', locationIds: ['loc-1', 'loc-2'] },
  { _id: 't3', categoryId: 'cat-2', locationIds: [] },
  { _id: 't4', categoryId: null, locationIds: null }
]

test('the vocabulary is three tabs, and the one showing is pressed', () => {
  assert.deepEqual(SETUP_TABS.map(tab => tab.key), ['categories', 'locations', 'ai'])
  assert.deepEqual(SETUP_TABS.map(tab => tab.label), ['Categories', 'Locations', 'AI'])
  assert.deepEqual(setupTabs('locations').map(tab => [tab.label, tab.active]), [
    ['Categories', false], ['Locations', true], ['AI', false]
  ])
})

test('usage is counted from the chores that actually carry the word', () => {
  assert.equal(usageCount('category', { _id: 'cat-1' }, TASKS), 2)
  assert.equal(usageCount('category', { _id: 'cat-2' }, TASKS), 1)
  assert.equal(usageCount('category', { _id: 'cat-3' }, TASKS), 0)
  assert.equal(usageCount('location', { _id: 'loc-1' }, TASKS), 2)
  assert.equal(usageCount('location', { _id: 'loc-2' }, TASKS), 1)
  assert.equal(usageCount('location', { _id: 'loc-9' }, TASKS), 0)
})

test('the usage line counts chores, and says nothing about the user', () => {
  assert.equal(usageLine(0), 'Not used yet')
  assert.equal(usageLine(1), '1 chore')
  assert.equal(usageLine(7), '7 chores')

  for (const count of [0, 1, 7]) {
    assert.doesNotMatch(usageLine(count), /unused|wasted|should|only/i)
  }
})

test('an archived word states what still carries it, so archiving is never a loss', () => {
  assert.equal(archivedUsageLine(0), 'Not used by any chore')
  assert.equal(archivedUsageLine(1), '1 chore still carries it')
  assert.equal(archivedUsageLine(4), '4 chores still carry it')
})

test('an empty rename keeps the word it started with', () => {
  assert.equal(renamedTo('  Cleaning  ', 'Chores'), 'Cleaning')
  assert.equal(renamedTo('   ', 'Chores'), 'Chores')
  assert.equal(renamedTo('', 'Chores'), 'Chores')
  assert.equal(renamedTo(undefined, 'Chores'), 'Chores')
})

test('active and archived words are told apart, in the order they arrived', () => {
  const groups = splitVocabulary([
    { _id: 'a', name: 'Admin', status: 'active' },
    { _id: 'b', name: 'Old', status: 'archived' },
    { _id: 'c', name: 'Cleaning' }
  ])
  assert.deepEqual(groups.active.map(item => item._id), ['a', 'c'])
  assert.deepEqual(groups.archived.map(item => item._id), ['b'])
})

test('the suggestions switch states its own position and what changing it did', () => {
  assert.equal(aiSwitchLabel(true), 'On')
  assert.equal(aiSwitchLabel(false), 'Off')
  assert.equal(aiToggleMessage(true), 'Suggestions turned off')
  assert.equal(aiToggleMessage(false), 'Suggestions turned on')
})
