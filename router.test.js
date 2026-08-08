// ABOUTME: Pure route-contract tests for the hash router.
// ABOUTME: Keeps parsing independent from DOM, history loading, and session persistence.

import test from 'node:test'
import assert from 'node:assert/strict'
import { initRouter, parseRoute, showView } from './router.js'

function installRouterDom (hash = '') {
  const views = new Map(['tasks', 'session', 'doing', 'review', 'history'].map(name => {
    const heading = { focusCalls: 0, focus () { this.focusCalls++ } }
    return [name, { style: {}, querySelector: () => heading, heading }]
  }))
  const nav = new Map(['tasks', 'session', 'doing', 'review', 'history'].map(name => {
    const attributes = new Map()
    return [name, {
      style: {},
      dataset: { view: name },
      classList: { toggle () {} },
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
      getAttribute: key => attributes.get(key) || null
    }]
  }))
  const listeners = new Map()
  globalThis.document = {
    getElementById: id => views.get(id.slice('view-'.length)) || null,
    querySelectorAll: selector => selector === '.nav-btn' ? [...nav.values()] : [],
    querySelector: selector => nav.get(selector.match(/data-view="([^"]+)"/)?.[1]) || null
  }
  globalThis.window = {
    location: { hash },
    addEventListener: (type, listener) => listeners.set(type, listener)
  }
  return { views, nav, listeners }
}

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

test('router canonicalizes unknown hashes, bridges final routes, and focuses the current heading', () => {
  const dom = installRouterDom('#/not-a-route')
  initRouter()

  assert.equal(window.location.hash, '#/today')
  assert.equal(dom.views.get('session').style.display, 'block')
  assert.equal(dom.views.get('session').heading.focusCalls, 1)
  assert.equal(dom.nav.get('session').getAttribute('aria-current'), 'page')
  assert.equal(dom.nav.get('tasks').getAttribute('aria-current'), null)

  showView('review', 'session/42')
  assert.equal(window.location.hash, '#/receipt/session%2F42')
  assert.equal(dom.views.get('review').style.display, 'block')
})

test('every route bridged to Tasks marks Chores as the sole current navigation item', () => {
  for (const hash of ['#/chores', '#/inbox', '#/chore/kitchen', '#/archive', '#/setup']) {
    const dom = installRouterDom(hash)
    initRouter()

    const current = [...dom.nav.entries()]
      .filter(([, item]) => item.getAttribute('aria-current') === 'page')
      .map(([name]) => name)
    assert.deepEqual(current, ['tasks'], hash)
  }
})

test('router refreshes history only when dispatching the log route', () => {
  const dom = installRouterDom('#/log')
  let refreshes = 0

  initRouter({ onLogRoute: () => { refreshes++ } })

  assert.equal(dom.views.get('history').style.display, 'block')
  assert.equal(refreshes, 1)
  showView('tasks')
  assert.equal(refreshes, 1)
})
