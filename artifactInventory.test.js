// ABOUTME: Verifies install-time file inventory and static selector fallbacks.
// ABOUTME: Prevents modules, category choices or README screenshots from going missing unnoticed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'

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

// A README that shows the app is the first thing anyone sees of it, and a broken
// image is the loudest possible way to say nobody looked. Renaming or moving a
// screenshot should fail here rather than on someone else's screen.
test('every screenshot the README points at exists and is described', async () => {
  const readme = await readFile(new URL('./README.md', import.meta.url), 'utf8')
  const images = [...readme.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)]
    .map(match => ({ alt: match[1], path: match[2] }))
    .filter(image => !/^https?:/.test(image.path))

  assert.ok(images.length > 0, 'expected the README to show the app, not only describe it')
  for (const { alt, path } of images) {
    const present = await stat(new URL('./' + path, import.meta.url)).then(() => true, () => false)
    assert.ok(present, 'the README points at ' + path + ', which is not in the repo')
    assert.ok(alt.trim(), path + ' has no alt text, so it says nothing to a reader who cannot see it')
  }
})

test('the category filter ships empty and is labelled for assistive tech', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const filter = html.match(/<div id="categoryFilter"[^>]*>([\s\S]*?)<\/div>/)

  assert.ok(filter, 'expected a category filter container')
  assert.equal(filter[1].trim(), '')
  assert.match(filter[0], /role="group"/)
  assert.match(filter[0], /aria-label="Category filter"/)
})

test('static budget choices mark only their figures as instrument text', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const budgetMarkup = [...html.matchAll(/<button class="pill time-btn"[^>]*>(.*?)<\/button>/g)]
    .map(match => match[1])

  assert.deepEqual(budgetMarkup, [
    '<span class="fig">5</span> min',
    '<span class="fig">15</span> min',
    '<span class="fig">30</span> min'
  ])
})

test('the budget choices report their own pressed state', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const budgets = [...html.matchAll(/<button class="pill time-btn"[^>]*>/g)].map(match => match[0])

  assert.equal(budgets.length, 3)
  for (const button of budgets) assert.match(button, /aria-pressed="(?:true|false)"/)
  assert.match(html, /id="customMinutes"[^>]*aria-label="Custom minutes"/)
})

test('Review provides a named static duration-offer region before Finish', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const offersAt = html.indexOf('id="durationOffers"')
  const finishAt = html.indexOf('id="finishReviewBtn"')

  assert.ok(offersAt >= 0)
  assert.ok(offersAt < finishAt)
})

