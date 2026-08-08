import test from 'node:test'
import assert from 'node:assert/strict'
import {
  optimisticArchive,
  revertArchive,
  createUndoQueue
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
