// ABOUTME: Unit tests for AI enrichment prompt construction.
// ABOUTME: Run with: node --test aiEnrich.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnrichmentPrompt } from './aiEnrich.js'

test('prompt uses supplied active categories and no fixed legacy list', () => {
  const prompt = buildEnrichmentPrompt([{ name: 'Clean sink' }], ['Home care', 'Admin'])

  assert.match(prompt, /Home care, Admin/)
  assert.doesNotMatch(prompt, /Run Errands/)
})
