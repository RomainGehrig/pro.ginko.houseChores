// ABOUTME: Unit tests for safe, stable task presentation markup.
// ABOUTME: Run with: node --test taskPresentationLogic.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import { formatFactHtml } from './helpers.js'
import {
  buildActiveTaskDetailsHtml,
  buildBundlePreviewHtml,
  buildContinuationRemainingHtml,
  buildContinuationSearchResultsHtml,
  buildContinuationSuggestionsHtml,
  buildDoingSessionHtml,
  buildEnrichmentAvailability,
  buildTaskLedgerSummaryHtml
} from './taskPresentationLogic.js'

test('fact markup keeps words in reading type while safely isolating every number', () => {
  assert.equal(
    formatFactHtml('Floor 2 & <3 at 08:05'),
    'Floor <span class="fig">2</span> &amp; &lt;<span class="fig">3</span> at ' +
      '<span class="fig">08:05</span>'
  )
})

test('uses neutral no-category copy for unavailable AI enrichment', () => {
  assert.deepEqual(buildEnrichmentAvailability([]), {
    disabled: true,
    message: 'Add a category before using AI enrichment.'
  })
  assert.deepEqual(buildEnrichmentAvailability([{ _id: 'category-1' }]), {
    disabled: false,
    message: 'Add a category before using AI enrichment.'
  })
})

test('doing markup renders all unresolved task actions and escapes names', () => {
  const markup = buildDoingSessionHtml({
    status: 'active', timeBudgetMinutes: 15
  }, [
    { _id: 't1', name: '<img src=x onerror=alert(1)>', estimatedDuration: 5 },
    { _id: 't2', name: 'Clean sink', estimatedDuration: 10 }
  ], [], [])
  assert.match(markup, /id="sessionTimerDisplay"/)
  assert.match(markup, /data-task-id="t1"/)
  assert.match(markup, /data-task-id="t2"/)
  assert.equal((markup.match(/data-outcome="done"/g) || []).length, 2)
  assert.equal((markup.match(/data-outcome="already_done"/g) || []).length, 2)
  assert.equal((markup.match(/data-outcome="cancelled"/g) || []).length, 2)
  assert.match(markup, /&lt;img src=x onerror=alert\(<span class="fig">1<\/span>\)&gt;/)
  assert.doesNotMatch(markup, /<img/)
})

test('active unavailable cards are Cancel-only while proposed Quick-add cards stay actionable', () => {
  const markup = buildDoingSessionHtml({
    status: 'active', timeBudgetMinutes: 15
  }, [{
    _id: 'archived', name: 'Old task', status: 'archived', unavailable: true
  }, {
    _id: 'quick', name: 'Quick task', status: 'proposed'
  }], [], [])
  const archivedCard = markup.match(/<article[^>]*data-task-id="archived"[\s\S]*?<\/article>/)[0]
  const quickCard = markup.match(/<article[^>]*data-task-id="quick"[\s\S]*?<\/article>/)[0]

  assert.match(archivedCard, /data-outcome="cancelled"/)
  assert.doesNotMatch(archivedCard, /data-outcome="done"|data-outcome="already_done"/)
  assert.match(quickCard, /data-outcome="done"/)
  assert.match(quickCard, /data-outcome="already_done"/)
  assert.match(quickCard, /data-outcome="cancelled"/)
})

test('resolved timing falls back for null or empty raw values while preserving numeric zero', () => {
  const markup = buildDoingSessionHtml({
    status: 'paused', timeBudgetMinutes: 15
  }, [{
    _id: 'null-raw', name: 'Null raw', estimatedDuration: 1
  }, {
    _id: 'empty-raw', name: 'Empty raw', estimatedDuration: 1
  }, {
    _id: 'zero-raw', name: 'Zero raw', estimatedDuration: 1
  }], [{
    taskId: 'null-raw', outcome: 'done', rawDurationMs: null, actualDuration: 2
  }, {
    taskId: 'empty-raw', outcome: 'done', rawDurationMs: '', actualDuration: 0.5
  }, {
    taskId: 'zero-raw', outcome: 'done', rawDurationMs: 0, actualDuration: 99
  }], [])

  assert.match(markup, /data-task-id="null-raw"[\s\S]*?Done · <span class="fig">02:00<\/span>/)
  assert.match(markup, /data-task-id="empty-raw"[\s\S]*?Done · <span class="fig">00:30<\/span>/)
  assert.match(markup, /data-task-id="zero-raw"[\s\S]*?Done · <span class="fig">00:00<\/span>/)
  assert.match(markup, /target <span class="fig">1<\/span> min/)
  assert.match(markup, /Budget <span class="fig">15<\/span> min/)
})

