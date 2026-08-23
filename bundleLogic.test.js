import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBundle,
  buildBundleProposal,
  buildSessionDraft,
  findFillerTask
} from './bundleLogic.js'

const tasks = [
  { _id: 't1', categoryId: 'c1', estimatedDuration: 5, scheduledDate: '2026-08-20' },
  { _id: 't2', categoryId: 'c2', estimatedDuration: 5, scheduledDate: '2026-08-10' }
]

test('scheduled dates change priority without hiding future tasks', () => {
  assert.deepEqual(buildBundle(tasks, 10, null).map(task => task._id), ['t2', 't1'])
})

test('bundle filters by stable category id', () => {
  assert.deepEqual(buildBundle(tasks, 10, 'c2').map(task => task._id), ['t2'])
})

test('unfiltered bundle still considers every task', () => {
  assert.deepEqual(buildBundle(tasks, 10, null).map(task => task._id), ['t2', 't1'])
})

test('filler selection uses the stable category id', () => {
  assert.equal(findFillerTask(tasks, [], 5, 'c2')._id, 't2')
})

// Filling is help, not a reset. What the user put in stays in, in the order they
// put it there, and the app works out what else fits around it.
const fillTasks = [
  { _id: 'a', categoryId: 'c1', estimatedDuration: 5, scheduledDate: '2026-08-10' },
  { _id: 'b', categoryId: 'c1', estimatedDuration: 5, scheduledDate: '2026-08-11' },
  { _id: 'c', categoryId: 'c2', estimatedDuration: 20, scheduledDate: '2026-08-12' }
]

test('a bundle is built around what is already picked, never over it', () => {
  // 'c' is kept and its 20 minutes are spent, so only 10 of the 30 remain.
  assert.deepEqual(
    buildBundle(fillTasks, 30, null, ['c']).map(task => task._id),
    ['c', 'a', 'b'])

  // The kept one is not offered to itself a second time.
  assert.deepEqual(
    buildBundle(fillTasks, 10, null, ['a']).map(task => task._id),
    ['a', 'b'])
})

// A pick is a statement of intent, so neither the budget nor the filter may
// overturn it: the app only ever decides what to add.
test('a pick survives a filter it does not match and a budget it does not fit', () => {
  assert.deepEqual(
    buildBundle(fillTasks, 30, 'c1', ['c']).map(task => task._id),
    ['c', 'a', 'b'], 'kept although the filter is c1')

  const overflowing = buildBundle(fillTasks, 10, null, ['c'])
  assert.deepEqual(overflowing.map(task => task._id), ['c'],
    'nothing is added once the budget is spent, and nothing is taken away')
})

test('the proposal carries the picks through with everything else', () => {
  const proposal = buildBundleProposal(fillTasks, 30, null, [], ['c'])
  assert.deepEqual(proposal.tasks.map(task => task._id), ['c', 'a', 'b'])
})

// Setting a chore aside is advice to the machine, not a veto over the user's
// own choice. Fill must skip it, while an already-kept pick still leads.
test('a bundle skips set-aside chores but keeps one the user picked anyway', () => {
  assert.deepEqual(
    buildBundle(fillTasks, 10, null, [], ['a']).map(task => task._id),
    ['b'])

  assert.deepEqual(
    buildBundle(fillTasks, 10, null, ['a'], ['a', 'b']).map(task => task._id),
    ['a'])
})

test('session draft keeps the parameters captured with its proposed bundle', () => {
  let selectedCategoryId = 'c1'
  const proposal = buildBundleProposal(tasks, 5, selectedCategoryId, [
    { _id: 'c1', name: 'First category' },
    { _id: 'c2', name: 'Second category' }
  ])

  selectedCategoryId = 'c2'
  assert.equal(selectedCategoryId, 'c2')
  assert.deepEqual(buildSessionDraft(proposal, 1234), {
    timeBudgetMinutes: 5,
    categoryFilterId: 'c1',
    categoryFilter: 'First category',
    taskBundle: ['t1'],
    startTime: 1234,
    endTime: null,
    status: 'active',
    accumulatedActiveMs: 0,
    activeStartedAt: 1234,
    checkpointElapsedMs: 0,
    pausedAt: null,
    unassignedDurationMs: 0,
    pendingAddition: null,
    continuationSuggestionEntries: []
  })
})
