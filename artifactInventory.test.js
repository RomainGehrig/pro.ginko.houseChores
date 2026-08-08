// ABOUTME: Verifies install-time file inventory and static selector fallbacks.
// ABOUTME: Prevents imported modules/tests or legacy category choices from being omitted unnoticed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

test('manifest inventories every JavaScript artifact including nested route renderers', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'))
  const actual = (await readdir(new URL('.', import.meta.url), { recursive: true }))
    .filter(path => path.endsWith('.js') && !path.startsWith('.worktrees/'))
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

test('route shell declares four primary canonical anchors, eight focus headings, and static live regions', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const navMarkup = html.match(/<nav class="bottom-nav" aria-label="Primary">([\s\S]*?)<\/nav>/)?.[1] || ''
  const nav = [...navMarkup.matchAll(/<a[^>]*data-route="([^"]+)"[^>]*href="([^"]+)"[^>]*>/g)]
    .map(match => [match[1], match[2]])
  const screenIds = [...html.matchAll(/<section id="(view-[^"]+)" class="view"/g)].map(match => match[1])
  const focusHeadings = [...html.matchAll(/<h2 class="route-heading" tabindex="-1">/g)]

  assert.deepEqual(nav, [
    ['today', '#/today'],
    ['inbox', '#/inbox'],
    ['chores', '#/chores'],
    ['log', '#/log']
  ])
  assert.deepEqual(screenIds, [
    'view-today', 'view-inbox', 'view-chores', 'view-archive',
    'view-setup', 'view-doing', 'view-review', 'view-log'
  ])
  assert.equal(focusHeadings.length, 8)
  assert.match(html, /id="sessionStatus"[^>]*role="status"/)
  assert.match(html, /id="choresStatus"[^>]*role="status"/)
  assert.match(html, /id="archiveStatus"[^>]*role="status"/)
  assert.match(html, /id="undoToast"[^>]*hidden[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /id="undoToastMessage"/)
  assert.match(html, /id="undoToastButton"[^>]*>Undo<\/button>/)
  assert.doesNotMatch(html, /data-view=/)
})

test('bottom navigation uses the 45px target floor, fixed safe-area placement, content clearance, and reduced motion', async () => {
  const css = await readFile(new URL('./index.css', import.meta.url), 'utf8')
  const navRules = css.match(/\.bottom-nav\s+a\s*\{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(navRules, /min-height:\s*45px;/)
  assert.match(css, /\.bottom-nav\s*\{[\s\S]*position:\s*fixed;/)
  assert.match(css, /\.bottom-nav\s*\{[\s\S]*safe-area-inset-bottom/)
  assert.match(css, /#app\s*\{[\s\S]*padding:[^;]*safe-area-inset-bottom/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
})

test('all view transitions use the hash router instead of the retired view router', async () => {
  const sources = await Promise.all([
    'index.js', 'sessionView.js', 'doingView.js', 'reviewView.js'
  ].map(path => readFile(new URL('./' + path, import.meta.url), 'utf8')))

  for (const source of sources) assert.doesNotMatch(source, /viewRouter\.js/)
})
