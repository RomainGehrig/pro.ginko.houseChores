import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNewTaskRecord, createTaskWithId } from './taskData.js'

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
    status: 'proposed',
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null
  })
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