test('resolved and unavailable cards remain visible without outcome controls while paused', () => {
  const markup = buildDoingSessionHtml({
    status: 'paused', timeBudgetMinutes: 15
  }, [
    { _id: 't1', name: 'Clean sink', estimatedDuration: 5 },
    { _id: 'missing', name: 'Unavailable task', unavailable: true }
  ], [{ taskId: 't1', outcome: 'done', rawDurationMs: 5000 }], [])
  assert.match(markup, /data-task-id="t1"[\s\S]*Done · <span class="fig">00:05<\/span>/)
  assert.match(markup, /data-task-id="missing"[\s\S]*Unavailable task/)
  assert.doesNotMatch(markup, /data-outcome=/)
  assert.match(markup, /id="doingDecisionPanel"/)
  assert.match(markup, />Conclude</)
  assert.match(markup, />Continue</)
})

test('picker markup escapes every stored suggestion and search-result title', () => {
  const markup = buildContinuationSuggestionsHtml([{
    _id: 'suggested-5m',
    name: '<img src=x onerror=alert(1)>',
    estimatedDuration: 5
  }]) + buildContinuationSearchResultsHtml([{
    _id: 'searched-30m',
    name: '</button><script>globalThis.compromised = true</script><button>',
    estimatedDuration: 30
  }])

  assert.match(markup, /&lt;img src=x onerror=alert\(<span class="fig">1<\/span>\)&gt;/)
  assert.match(
    markup,
    /&lt;\/button&gt;&lt;script&gt;globalThis\.compromised = true&lt;\/script&gt;&lt;button&gt;/
  )
  assert.doesNotMatch(markup, /<img|<script>/)
  assert.match(markup, /<span class="fig">5<\/span> min/)
  assert.match(markup, /<span class="fig">30<\/span> min/)
})

test('continuation budget copy isolates its measurement without styling prose as a figure', () => {
  assert.equal(
    buildContinuationRemainingHtml(12),
    '<span class="fig">12</span> min remain in the original session budget for suggestions.'
  )
})

test('bundle preview escapes stored task names', () => {
  const markup = buildBundlePreviewHtml([{
    _id: 'task-1',
    name: '</li><script>globalThis.compromised = true</script><li>',
    estimatedDuration: 5,
    scheduledDate: '2026-08-16',
    schedule: { type: 'one_off' }
  }])

  assert.match(markup, /&lt;\/li&gt;&lt;script&gt;globalThis\.compromised = true&lt;\/script&gt;&lt;li&gt;/)
  assert.doesNotMatch(markup, /<script>/)
})

test('task and bundle markup use scheduled language and schedule summaries', () => {
  const task = {
    name: 'Water plants',
    category: 'Home',
    estimatedDuration: 10,
    scheduledDate: '2026-08-16',
    schedule: { type: 'periodic', every: 3, unit: 'day' }
  }
  const markup = buildActiveTaskDetailsHtml(task, []) + buildBundlePreviewHtml([task])
  assert.match(markup, /Scheduled:/)
  assert.match(markup, /About every <span class="fig">3<\/span> days after completion/)
  assert.match(markup, /<span class="fig">10<\/span> min/)
  assert.match(markup, /<span class="fig">8<\/span>\/<span class="fig">16<\/span>\/<span class="fig">2026<\/span>/)
  assert.doesNotMatch(markup, /\bdue\b|overdue/i)
})

