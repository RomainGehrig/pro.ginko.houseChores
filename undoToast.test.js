import test from 'node:test'
import assert from 'node:assert/strict'
import {
  optimisticArchive,
  revertArchive,
  createUndoQueue,
  pendingUndo,
  undoPending,
  commitPending,
  currentUndo,
  subscribeUndo
} from './undoToast.js'

function schedulerHarness() {
  let nextId = 1
  const timers = new Map()
  const schedule = (callback, delay) => {
    const id = nextId++
    timers.set(id, { callback, delay })
    return id
  }
  const cancel = id => timers.delete(id)
  const fire = async id => {
    const timer = timers.get(id)
    if (!timer) return
    timers.delete(id)
    await timer.callback()
  }
  return { schedule, cancel, fire, timers }
}

test('optimistic archive round-trips a deep clone without input aliasing', () => {
  const task = {
    _id: 't-1',
    name: 'Descale coffee machine',
    status: 'active',
    schedule: { type: 'periodic', intervalDays: 14 },
    metadata: { locations: ['kitchen'] }
  }
  const transaction = optimisticArchive(task)

  assert.equal(transaction.key, 'task:t-1')
  assert.equal(transaction.archived.status, 'archived')
  assert.deepEqual(transaction.original, task)
  assert.notStrictEqual(transaction.original, task)
  assert.notStrictEqual(transaction.archived, task)
  assert.notStrictEqual(transaction.original.schedule, task.schedule)
  assert.notStrictEqual(transaction.archived.metadata, task.metadata)

  task.metadata.locations.push('garage')
  transaction.archived.name = 'Changed archive copy'
  assert.deepEqual(revertArchive(transaction), {
    _id: 't-1',
    name: 'Descale coffee machine',
    status: 'active',
    schedule: { type: 'periodic', intervalDays: 14 },
    metadata: { locations: ['kitchen'] }
  })
  assert.notStrictEqual(revertArchive(transaction), transaction.original)
})

test('a second pending action commits the first before it is installed', async () => {
  const harness = schedulerHarness()
  const committed = []
  const changes = []
  const queue = createUndoQueue({
    schedule: harness.schedule,
    cancel: harness.cancel,
    onChange: action => changes.push(action?.key || null)
  })
  const first = { key: 'task:1', label: 'First', commit: () => committed.push('first'), revert: () => 'restored first' }
  const second = { key: 'task:2', label: 'Second', commit: () => committed.push('second'), revert: () => 'restored second' }

  await queue.pendingUndo(first)
  await queue.pendingUndo(second)

  assert.deepEqual(committed, ['first'])
  assert.equal(queue.current().key, 'task:2')
  assert.deepEqual(changes, ['task:1', null, 'task:2'])
})

test('overlapping pending actions serialize async commits without losing the third action', async () => {
  const harness = schedulerHarness()
  const committed = []
  let releaseFirstCommit
  const firstCommitStarted = new Promise(resolve => {
    releaseFirstCommit = resolve
  })
  const queue = createUndoQueue({ schedule: harness.schedule, cancel: harness.cancel })
  const action = (key, commit) => ({ key, label: key, commit, revert: () => null })
  const first = action('task:1', async () => {
    committed.push('task:1')
    await firstCommitStarted
  })
  const second = action('task:2', () => committed.push('task:2'))
  const third = action('task:3', () => committed.push('task:3'))

  await queue.pendingUndo(first)
  const secondPending = queue.pendingUndo(second)
  await Promise.resolve()
  const thirdPending = queue.pendingUndo(third)
  await Promise.resolve()
  assert.equal(queue.current(), null)

  releaseFirstCommit()
  await Promise.all([secondPending, thirdPending])

  assert.deepEqual(committed, ['task:1', 'task:2'])
  assert.equal(queue.current(), third)
})

test('expiry commits exactly once and clears the pending action', async () => {
  const harness = schedulerHarness()
  let commitCount = 0
  const queue = createUndoQueue({ schedule: harness.schedule, cancel: harness.cancel })
  await queue.pendingUndo({
    key: 'task:expires',
    label: 'Expires',
    commit: () => { commitCount += 1; return 'saved' },
    revert: () => 'restored'
  }, 1234)
  const timerId = [...harness.timers.keys()][0]

  await harness.fire(timerId)
  await harness.fire(timerId)

  assert.equal(commitCount, 1)
  assert.equal(queue.current(), null)
  assert.equal(harness.timers.size, 0)
})

test('expiry commit failures call onError after pending state is cleared', async () => {
  const harness = schedulerHarness()
  const errors = []
  let queue
  queue = createUndoQueue({
    schedule: harness.schedule,
    cancel: harness.cancel,
    onError: error => errors.push({ error, current: queue.current() })
  })
  const failure = new Error('expiry failed')
  await queue.pendingUndo({
    key: 'task:expiry-failure',
    label: 'Expiry failure',
    commit: async () => { throw failure },
    revert: () => null
  })
  const timerId = [...harness.timers.keys()][0]

  await harness.fire(timerId)

  assert.deepEqual(errors, [{ error: failure, current: null }])
  assert.equal(queue.current(), null)
})

test('explicit commit and undo failures propagate after pending state is cleared', async () => {
  const harness = schedulerHarness()
  const queue = createUndoQueue({ schedule: harness.schedule, cancel: harness.cancel })
  const commitFailure = new Error('commit failed')
  const undoFailure = new Error('undo failed')
  await queue.pendingUndo({
    key: 'task:commit-failure',
    label: 'Commit failure',
    commit: async () => { throw commitFailure },
    revert: () => null
  })

  await assert.rejects(queue.commit('task:commit-failure'), commitFailure)
  assert.equal(queue.current(), null)

  await queue.pendingUndo({
    key: 'task:undo-failure',
    label: 'Undo failure',
    commit: () => null,
    revert: async () => { throw undoFailure }
  })

  await assert.rejects(queue.undo('task:undo-failure'), undoFailure)
  assert.equal(queue.current(), null)
})

test('undo is scoped by key and returns the reverse operation result', async () => {
  const harness = schedulerHarness()
  const queue = createUndoQueue({ schedule: harness.schedule, cancel: harness.cancel })
  const action = {
    key: 'task:undo-me',
    label: 'Undo me',
    commit: () => 'committed',
    revert: () => ({ restored: true })
  }
  await queue.pendingUndo(action)

  assert.equal(await queue.undo('task:other'), null)
  assert.equal(queue.current(), action)

  const result = await queue.undo('task:undo-me')
  assert.deepEqual(result, { action, result: { restored: true } })
  assert.equal(queue.current(), null)
  assert.equal(harness.timers.size, 0)
})

test('singleton wrappers expose current state and subscriptions without requiring a DOM', async () => {
  const seen = []
  const unsubscribe = subscribeUndo(action => seen.push(action?.key || null))
  const action = { key: 'task:singleton', label: 'Singleton', commit: () => 'saved', revert: () => 'restored' }

  await pendingUndo(action, 60_000)
  assert.equal(currentUndo(), action)
  assert.deepEqual(await undoPending('task:singleton'), { action, result: 'restored' })
  assert.deepEqual(seen, ['task:singleton', null])

  unsubscribe()
  await pendingUndo(action, 60_000)
  await commitPending('task:singleton')
  assert.deepEqual(seen, ['task:singleton', null])
})
