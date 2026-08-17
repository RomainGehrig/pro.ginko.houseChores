// ABOUTME: Pure route-contract tests for the hash router.
// ABOUTME: Keeps parsing independent from DOM, history loading, and session persistence.

import test from 'node:test'
import assert from 'node:assert/strict'
import { hasRequestedRoute, initRouter, parseRoute, setNavVisible, showView } from './router.js'

const screenNames = ['today', 'inbox', 'chores', 'setup', 'doing', 'review', 'log']
const primaryRoutes = ['today', 'inbox', 'chores', 'log', 'setup']

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
  const workNav = { hidden: true }
  const contextual = new Map(['doing', 'review'].map(route => {
    const attributes = new Map()
    return [route, {
      hidden: true,
      dataset: { contextRoute: route },
      setAttribute: (key, value) => attributes.set(key, value),
      getAttribute: key => attributes.get(key) || null
    }]
  }))
  globalThis.document = {
    getElementById: id => id === 'workNav' ? workNav : views.get(id.slice('view-'.length)) || null,
    querySelectorAll: selector => selector === '.bottom-nav [data-route]' ? [...nav.values()] : [],
    querySelector: selector => {
      const contextRoute = selector.match(/data-context-route="([^"]+)"/)?.[1]
      if (contextRoute) return contextual.get(contextRoute) || null
      return nav.get(selector.match(/data-route="([^"]+)"/)?.[1]) || null
    }
  }
  let currentHash = hash
  const pushes = []
  const replaces = []
  const location = {
    get hash () { return currentHash },
    set hash (value) {
      currentHash = value
      pushes.push(value)
    }
  }
  globalThis.window = {
    location,
    history: {
      replaceState: (_state, _title, value) => {
        currentHash = value
        replaces.push(value)
      }
    },
    addEventListener: (type, listener) => listeners.set(type, listener)
  }
  return { views, nav, contextual, workNav, listeners, pushes, replaces }
}