test('non-editing task details retain archived category and location assignments', () => {
  const markup = buildActiveTaskDetailsHtml({
    categoryId: 'category-archived',
    category: 'Old category snapshot',
    locationIds: ['location-archived'],
    estimatedDuration: 10,
    scheduledDate: '2026-08-16',
    schedule: { type: 'one_off' }
  }, {
    categories: [{
      _id: 'category-archived',
      name: 'Retired chores',
      status: 'archived'
    }],
    locations: [{
      _id: 'location-archived',
      name: 'Old attic',
      status: 'archived'
    }]
  })

  assert.match(markup, /Retired chores/)
  assert.match(markup, /Old attic/)
  assert.equal((markup.match(/archived-badge/g) || []).length, 2)
  assert.equal((markup.match(/>Archived</g) || []).length, 2)
  assert.doesNotMatch(markup, /Old category snapshot/)
})

test('non-editing task details safely mark unresolved retained assignments unavailable', () => {
  const markup = buildActiveTaskDetailsHtml({
    categoryId: 'missing-category',
    category: '<img src=x onerror=alert(1)>',
    locationIds: ['missing-location'],
    estimatedDuration: 10,
    scheduledDate: '2026-08-16',
    schedule: { type: 'one_off' }
  }, { categories: [], locations: [] })

  assert.match(markup, /&lt;img src=x onerror=alert\(<span class="fig">1<\/span>\)&gt;/)
  assert.match(markup, /Unknown location/)
  assert.equal((markup.match(/>Unavailable</g) || []).length, 2)
  assert.doesNotMatch(markup, /<img/)
})

test('ledger summary presents periodic ripeness as neutral completion and cadence facts', () => {
  const markup = buildTaskLedgerSummaryHtml({
    name: '<img src=x onerror=alert(1)>',
    estimatedDuration: 45,
    scheduledDate: '2026-08-07',
    lastCompletedDate: Date.UTC(2026, 7, 1, 12),
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, '2026-08-08')

  assert.match(markup, /class="row-stamp"><span class="fig">7<\/span>d</)
  assert.match(markup, /class="row-name">&lt;img src=x onerror=alert\(<span class="fig">1<\/span>\)&gt;</)
  assert.match(markup, /class="row-fig"><span class="fig">45<\/span> min</)
  assert.match(markup, /class="row-tag"><span class="fig">7<\/span>d</)
  assert.match(markup, /last done <span class="fig">7<\/span>d ago · about every <span class="fig">7<\/span>/)
  assert.doesNotMatch(markup, /<img|\b(?:late|overdue|slip)\b|\+\d+d/i)
})

test('ledger summary uses an em dash until a periodic chore has completion history', () => {
  const markup = buildTaskLedgerSummaryHtml({
    name: 'Vacuum bedroom',
    estimatedDuration: 15,
    scheduledDate: '2026-08-07',
    lastCompletedDate: null,
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  }, '2026-08-08')

  assert.match(markup, /class="row-stamp">—</)
  assert.match(markup, /not yet done · about every <span class="fig">14<\/span>/)
})

test('ledger summary states a fixed date once without turning it into an overdue tally', () => {
  const markup = buildTaskLedgerSummaryHtml({
    name: 'Pay bills',
    estimatedDuration: 20,
    scheduledDate: '2026-08-05',
    schedule: { type: 'fixed', pattern: { kind: 'month_day', day: 5 } }
  }, '2026-08-08')

  assert.equal((markup.match(/<span class="fig">5<\/span> Aug/g) || []).length, 1)
  assert.match(markup, /Monthly on day <span class="fig">5<\/span>/)
  assert.doesNotMatch(markup, /\b(?:due|late|overdue)\b|\+\d+d/i)
})

test('ledger summary gives today a filled state and keeps one-off dates neutral', () => {
  const todayMarkup = buildTaskLedgerSummaryHtml({
    name: 'Today task', estimatedDuration: 5, scheduledDate: '2026-08-08',
    schedule: { type: 'one_off' }
  }, '2026-08-08')
  const pastMarkup = buildTaskLedgerSummaryHtml({
    name: 'One-off wish', estimatedDuration: 5, scheduledDate: '2026-08-07',
    schedule: { type: 'one_off' }
  }, '2026-08-08')

  assert.match(todayMarkup, /class="row-stamp stamp is-today">TODAY</)
  assert.match(pastMarkup, /class="row-stamp"><span class="fig">7<\/span> Aug</)
  assert.match(pastMarkup, /class="row-note">Once</)
  assert.doesNotMatch(todayMarkup + pastMarkup, /\b(?:due|late|overdue)\b|\+\d+d/i)
})
