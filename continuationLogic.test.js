// ABOUTME: Tests paused-session suggestions, search, and selection budgets.
// ABOUTME: Keeps deliberate search independent from automatic budget limits.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeContinuationSuggestionEntries,
  searchContinuationTasks,
  suggestContinuationTasks,
  suggestionSelectionFits
} from './continuationLogic.js'

const tasks = [
  { _id: 'short', name: 'Clean sink', status: 'active', estimatedDuration: 5, scheduledDate: '2026-08-01' },
  { _id: 'long', name: 'Clean garage', status: 'approved_recurring', estimatedDuration: 30, scheduledDate: '2026-07-01' },
  { _id: 'draft', name: 'Clean attic', status: 'proposed', estimatedDuration: 2 },
  { _id: 'used', name: 'Clean desk', status: 'active', estimatedDuration: 3, scheduledDate: '2026-06-01' }
]

test('suggestions are active, unused, prioritized, and fit remaining time', () => {
  assert.deepEqual(
    suggestContinuationTasks(tasks, ['used'], 10 * 60000).map(task => task._id),
    ['short']
  )
})

test('search ignores budget but excludes drafts and attached tasks', () => {
  assert.deepEqual(
    searchContinuationTasks(tasks, 'garage', ['used']).map(task => task._id),
    ['long']
  )
})

test('several suggestions consume the allowance cumulatively', () => {
  assert.equal(suggestionSelectionFits(
    [{ estimatedDuration: 6 }], { estimatedDuration: 4 }, 10 * 60000
  ), true)
  assert.equal(suggestionSelectionFits(
    [{ estimatedDuration: 6 }], { estimatedDuration: 5 }, 10 * 60000
  ), false)
})

test('normalizes persisted suggestion snapshots and ignores malformed duplicates', () => {
  assert.deepEqual(normalizeContinuationSuggestionEntries([
    { taskId: 'a', estimatedDurationMinutes: 4 },
    { taskId: 'a', estimatedDurationMinutes: 9 },
    { taskId: '', estimatedDurationMinutes: 3 },
    { taskId: 'b', estimatedDurationMinutes: 0 }
  ]), [{ taskId: 'a', estimatedDurationMinutes: 4 }])
  assert.deepEqual(normalizeContinuationSuggestionEntries(null), [])
})
