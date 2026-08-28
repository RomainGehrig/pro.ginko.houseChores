import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNewTaskRecord, createTaskWithId, deleteTask, listAllTasks } from './taskData.js'

test('new tasks stay frictionless and await scheduling during review', () => {
  assert.deepEqual(buildNewTaskRecord('Clean balcony'), {
    name: 'Clean balcony',
    category: null,
    categoryId: null,
    locationIds: [],
    estimatedDuration: null,
    scheduledDate: null,
    schedule: { type: 'one_off' },
    lastCompletedDate: null,
    taskMode: 'scheduled',
    readiness: null,
    readySince: null,
    status: 'proposed',
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null
  })
})

test('task reads normalize legacy and malformed availability without writing it back', async () => {
  const originalFreezr = globalThis.freezr
  const updateCalls = []
  globalThis.freezr = {
    query: async () => [
      { _id: 'legacy', name: 'Dust shelves', schedule: { type: 'one_off' } },
      { _id: 'as-needed', name: 'Inspect rain barrel', schedule: { type: 'one_off' }, taskMode: 'as_needed', readiness: 'bad', readySince: '2026-08-24' }
    ],
    update: async (...args) => { updateCalls.push(args) }
  }

  try {
    const tasks = await listAllTasks()
    assert.deepEqual(tasks.map(({ _id, taskMode, readiness, readySince }) => ({ _id, taskMode, readiness, readySince })), [
      { _id: 'legacy', taskMode: 'scheduled', readiness: null, readySince: null },
      { _id: 'as-needed', taskMode: 'as_needed', readiness: 'waiting', readySince: null }
    ])
    assert.deepEqual(updateCalls, [])
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})

test('supplied task ID makes title-only creation idempotent', async () => {
  const originalFreezr = globalThis.freezr
  const records = new Map()
  globalThis.freezr = {
    create: async (collection, data, options) => {
      const record = { _id: options.data_object_id, ...structuredClone(data) }
      records.set(record._id, record)
      return record
    }
  }
  try {
    await createTaskWithId('Replace hallway bulb', 'quick-s1-1')
    await createTaskWithId('Replace hallway bulb', 'quick-s1-1')
    assert.equal(records.size, 1)
    assert.equal(records.get('quick-s1-1').status, 'proposed')
    assert.equal(records.get('quick-s1-1').name, 'Replace hallway bulb')
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})

test('permanent task deletion forwards the task id and datastore result exactly once', async () => {
  const originalFreezr = globalThis.freezr
  const calls = []
  const deleted = { _id: 'task-delete', deleted: true }
  globalThis.freezr = {
    delete: async (...args) => {
      calls.push(args)
      return deleted
    }
  }

  try {
    assert.equal(await deleteTask('task-delete'), deleted)
    assert.deepEqual(calls, [['tasks', 'task-delete']])
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})
