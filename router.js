// ABOUTME: Parses final hash routes independently from the DOM and app data.

const TODAY = { name: 'today', param: null }
const SIMPLE_ROUTES = new Set(['today', 'inbox', 'chores', 'archive', 'doing', 'log', 'setup'])
const PARAMETER_ROUTES = new Set(['chore', 'receipt'])

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
