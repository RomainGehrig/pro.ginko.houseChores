import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBundle,
  buildBundleProposal,
  buildSessionDraft,
  findFillerTask
} from './bundleLogic.js'

const tasks = [
  { _id: 't1', category: 'Same label', categoryId: 'c1', estimatedDuration: 5, nextDueDate: 1 },
  { _id: 't2', category: 'Same label', categoryId: 'c2', estimatedDuration: 5, nextDueDate: 2 }
]

test('bundle filters by stable category id', () => {
  assert.deepEqual(buildBundle(tasks, 10, 'c2').map(task => task._id), ['t2'])
})

test('unfiltered bundle still considers every task', () => {
  assert.deepEqual(buildBundle(tasks, 10, null).map(task => task._id), ['t1', 't2'])
})

test('filler selection uses the stable category id', () => {
  assert.equal(findFillerTask(tasks, [], 5, 'c2')._id, 't2')
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
    status: 'active'
  })
})
