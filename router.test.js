// ABOUTME: Pure route-contract tests for the hash router.
// ABOUTME: Keeps parsing independent from DOM, history loading, and session persistence.

import test from 'node:test'
import assert from 'node:assert/strict'
import { initRouter, parseRoute, setNavVisible, showView } from './router.js'

const screenNames = ['today', 'inbox', 'chores', 'archive', 'setup', 'doing', 'review', 'log']
const primaryRoutes = ['today', 'inbox', 'chores', 'log']

function installRouterDom (hash = '') {
  const views = new Map(screenNames.map(name => {
    const heading = { focusCalls: 0, focus () { this.focusCalls++ } }
    return [name, { style: {}, querySelector: () => heading, heading }]
  }))
  const nav = new Map(primaryRoutes.map(route => {
    const attributes = new Map()
    return [route, {
      style: {},
      dataset: { route },
      classList: { toggle () {} },
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
      getAttribute: key => attributes.get(key) || null
    }]
  }))
  const listeners = new Map()
  globalThis.document = {
    getElementById: id => views.get(id.slice('view-'.length)) || null,
    querySelectorAll: selector => selector === '.bottom-nav [data-route]' ? [...nav.values()] : [],
    querySelector: selector => nav.get(selector.match(/data-route="([^"]+)"/)?.[1]) || null
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

test('each final route shows its Stage 3 screen, focuses its heading, and canonicalizes fallback', () => {
  const expectedScreens = {
    today: 'today', inbox: 'inbox', chores: 'chores', chore: 'chores', archive: 'archive',
    setup: 'setup', doing: 'doing', receipt: 'review', log: 'log'
  }

  for (const [route, screen] of Object.entries(expectedScreens)) {
    const hash = route === 'chore' ? '#/chore/kitchen' : route === 'receipt'
      ? '#/receipt/session' : '#/' + route
    const dom = installRouterDom(hash)
    initRouter()
    assert.equal(dom.views.get(screen).style.display, 'block', hash)
    assert.equal(dom.views.get(screen).heading.focusCalls, 1, hash)
  }

  const fallback = installRouterDom('#/not-a-route')
  initRouter()
  assert.equal(window.location.hash, '#/today')
  assert.equal(fallback.views.get('today').style.display, 'block')
  assert.equal(fallback.views.get('today').heading.focusCalls, 1)
})

test('primary navigation maps routes to the sole factual current destination', () => {
  const expectedPrimary = {
    today: 'today', inbox: 'inbox', chores: 'chores', chore: 'chores', archive: 'chores',
    setup: 'chores', log: 'log', doing: null, receipt: null
  }

  for (const [route, primary] of Object.entries(expectedPrimary)) {
    const hash = route === 'chore' ? '#/chore/kitchen' : route === 'receipt'
      ? '#/receipt/session' : '#/' + route
    const dom = installRouterDom(hash)
    initRouter()
    const current = [...dom.nav.entries()]
      .filter(([, item]) => item.getAttribute('aria-current') === 'page')
      .map(([name]) => name)
    assert.deepEqual(current, primary ? [primary] : [], hash)
  }
})

test('router refreshes history only when dispatching the log route', () => {
  const dom = installRouterDom('#/log')
  let refreshes = 0

  initRouter({ onLogRoute: () => { refreshes++ } })

  assert.equal(dom.views.get('log').style.display, 'block')
  assert.equal(refreshes, 1)
  showView('tasks')
  assert.equal(refreshes, 1)
})

test('legacy showView callers bridge to their final screen routes and absent primary controls safely no-op', () => {
  const cases = [
    ['session', '#/today', 'today'], ['tasks', '#/chores', 'chores'], ['doing', '#/doing', 'doing'],
    ['review', '#/receipt/session%2F42', 'review'], ['history', '#/log', 'log']
  ]

  for (const [caller, hash, screen] of cases) {
    const dom = installRouterDom('#/today')
    initRouter()
    showView(caller, caller === 'review' ? 'session/42' : undefined)
    assert.equal(window.location.hash, hash, caller)
    assert.equal(dom.views.get(screen).style.display, 'block', caller)
  }

  assert.doesNotThrow(() => setNavVisible('doing', true))
  assert.doesNotThrow(() => setNavVisible('review', false))
})
