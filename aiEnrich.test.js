// ABOUTME: Unit tests for AI enrichment prompt construction.
// ABOUTME: Run with: node --test aiEnrich.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEnrichmentPrompt,
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
