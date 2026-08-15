// ABOUTME: Tests the theme choice — its default, how it is stated and how it reaches the document.
// ABOUTME: Guards that System means the system decides, not a value the app quietly stores instead.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  cacheTheme,
  normalizeTheme,
  readCachedTheme,
  themeChoices,
  themeNote
} from './theme.js'

const fakeRoot = () => {
  const attributes = new Map()
  return {
    attributes,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    getAttribute: name => attributes.get(name) ?? null
  }
}

const fakeStore = (initial = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  }
}

test('three themes are offered and System is the one the app starts on', () => {
  assert.deepEqual(THEMES.map(theme => [theme.key, theme.label]), [
    ['system', 'System'], ['light', 'Light'], ['dark', 'Dark']
  ])
  assert.equal(DEFAULT_THEME, 'system')
  assert.equal(normalizeTheme(undefined), 'system')
})

test('anything the app cannot recognise falls back to letting the system decide', () => {
  for (const value of [null, '', 'Dark', 'sepia', 42, {}]) {
    assert.equal(normalizeTheme(value), 'system', String(value))
  }
  assert.equal(normalizeTheme('light'), 'light')
  assert.equal(normalizeTheme('dark'), 'dark')
})

test('the choices mark the one in force', () => {
  assert.deepEqual(themeChoices('dark').map(choice => [choice.key, choice.active]), [
    ['system', false], ['light', false], ['dark', true]
  ])
  assert.deepEqual(themeChoices('nonsense').map(choice => choice.active), [true, false, false])
})

test('each choice says what it does, without selling it', () => {
  assert.equal(themeNote('system'), 'Follows your device, and changes when it does.')
  assert.equal(themeNote('light'), 'Stays light, whatever your device is set to.')
  assert.equal(themeNote('dark'), 'Stays dark, whatever your device is set to.')
})

// System is the absence of an override: the stylesheet's own media query is
// left in charge, rather than the app freezing today's answer into an attribute.
test('an override is stamped on the document and System takes the stamp away', () => {
  const root = fakeRoot()

  applyTheme('dark', root)
  assert.equal(root.getAttribute('data-theme'), 'dark')

  applyTheme('light', root)
  assert.equal(root.getAttribute('data-theme'), 'light')

  applyTheme('system', root)
  assert.equal(root.getAttribute('data-theme'), null)

  applyTheme('sepia', root)
  assert.equal(root.getAttribute('data-theme'), null)
})

test('applying a theme reports the theme it settled on', () => {
  assert.equal(applyTheme('dark', fakeRoot()), 'dark')
  assert.equal(applyTheme('sepia', fakeRoot()), 'system')
})

test('a missing document is not a reason to fail', () => {
  assert.equal(applyTheme('dark', null), 'dark')
})

// The record is the truth, but it arrives over the network. The cache exists so
// the first paint is already the right colour, never so it can disagree.
test('the choice is cached locally and read back, and a bad cache reads as System', () => {
  const store = fakeStore()
  cacheTheme('dark', store)
  assert.equal(store.getItem('houseChores.theme'), 'dark')
  assert.equal(readCachedTheme(store), 'dark')

  cacheTheme('system', store)
  assert.equal(readCachedTheme(store), 'system')

  assert.equal(readCachedTheme(fakeStore({ 'houseChores.theme': 'sepia' })), 'system')
  assert.equal(readCachedTheme(fakeStore()), 'system')
})

test('storage the browser refuses is not a reason to fail', () => {
  const refusing = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') }
  }
  assert.equal(readCachedTheme(refusing), 'system')
  assert.doesNotThrow(() => cacheTheme('dark', refusing))
  assert.equal(readCachedTheme(null), 'system')
})