test('route shell declares five primary canonical anchors, eight focus headings, and static live regions', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const navMarkup = html.match(/<nav class="bottom-nav" aria-label="Primary">([\s\S]*?)<\/nav>/)?.[1] || ''
  const nav = [...navMarkup.matchAll(/<a[^>]*data-route="([^"]+)"[^>]*href="([^"]+)"[^>]*>/g)]
    .map(match => [match[1], match[2]])
  const screenIds = [...html.matchAll(/<section id="(view-[^"]+)" class="view"/g)].map(match => match[1])
  const routeHeadings = [...html.matchAll(/<h1[^>]*class="route-heading[^"]*"[^>]*tabindex="-1"[^>]*>/g)]
  const allH1Headings = [...html.matchAll(/<h1\b[^>]*>/g)]

  // The five destinations keep the order of the approved primary journey.
  // Setup remains reachable from the Chores header without occupying this bar.
  assert.deepEqual(nav, [
    ['today', '#/today'],
    ['as-needed', '#/as-needed'],
    ['chores', '#/chores'],
    ['inbox', '#/inbox'],
    ['log', '#/log']
  ])
  const inboxAnchor = navMarkup.match(/<a[^>]*id="inboxNav"[^>]*>/)?.[0] || ''
  assert.doesNotMatch(inboxAnchor, /\shidden(?:\s|>)/)
  assert.match(inboxAnchor, /aria-label="Capture, no chores to confirm"/)
  assert.match(navMarkup, /class="nav-count fig" hidden>0<\/span>/)
  assert.match(html, /<section id="view-inbox"[\s\S]*?id="newTaskInput"[\s\S]*?id="addTasksBtn"/)
  assert.match(html, /<nav id="workNav" class="work-nav" aria-label="In-progress work" hidden>/)
  assert.match(html, /data-context-route="doing"[^>]*href="#\/doing"[^>]*hidden[^>]*>Resume round<\/a>/)
  assert.match(html, /data-context-route="review"[^>]*href="#\/receipt"[^>]*hidden[^>]*>Return to review<\/a>/)
  assert.deepEqual(screenIds, [
    'view-today', 'view-as-needed', 'view-inbox', 'view-chores',
    'view-setup', 'view-doing', 'view-review', 'view-log'
  ])
  assert.equal(routeHeadings.length, 8)
  assert.equal(allH1Headings.length, 8)
  assert.doesNotMatch(html, /<h1[^>]*>Chore Planner<\/h1>/)
  assert.match(html, /id="sessionStatus"[^>]*role="status"/)
  assert.match(html, /id="asNeededStatus"[^>]*role="status"/)
  assert.match(html, /id="choresStatus"[^>]*role="status"/)
  assert.match(html, /<section id="view-chores"[\s\S]*?<a[^>]*href="#\/setup"[^>]*>Setup<\/a>/)
  assert.match(html,
    /<section id="view-chores"[\s\S]*?<h1[^>]*><span class="visually-hidden">Chores\. <\/span>Chore ledger<\/h1>/)
  assert.doesNotMatch(html, /<section id="view-chores"[\s\S]*?<h1[^>]*>[^<]*Available chores/)
  assert.match(html, /id="archiveStatus"[^>]*role="status"/)
  assert.match(html, /id="undoToast"[^>]*hidden[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /id="undoToastMessage"/)
  assert.match(html, /class="undo-separator">&middot;<\/span>/)
  assert.match(html, /id="undoToastButton"[^>]*>Undo<\/button>/)
  assert.match(html, /id="sheetScrim"[^>]*hidden/)
  assert.match(html, /id="bottomSheet"[^>]*hidden[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="bottomSheetTitle"[^>]*aria-describedby="bottomSheetMessage"/)
  assert.match(html, /id="bottomSheetMessage"/)
  assert.match(html, /id="bottomSheetActions"/)
  assert.doesNotMatch(html, /data-view=/)
})

test('production JavaScript contains no native alert or confirm calls', async () => {
  const paths = (await readdir(new URL('.', import.meta.url), { recursive: true }))
    .filter(path => path.endsWith('.js') && !path.endsWith('.test.js') && !path.startsWith('.worktrees/'))
  const sources = await Promise.all(paths.map(async path => ({
    path,
    source: await readFile(new URL('./' + path, import.meta.url), 'utf8')
  })))
  const nativeDialogCall = /\b(?:(?:window\.)?alert|(?:window\.)?confirm)\s*\(/

  assert.deepEqual(
    sources.filter(({ source }) => nativeDialogCall.test(source)).map(({ path }) => path),
    []
  )
})

test('bottom navigation uses the 45px target floor, fixed safe-area placement, content clearance, and reduced motion', async () => {
  const css = await readFile(new URL('./index.css', import.meta.url), 'utf8')
  const navRules = css.match(/\.bottom-nav\s+a\s*\{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(navRules, /min-height:\s*45px;/)
  const workNavRules = css.match(/\.work-nav\s+a\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(workNavRules, /min-height:\s*45px;/)
  assert.match(css, /\.bottom-nav\s*\{[\s\S]*position:\s*fixed;/)
  assert.match(css, /\.bottom-nav\s*\{[\s\S]*safe-area-inset-bottom/)
  assert.match(css, /#app\s*\{[\s\S]*padding:[^;]*safe-area-inset-bottom/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.doesNotMatch(css, /\.nav-btn/)
  assert.match(css, /#bottomSheet\s*\{[\s\S]*max-height:\s*70vh;/)
  assert.match(css, /#bottomSheet\s*\{[\s\S]*overscroll-behavior:\s*contain;/)
  assert.match(css, /#bottomSheet\s*\{[\s\S]*var\(--lift-sheet\)/)
  assert.match(css, /#bottomSheet\s*\{[\s\S]*var\(--t-sheet\)[\s\S]*var\(--e-sheet\)/)
})

test('all view transitions use the hash router instead of the retired view router', async () => {
  const sources = await Promise.all([
    'index.js', 'sessionView.js', 'doingView.js', 'reviewView.js'
  ].map(path => readFile(new URL('./' + path, import.meta.url), 'utf8')))

  for (const source of sources) assert.doesNotMatch(source, /viewRouter\.js/)
})
