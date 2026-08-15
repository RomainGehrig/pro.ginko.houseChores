// ABOUTME: The light/dark/system choice — its default, its copy, and how it reaches the document.
// ABOUTME: System is the absence of an override, so the stylesheet's media query stays in charge.

export const THEMES = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' }
]

export const DEFAULT_THEME = 'system'

const CACHE_KEY = 'houseChores.theme'

const NOTES = {
  system: 'Follows your device, and changes when it does.',
  light: 'Stays light, whatever your device is set to.',
  dark: 'Stays dark, whatever your device is set to.'
}

export function normalizeTheme (value) {
  return THEMES.some(theme => theme.key === value) ? value : DEFAULT_THEME
}

export function themeChoices (activeKey) {
  const active = normalizeTheme(activeKey)
  return THEMES.map(theme => ({ ...theme, active: theme.key === active }))
}

export const themeNote = theme => NOTES[normalizeTheme(theme)]

// Only an override is written. On System the attribute comes off entirely, so
// the device keeps deciding — including when it changes while the app is open.
export function applyTheme (theme, root = document?.documentElement) {
  const settled = normalizeTheme(theme)
  if (settled === DEFAULT_THEME) root?.removeAttribute?.('data-theme')
  else root?.setAttribute?.('data-theme', settled)
  return settled
}

const storage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Some browsers throw on the getter alone when storage is blocked.
    return null
  }
}

// The settings record is the truth, but it arrives over the network. This cache
// exists only so the first paint is already the right colour.
export function readCachedTheme (store = storage()) {
  try {
    return normalizeTheme(store?.getItem?.(CACHE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

export function cacheTheme (theme, store = storage()) {
  try {
    store?.setItem?.(CACHE_KEY, normalizeTheme(theme))
  } catch {
    // A blocked or full store costs one early repaint, never the setting itself.
  }
}
