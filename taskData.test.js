import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNewTaskRecord } from './taskData.js'

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
