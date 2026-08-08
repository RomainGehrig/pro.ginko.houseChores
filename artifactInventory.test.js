// ABOUTME: Verifies install-time file inventory and static selector fallbacks.
// ABOUTME: Prevents imported modules/tests or legacy category choices from being omitted unnoticed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

test('manifest inventories every top-level JavaScript artifact', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'))
  const actual = (await readdir(new URL('.', import.meta.url)))
    .filter(path => path.endsWith('.js'))
    .sort()
  const declared = manifest.files
    .map(file => file.path)
    .filter(path => path.endsWith('.js'))
    .sort()

  assert.deepEqual(declared, actual)
})

test('static category filter contains only the empty dynamic-list fallback', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const selectMarkup = html.match(/<select id="categoryFilter">([\s\S]*?)<\/select>/)?.[1] || ''
  const optionValues = [...selectMarkup.matchAll(/<option\s+value="([^"]*)"/g)]
    .map(match => match[1])

  assert.deepEqual(optionValues, [''])
})

test('static budget choices mark only their figures as instrument text', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const budgetMarkup = [...html.matchAll(/<button class="time-btn"[^>]*>(.*?)<\/button>/g)]
    .map(match => match[1])

  assert.deepEqual(budgetMarkup, [
    '<span class="fig">5</span> min',
    '<span class="fig">15</span> min',
    '<span class="fig">30</span> min'
  ])
})

test('header navigation uses canonical hash anchors and every current screen has a route focus heading', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const nav = [...html.matchAll(/<a class="nav-btn" data-view="([^"]+)" href="([^"]+)"/g)]
    .map(match => [match[1], match[2]])
  const focusHeadings = [...html.matchAll(/<h2 class="route-heading" tabindex="-1">/g)]

  assert.deepEqual(nav, [
    ['tasks', '#/chores'],
    ['session', '#/today'],
    ['history', '#/log'],
    ['doing', '#/doing'],
    ['review', '#/receipt/session']
  ])
  assert.equal(focusHeadings.length, 5)
})