test('parseRoute recognizes every final route and decodes its parameter', () => {
  const routes = [
    // A cold open lands on the ledger: the chore you are looking for is more
    // often a chore you already have than a round you are about to start.
    ['', { name: 'chores', param: null }],
    ['#', { name: 'chores', param: null }],
    ['#/', { name: 'chores', param: null }],
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

test('parseRoute falls back to chores for malformed, missing, unknown, and extra routes', () => {
  for (const hash of [
    '#/unknown', '#/chore', '#/receipt', '#/chore/', '#/receipt/',
    '#/chore/a/extra', '#/today/extra', 'today', '#/chore/%E0%A4%A'
  ]) {
    assert.deepEqual(parseRoute(hash), { name: 'chores', param: null }, hash)
  }
})

test('each final route shows its Stage 3 screen, focuses its heading, and canonicalizes fallback', () => {
  const expectedScreens = {
    today: 'today', inbox: 'inbox', chores: 'chores', chore: 'chores', archive: 'chores',
    setup: 'setup', doing: 'doing', receipt: 'review', log: 'log'
  }

  for (const [route, screen] of Object.entries(expectedScreens)) {
    const hash = route === 'chore' ? '#/chore/kitchen' : route === 'receipt'
      ? '#/receipt/session' : '#/' + route
    const dom = installRouterDom(hash)
    initRouter()
    assert.equal(dom.views.get(screen).style.display, '', hash)
    assert.equal(dom.views.get(screen).heading.focusCalls, 1, hash)
  }

  const fallback = installRouterDom('#/not-a-route')
  initRouter()
  assert.equal(window.location.hash, '#/chores')
  assert.equal(fallback.views.get('chores').style.display, '')
  assert.equal(fallback.views.get('chores').heading.focusCalls, 1)
})

test('primary navigation maps routes to the sole factual current destination', () => {
  const expectedPrimary = {
    today: 'today', inbox: 'inbox', chores: 'chores', chore: 'chores', archive: 'chores',
    setup: 'setup', log: 'log', doing: null, receipt: null
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

  assert.equal(dom.views.get('log').style.display, '')
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
    assert.equal(dom.views.get(screen).style.display, '', caller)
  }

  assert.doesNotThrow(() => setNavVisible('doing', true))
  assert.doesNotThrow(() => setNavVisible('review', false))
})

test('contextual work links leave and return to hydrated Doing and Review without replacing edits', () => {
  const dom = installRouterDom('#/doing')
  initRouter()
  dom.views.get('doing').draftValue = 'pause note in progress'
  setNavVisible('doing', true)

  assert.equal(dom.contextual.get('doing').hidden, true)
  showView('today')
  assert.equal(dom.contextual.get('doing').hidden, false)
  assert.equal(dom.workNav.hidden, false)
  showView('doing')
  assert.equal(dom.contextual.get('doing').hidden, true)
  assert.equal(dom.views.get('doing').draftValue, 'pause note in progress')

  dom.views.get('review').draftValue = 'edited review notes'
  setNavVisible('review', true, 'session/42')
  showView('review', 'session/42')
  assert.equal(dom.contextual.get('review').hidden, true)
  showView('chores')
  assert.equal(dom.contextual.get('review').hidden, false)
  assert.equal(dom.contextual.get('review').getAttribute('href'), '#/receipt/session%2F42')
  showView('review', 'session/42')
  assert.equal(dom.contextual.get('review').hidden, true)
  assert.equal(dom.views.get('review').draftValue, 'edited review notes')
})

test('ending Doing and finishing Review clear their contextual return controls', () => {
  const dom = installRouterDom('#/today')
  initRouter()
  setNavVisible('doing', true)
  setNavVisible('review', true, 'completed-session')
  assert.equal(dom.workNav.hidden, false)

  setNavVisible('doing', false)
  assert.equal(dom.contextual.get('doing').hidden, true)
  assert.equal(dom.contextual.get('review').hidden, false)
  setNavVisible('review', false)
  assert.equal(dom.contextual.get('review').hidden, true)
  assert.equal(dom.workNav.hidden, true)
})

test('receipt dispatch passes the decoded id to the injected loader', async () => {
  installRouterDom('#/receipt/session%2F42')
  const loaded = []
  initRouter({ onReceiptRoute: async id => { loaded.push(id) } })
  await Promise.resolve()

  assert.deepEqual(loaded, ['session/42'])
})

test('boot fallback replaces empty and invalid history without creating a Back bounce', () => {
  for (const hash of ['', '#/today/extra']) {
    const dom = installRouterDom(hash)
    initRouter()

    assert.deepEqual(dom.replaces, ['#/chores'], hash)
    assert.deepEqual(dom.pushes, [], hash)
    dom.listeners.get('hashchange')()
    assert.deepEqual(dom.replaces, ['#/chores'], hash)
    assert.deepEqual(dom.pushes, [], hash)
  }
})

test('only a recognized initial route suppresses automatic unfinished-session display', () => {
  for (const hash of ['', '#', '#/', '#/unknown', '#/receipt', '#/today/extra', 'today', '#/chore/%E0%A4%A']) {
    installRouterDom(hash)
    initRouter()
    assert.equal(hasRequestedRoute(), false, hash)
  }

  for (const hash of ['#/today', '#/inbox', '#/doing', '#/chore/kitchen', '#/receipt/session%2F42']) {
    installRouterDom(hash)
    initRouter()
    assert.equal(hasRequestedRoute(), true, hash)
  }
})

test('the archive is a view of the Chores screen, and the screen is told which one', () => {
  const seen = []
  installRouterDom('#/archive')
  initRouter({ onChoresRoute: name => seen.push(name) })
  assert.deepEqual(seen, ['archive'])

  installRouterDom('#/chores')
  initRouter({ onChoresRoute: name => seen.push(name) })
  assert.deepEqual(seen, ['archive', 'chores'])
})
