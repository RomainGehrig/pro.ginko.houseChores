// ABOUTME: Parses final hash routes independently from the DOM and app data.

const TODAY = { name: 'today', param: null }
const SIMPLE_ROUTES = new Set(['today', 'inbox', 'chores', 'archive', 'doing', 'log', 'setup'])
const PARAMETER_ROUTES = new Set(['chore', 'receipt'])
const VIEW_NAMES = ['tasks', 'session', 'doing', 'review', 'history']
const ROUTE_VIEWS = {
  today: 'session',
  chores: 'tasks',
  inbox: 'tasks',
  chore: 'tasks',
  archive: 'tasks',
  setup: 'tasks',
  doing: 'doing',
  receipt: 'review',
  log: 'history'
}
const LEGACY_ROUTES = {
  session: 'today',
  tasks: 'chores',
  doing: 'doing',
  review: 'receipt',
  history: 'log'
}

let refreshHistory = null
let requestedInitialRoute = false
let lastRenderedHash = null

export function parseRoute (hash) {
  const value = String(hash || '')
  if (value === '' || value === '#' || value === '#/') return { ...TODAY }
  if (!value.startsWith('#/')) return { ...TODAY }

  const segments = value.slice(2).split('/')
  if (segments.length === 1 && SIMPLE_ROUTES.has(segments[0])) {
    return { name: segments[0], param: null }
  }
  if (segments.length !== 2 || !PARAMETER_ROUTES.has(segments[0]) || !segments[1]) {
    return { ...TODAY }
  }

  try {
    return { name: segments[0], param: decodeURIComponent(segments[1]) }
  } catch {
    return { ...TODAY }
  }
}

function hashForRoute (route) {
  if (PARAMETER_ROUTES.has(route.name) && route.param) {
    return '#/' + route.name + '/' + encodeURIComponent(route.param)
  }
  return '#/' + (SIMPLE_ROUTES.has(route.name) ? route.name : 'today')
}

function routeForView (name, param) {
  const routeName = LEGACY_ROUTES[name] || name
  return {
    name: routeName,
    param: PARAMETER_ROUTES.has(routeName) && param ? String(param) : null
  }
}

function navigationItems () {
  if (typeof document === 'undefined') return []
  if (typeof document.querySelectorAll === 'function') return [...document.querySelectorAll('.nav-btn')]
  return VIEW_NAMES.map(name => document.querySelector?.('.nav-btn[data-view="' + name + '"]')).filter(Boolean)
}

function navRouteName (item) {
  return item.dataset?.route || LEGACY_ROUTES[item.dataset?.view] || null
}

function renderRoute (route) {
  const viewName = ROUTE_VIEWS[route.name] || ROUTE_VIEWS.today
  if (typeof document === 'undefined') return route

  for (const name of VIEW_NAMES) {
    const view = document.getElementById?.('view-' + name)
    if (view) view.style.display = name === viewName ? 'block' : 'none'
  }
  for (const item of navigationItems()) {
    const active = navRouteName(item) === route.name
    item.classList?.toggle('active', active)
    if (active) item.setAttribute?.('aria-current', 'page')
    else item.removeAttribute?.('aria-current')
    if (route.name === 'receipt' && item.dataset?.view === 'review') {
      item.setAttribute?.('href', hashForRoute(route))
    }
  }

  const heading = document.getElementById?.('view-' + viewName)
    ?.querySelector?.('.route-heading[tabindex="-1"]')
  heading?.focus?.()
  if (route.name === 'log') refreshHistory?.()
  return route
}

function dispatchHash ({ force = false } = {}) {
  const hash = typeof window === 'undefined' ? '' : window.location?.hash
  const route = parseRoute(hash)
  const canonicalHash = hashForRoute(route)
  if (typeof window !== 'undefined' && window.location && window.location.hash !== canonicalHash) {
    window.location.hash = canonicalHash
  }
  if (force || lastRenderedHash !== canonicalHash) {
    lastRenderedHash = canonicalHash
    renderRoute(route)
  }
  return route
}

export function initRouter ({ onLogRoute } = {}) {
  refreshHistory = onLogRoute || null
  const initialHash = typeof window === 'undefined' ? '' : window.location?.hash
  requestedInitialRoute = Boolean(initialHash && initialHash !== '#')
  lastRenderedHash = null
  if (typeof window !== 'undefined') window.addEventListener?.('hashchange', dispatchHash)
  return dispatchHash({ force: true })
}

export function hasRequestedRoute () {
  return requestedInitialRoute
}

export function showView (name, param) {
  const route = routeForView(name, param)
  const canonicalHash = hashForRoute(route)
  if (typeof window !== 'undefined' && window.location && window.location.hash !== canonicalHash) {
    window.location.hash = canonicalHash
  }
  lastRenderedHash = canonicalHash
  return renderRoute(route)
}

export function setNavVisible (name, visible) {
  if (typeof document === 'undefined') return
  const item = document.querySelector?.('.nav-btn[data-view="' + name + '"]')
  if (item) item.style.display = visible ? 'inline-block' : 'none'
}
