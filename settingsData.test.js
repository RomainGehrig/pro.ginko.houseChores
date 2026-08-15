// ABOUTME: Tests the single app-settings record behind the Setup switches.
// ABOUTME: A missing or unreadable record must leave the app usable, not blocked.

import test from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_ID, aiSuggestionsEnabled, readSettings, storedTheme, writeSettings } from './settingsData.js'

function withFreezr (stub, run) {
  const original = globalThis.freezr
  globalThis.freezr = stub
  try { return run() } finally {
    if (original === undefined) delete globalThis.freezr
    else globalThis.freezr = original
  }
}

test('settings live in one record with a stable id', async () => {
  const calls = []
  const settings = await withFreezr({
    read: async (...args) => { calls.push(['read', ...args]); return { _id: SETTINGS_ID, aiSuggestions: true } }
  }, () => readSettings())

  assert.deepEqual(calls, [['read', 'settings', 'app']])
  assert.equal(settings.aiSuggestions, true)
})

test('a record that has never been written leaves the app usable', async () => {
  const missing = await withFreezr({ read: async () => { throw new Error('not found') } }, () => readSettings())
  assert.deepEqual(missing, {})
  assert.equal(aiSuggestionsEnabled(missing), false, 'suggestions are off until they are asked for')
  assert.equal(aiSuggestionsEnabled(null), false)
  assert.equal(aiSuggestionsEnabled({ aiSuggestions: true }), true)
})

test('a write upserts the one record rather than making another', async () => {
  const calls = []
  await withFreezr({
    create: async (...args) => { calls.push(args); return { _id: SETTINGS_ID } }
  }, () => writeSettings({ aiSuggestions: true }))

  assert.deepEqual(calls, [[
    'settings', { aiSuggestions: true }, { data_object_id: 'app', upsert: true }
  ]])
})

test('the theme is read from the same record, and anything unrecognised means System', () => {
  assert.equal(storedTheme({ theme: 'dark' }), 'dark')
  assert.equal(storedTheme({ theme: 'light' }), 'light')
  assert.equal(storedTheme({}), 'system', 'never chosen')
  assert.equal(storedTheme(null), 'system', 'record unreadable')
  assert.equal(storedTheme({ theme: 'sepia' }), 'system')
})
