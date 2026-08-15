// ABOUTME: Parses final hash routes independently from the DOM and app data.

const TODAY = { name: 'today', param: null }
const SIMPLE_ROUTES = new Set(['today', 'inbox', 'chores', 'archive', 'doing', 'log', 'setup'])
const PARAMETER_ROUTES = new Set(['chore', 'receipt'])
const SCREEN_NAMES = ['today', 'inbox', 'chores', 'setup', 'doing', 'review', 'log']
const ROUTE_SCREENS = {
  today: 'today',
  inbox: 'inbox',
  chores: 'chores',
  chore: 'chores',
  archive: 'chores',
  setup: 'setup',
  doing: 'doing',
  receipt: 'review',
  log: 'log'
}
const PRIMARY_ROUTE_BY_ROUTE = {
  today: 'today',
  inbox: 'inbox',
  chores: 'chores',
  chore: 'chores',
  archive: 'chores',
  setup: 'setup',
  log: 'log'
}
const LEGACY_ROUTES = {
  session: 'today',
  tasks: 'chores',
  doing: 'doing',
  review: 'receipt',
  history: 'log'
}

let refreshHistory = null
let loadReceipt = null
let selectChoresView = null
let requestedInitialRoute = false
let lastRenderedHash = null

function recognizedRoute (hash) {
  const value = String(hash || '')
  if (!value.startsWith('#/')) return null

  const segments = value.slice(2).split('/')
  if (segments.length === 1 && SIMPLE_ROUTES.has(segments[0])) {
    return { name: segments[0], param: null }
  }
  if (segments.length !== 2 || !PARAMETER_ROUTES.has(segments[0]) || !segments[1]) {
    return null
  }

  try {
    return { name: segments[0], param: decodeURIComponent(segments[1]) }
  } catch {
    return null
  }
}

export function parseRoute (hash) {
  return recognizedRoute(hash) || { ...TODAY }
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
  if (typeof document.querySelectorAll === 'function') return [...document.querySelectorAll('.bottom-nav [data-route]')]
  return ['today', 'inbox', 'chores', 'log', 'setup']
    .map(name => document.querySelector?.('.bottom-nav [data-route="' + name + '"]'))
    .filter(Boolean)
}

function navRouteName (item) {
  return item.dataset?.route || null
}

function activeNavRouteName (routeName) {
  return PRIMARY_ROUTE_BY_ROUTE[routeName] || null
}

function contextualItems () {
  if (typeof document === 'undefined') return []
  return ['doing', 'review']
    .map(name => document.querySelector?.('[data-context-route="' + name + '"]'))
    .filter(Boolean)
}

function contextualRouteIsCurrent (name, route) {
  return name === 'doing' ? route.name === 'doing' : route.name === 'receipt'
}

function renderContextualNavigation (route) {
  const items = contextualItems()
  for (const item of items) {
    const available = item.dataset?.available === 'true'
    item.hidden = !available || contextualRouteIsCurrent(item.dataset.contextRoute, route)
  }
  const nav = document.getElementById?.('workNav')
  if (nav) nav.hidden = !items.some(item => !item.hidden)
}

function renderRoute (route) {
  const screenName = ROUTE_SCREENS[route.name] || ROUTE_SCREENS.today
  if (typeof document === 'undefined') return route

  for (const name of SCREEN_NAMES) {
    const view = document.getElementById?.('view-' + name)
    if (view) view.style.display = name === screenName ? 'block' : 'none'
  }
  for (const item of navigationItems()) {
    const active = navRouteName(item) === activeNavRouteName(route.name)
    item.classList?.toggle('active', active)
    if (active) item.setAttribute?.('aria-current', 'page')
    else item.removeAttribute?.('aria-current')
  }
  renderContextualNavigation(route)

  const heading = document.getElementById?.('view-' + screenName)
    ?.querySelector?.('.route-heading[tabindex="-1"]')
  heading?.focus?.()
  if (route.name === 'log') refreshHistory?.()
  if (screenName === 'chores') selectChoresView?.(route.name)
  return route
}

function replaceCurrentHash (hash) {
  if (typeof window === 'undefined' || !window.location) return
  if (typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', hash)
    return
  }
  window.location.replace?.(hash)
}

function dispatchReceiptLoad (route) {
  if (route.name !== 'receipt' || !loadReceipt) return
  try {
    Promise.resolve(loadReceipt(route.param)).catch(() => {})
  } catch {
    // The injected loader owns inline error presentation.
  }
}

function dispatchHash ({ force = false } = {}) {
  const hash = typeof window === 'undefined' ? '' : window.location?.hash
  const route = parseRoute(hash)
  const canonicalHash = hashForRoute(route)
  if (typeof window !== 'undefined' && window.location && window.location.hash !== canonicalHash) {
    replaceCurrentHash(canonicalHash)
  }
  if (force || lastRenderedHash !== canonicalHash) {
    lastRenderedHash = canonicalHash
    renderRoute(route)
    dispatchReceiptLoad(route)
  }
  return route
}

export function initRouter ({ onLogRoute, onReceiptRoute, onChoresRoute } = {}) {
  refreshHistory = onLogRoute || null
  loadReceipt = onReceiptRoute || null
  selectChoresView = onChoresRoute || null
  const initialHash = typeof window === 'undefined' ? '' : window.location?.hash
  requestedInitialRoute = Boolean(recognizedRoute(initialHash))
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

export function setNavVisible (name, visible, param = null) {
  if (typeof document === 'undefined') return
  const item = document.querySelector?.('[data-context-route="' + name + '"]')
  if (!item) return
  item.dataset.available = String(Boolean(visible))
  if (name === 'review' && param) {
    item.setAttribute?.('href', hashForRoute({ name: 'receipt', param: String(param) }))
  }
  const currentHash = lastRenderedHash ||
    (typeof window === 'undefined' ? '' : window.location?.hash)
  renderContextualNavigation(parseRoute(currentHash))
}
