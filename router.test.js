// ABOUTME: Pure route-contract tests for the hash router.
// ABOUTME: Keeps parsing independent from DOM, history loading, and session persistence.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute } from './router.js'

test('parseRoute recognizes every final route and decodes its parameter', () => {
  const routes = [
    ['', { name: 'today', param: null }],
    ['#', { name: 'today', param: null }],
    ['#/', { name: 'today', param: null }],
    ['#/today', { name: 'today', param: null }],
    ['#/inbox', { name: 'inbox', param: null }],
    ['#/chores', { name: 'chores', param: null }],
    ['#/archive', { name: 'archive', param: null }],
    ['#/doing', { name: 'doing', param: null }],
    ['#/log', { name: 'log', param: null }],
    ['#/setup', { name: 'setup', param: null }],
    ['#/chore/kitchen%20floor', { name: 'chore', param: 'kitchen floor' }],
    ['#/receipt/session%2F42', { name: 'receipt', param: 'session/42' }]
  ]

  for (const [hash, expected] of routes) assert.deepEqual(parseRoute(hash), expected, hash)
})

test('parseRoute falls back to today for malformed, missing, unknown, and extra routes', () => {
  for (const hash of [
    '#/unknown', '#/chore', '#/receipt', '#/chore/', '#/receipt/',
    '#/chore/a/extra', '#/today/extra', 'today', '#/chore/%E0%A4%A'
  ]) {
    assert.deepEqual(parseRoute(hash), { name: 'today', param: null }, hash)
  }
})
