// ABOUTME: Unit tests for AI enrichment prompt construction.
// ABOUTME: Run with: node --test aiEnrich.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEnrichmentPrompt,
  enrichTasks,
  normalizeEnrichmentSuggestion
} from './aiEnrich.js'

test('prompt uses supplied active categories and no fixed legacy list', () => {
  const prompt = buildEnrichmentPrompt([{ name: 'Clean sink' }], ['Home care', 'Admin'])

  assert.match(prompt, /Home care, Admin/)
  assert.doesNotMatch(prompt, /Run Errands/)
})

test('prompt requests reviewable typed schedules without a scheduled date', () => {
  const prompt = buildEnrichmentPrompt([{ name: 'Vacuum every Friday' }], ['Clean'])

  assert.match(prompt, /"type": "periodic"/)
  assert.match(prompt, /"type": "fixed"/)
  assert.match(prompt, /weekdays/)
  assert.match(prompt, /Do not suggest a scheduledDate/)
})

test('keeps valid schedule suggestions and drops invalid ones', () => {
  assert.deepEqual(normalizeEnrichmentSuggestion({
    category: 'Clean',
    estimatedDuration: 10,
    scheduledDate: '2026-08-21',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] } }
  }), {
    category: 'Clean',
    estimatedDuration: 10,
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] } }
  })

  assert.equal(normalizeEnrichmentSuggestion({
    category: 'Clean', schedule: { type: 'fixed', pattern: { kind: 'cron' } }
  }).schedule, null)
})

test('discards null suggestions and malformed weekday arrays without aborting the AI batch', async () => {
  const originalFreezr = globalThis.freezr
  globalThis.freezr = {
    llm: {
      ask: async () => ({
        success: true,
        response: [
          null,
          {
            category: 'Clean',
            estimatedDuration: 10,
            schedule: {
              type: 'fixed',
              pattern: { kind: 'weekdays', weekdays: 'Friday' }
            }
          },
          {
            category: 'Admin',
            estimatedDuration: 5,
            schedule: { type: 'periodic', every: 1, unit: 'week' }
          }
        ]
      })
    }
  }

  try {
    assert.equal(normalizeEnrichmentSuggestion(null), null)
    assert.deepEqual(await enrichTasks([
      { name: 'Unknown suggestion' },
      { name: 'Vacuum Friday' },
      { name: 'Pay bills weekly' }
    ], ['Clean', 'Admin']), [
      null,
      { category: 'Clean', estimatedDuration: 10, schedule: null },
      {
        category: 'Admin',
        estimatedDuration: 5,
        schedule: { type: 'periodic', every: 1, unit: 'week' }
      }
    ])
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})
