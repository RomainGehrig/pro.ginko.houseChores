import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBundle,
  buildBundleProposal,
  buildSessionDraft,
  findFillerTask,
  prioritizeTasks
} from './bundleLogic.js'

const TODAY = '2026-08-26'

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

test('waiting as-needed chores never survive a retained pick or fill an empty slot', () => {
  const availabilityTasks = [
    { _id: 'waiting', taskMode: 'as_needed', readiness: 'waiting', estimatedDuration: 5, scheduledDate: '2026-08-01' },
    {
      _id: 'ready', taskMode: 'as_needed', readiness: 'ready', readySince: '2026-08-10',
      estimatedDuration: 5, scheduledDate: '2030-01-01'
    },
    { _id: 'scheduled', estimatedDuration: 5, scheduledDate: '2026-08-20' }
  ]

  assert.deepEqual(
    buildBundle(availabilityTasks, 30, null, ['waiting']).map(task => task._id),
    ['ready', 'scheduled']
  )
  assert.equal(findFillerTask(availabilityTasks, [], 30, null)._id, 'ready')
})

test('a ready as-needed chore is proposed before chores whose dates are still ahead', () => {
  const proposal = buildBundle([
    { _id: 'tomorrow', estimatedDuration: 5, scheduledDate: '2026-08-25' },
    {
      _id: 'ready', taskMode: 'as_needed', readiness: 'ready', readySince: '2026-08-24',
      estimatedDuration: 5, scheduledDate: '2030-01-01'
    }
  ], 10, null)

  assert.deepEqual(proposal.map(task => task._id), ['ready', 'tomorrow'])
})

test('a legacy ready chore without readySince uses today on every priority surface', () => {
  const candidates = [
    {
      _id: 'legacy-ready', taskMode: 'as_needed', readiness: 'ready',
      scheduledDate: '2030-01-01'
    },
    { _id: 'ripe', scheduledDate: '2026-08-01' }
  ]

  assert.deepEqual(
    prioritizeTasks(candidates, TODAY).map(task => task._id),
    ['ripe', 'legacy-ready']
  )
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

test('readiness and set-aside choices compose without overriding explicit eligible picks', () => {
  const crossProduct = [
    { _id: 'waiting-picked', taskMode: 'as_needed', readiness: 'waiting', categoryId: 'wanted', estimatedDuration: 5, scheduledDate: '2030-01-01' },
    { _id: 'ready-picked', taskMode: 'as_needed', readiness: 'ready', categoryId: 'wanted', estimatedDuration: 5, scheduledDate: '2030-01-02' },
    { _id: 'scheduled-picked', taskMode: 'scheduled', categoryId: 'other', estimatedDuration: 20, scheduledDate: '2030-01-03' },
    { _id: 'waiting-auto', taskMode: 'as_needed', readiness: 'waiting', categoryId: 'wanted', estimatedDuration: 5, scheduledDate: '2030-01-04' },
    { _id: 'ready-set-aside', taskMode: 'as_needed', readiness: 'ready', categoryId: 'wanted', estimatedDuration: 5, scheduledDate: '2030-01-05' },
    { _id: 'scheduled-set-aside', taskMode: 'scheduled', categoryId: 'wanted', estimatedDuration: 5, scheduledDate: '2030-01-06' },
    { _id: 'ready-auto', taskMode: 'as_needed', readiness: 'ready', categoryId: 'wanted', estimatedDuration: 5, scheduledDate: '2030-01-07' },
    { _id: 'scheduled-auto', taskMode: 'scheduled', categoryId: 'wanted', estimatedDuration: 5, scheduledDate: '2030-01-08' }
  ]
  const keptIds = ['waiting-picked', 'ready-picked', 'scheduled-picked']
  const setAsideIds = [
    'ready-picked', 'scheduled-picked', 'ready-set-aside', 'scheduled-set-aside'
  ]
  const expected = ['ready-picked', 'scheduled-picked', 'ready-auto', 'scheduled-auto']

  assert.deepEqual(
    buildBundle(crossProduct, 50, 'wanted', keptIds, setAsideIds, TODAY).map(task => task._id),
    expected
  )
  assert.deepEqual(
    buildBundleProposal(crossProduct, 50, 'wanted', [], keptIds, setAsideIds, TODAY)
      .tasks.map(task => task._id),
    expected
  )
})

test('the proposal leaves out chores set aside for this draft', () => {
  const proposal = buildBundleProposal(fillTasks, 10, null, [], [], ['a'])
  assert.deepEqual(proposal.tasks.map(task => task._id), ['b'])
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
