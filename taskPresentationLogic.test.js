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
  buildChoreNoteHtml,
  buildDoingSessionHtml,
  buildEnrichmentAvailability,
  suggestionsNote
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

  assert.match(markup, /data-task-id="null-raw"[\s\S]*?Took <span class="fig">2<\/span> min/)
  assert.match(markup, /data-task-id="empty-raw"[\s\S]*?Took <span class="fig">30<\/span> sec/)
  assert.match(markup, /data-task-id="zero-raw"[\s\S]*?Took <span class="fig">0<\/span> sec/)
  assert.match(markup, /estimate <span class="fig">1<\/span> min/)
  assert.match(markup, /of the <span class="fig">15<\/span> min you set/)
})

test('resolved and unavailable cards remain visible without outcome controls while paused', () => {
  const markup = buildDoingSessionHtml({
    status: 'paused', timeBudgetMinutes: 15
  }, [
    { _id: 't1', name: 'Clean sink', estimatedDuration: 5 },
    { _id: 'missing', name: 'Unavailable task', unavailable: true }
  ], [{ taskId: 't1', outcome: 'done', rawDurationMs: 5000 }], [])
  assert.match(markup, /data-task-id="t1"[\s\S]*Took <span class="fig">5<\/span> sec/)
  assert.match(markup, /data-task-id="missing"[\s\S]*Unavailable task/)
  assert.doesNotMatch(markup, /data-outcome=/)

  // The add panel belongs to the session itself rather than hiding behind a
  // second control.
  assert.match(markup, /id="doingContinuePanel"[^>]*class="[^"]*doing-add/)
  assert.doesNotMatch(markup, /id="doingContinuePanel"[^>]*hidden/)
  assert.doesNotMatch(markup, /id="openContinueBtn"|id="doingDecisionPanel"/)
})

test('an active session keeps its add panel available while the clock runs', () => {
  const markup = buildDoingSessionHtml(
    {
      _id: 's1', status: 'active', timeBudgetMinutes: 15,
      accumulatedActiveMs: 0, activeStartedAt: 1000
    },
    [{ _id: 't1', name: 'Clean sink', estimatedDuration: 5 }],
    [], [], 2000
  )

  assert.match(markup, /id="doingContinuePanel"[^>]*class="[^"]*doing-add/)
  assert.doesNotMatch(markup, /id="doingContinuePanel"[^>]*hidden/)
})

test('the head states the clock, what it is doing, and both ways out of the session', () => {
  const running = buildDoingSessionHtml(
    { _id: 's1', status: 'active', timeBudgetMinutes: 30, accumulatedActiveMs: 12 * 60000 },
    [{ _id: 't1', name: 'Water the plants', estimatedDuration: 10 }],
    [], [], 0
  )

  assert.match(running, /id="sessionTimerDisplay"/)
  assert.match(running, /class="doing-status">Counting active time</)
  assert.match(running, /id="concludeSessionBtn"[^>]*>Conclude</)
  assert.match(running, /id="pauseSessionBtn"[^>]*>Pause</)
  assert.match(running, /id="doingRemaining">About <span class="fig">18<\/span> min left/)
  assert.match(running, /<span class="fig">0<\/span> of <span class="fig">1<\/span> resolved/)
  assert.match(running, /id="doingSpent">Time allocated to chores: <span class="fig">0<\/span> sec/)

  const paused = buildDoingSessionHtml(
    { _id: 's1', status: 'paused', timeBudgetMinutes: 30, accumulatedActiveMs: 12 * 60000 },
    [{ _id: 't1', name: 'Water the plants', estimatedDuration: 10 }],
    [], [], 0
  )
  assert.match(paused, /class="doing-status">Paused — the clock is stopped</)
  assert.match(paused, /id="pauseSessionBtn"[^>]*>Resume</)

  // Conclude is in the head from the start: it must not take a pause first.
  assert.match(paused, /id="concludeSessionBtn"/)
})

test('a session that resolved itself says why it stopped', () => {
  const all = buildDoingSessionHtml(
    { _id: 's1', status: 'paused', timeBudgetMinutes: 30, accumulatedActiveMs: 60000 },
    [{ _id: 't1', name: 'Water the plants', estimatedDuration: 10 }],
    [{ _id: 'x1', taskId: 't1', outcome: 'done', rawDurationMs: 60000 }], [], 0
  )
  assert.match(all, /class="doing-auto-note[^"]*">Everything is resolved\. Conclude, or add more\.</)

  const some = buildDoingSessionHtml(
    { _id: 's1', status: 'paused', timeBudgetMinutes: 30, accumulatedActiveMs: 60000 },
    [
      { _id: 't1', name: 'Water the plants', estimatedDuration: 10 },
      { _id: 't2', name: 'Vacuum', estimatedDuration: 10 }
    ],
    [{ _id: 'x1', taskId: 't1', outcome: 'done', rawDurationMs: 60000 }], [], 0
  )
  assert.doesNotMatch(some, /doing-auto-note/)
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
  // The estimate is its own cell, so the whole cell is the instrument face.
  assert.match(markup, /<span class="continue-row-est fig">5 min<\/span>/)
  assert.match(markup, /<span class="continue-row-est fig">30 min<\/span>/)
})

test('continuation budget copy isolates its measurement and states the rule after it', () => {
  assert.equal(
    buildContinuationRemainingHtml({ timeBudgetMinutes: 30 }, 18 * 60000),
    'About <span class="fig">12</span> min left of the <span class="fig">30</span> min you set' +
    '. Anything you pick deliberately fits, budget or not.'
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

test('a one-off chore states its date in the note, once, with nothing counted against it', () => {
  const markup = buildChoreNoteHtml({
    name: 'One-off wish', scheduledDate: '2026-08-07', schedule: { type: 'one_off' }
  }, '2026-08-08')

  assert.equal((markup.match(/<span class="fig">7<\/span> Aug/g) || []).length, 1)
  assert.match(markup, /^Once · /)
  assert.doesNotMatch(markup, /\b(?:due|late|overdue)\b|\+\d+d/i)
})

test('a fixed chore states its pattern and a periodic one its cadence', () => {
  assert.match(buildChoreNoteHtml({
    scheduledDate: '2026-08-05', schedule: { type: 'fixed', pattern: { kind: 'month_day', day: 5 } }
  }, '2026-08-08'), /^Monthly on day <span class="fig">5<\/span> · <span class="fig">5<\/span> Aug$/)

  assert.match(buildChoreNoteHtml({
    lastCompletedDate: Date.UTC(2026, 7, 1, 12),
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, '2026-08-08'), /last done <span class="fig">7<\/span>d ago · about every week/)

  assert.match(buildChoreNoteHtml({
    lastCompletedDate: null, schedule: { type: 'periodic', every: 2, unit: 'week' }
  }, '2026-08-08'), /not yet done · about every <span class="fig">2<\/span> weeks/)
})

// The cadence used to print as the number of days with its unit dropped, and
// only a one-off admitted which day it was on. Both are facts the list is for.
test('every kind of chore says which day it is on, in the cadence it was set in', () => {
  const periodic = buildChoreNoteHtml({
    lastCompletedDate: null,
    scheduledDate: '2026-08-16',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  }, '2026-08-08')
  assert.match(periodic, /not yet done · about every <span class="fig">2<\/span> weeks · <span class="fig">16<\/span> Aug$/)
  assert.doesNotMatch(periodic, /every <span class="fig">14<\/span>/, 'never the day count on its own')

  // Nothing is invented for a chore that has not been given a day.
  assert.match(buildChoreNoteHtml({
    lastCompletedDate: null, scheduledDate: null,
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, '2026-08-08'), /^not yet done · about every week$/)

  // The band and the sort already say where a chore stands; the day is stated
  // once, as a plain fact, with nothing counted against it.
  assert.doesNotMatch(periodic, /\b(?:due|late|overdue|behind)\b|\+\d+d/i)
})

test('a resolved chore offers to be reopened, naming the outcome it would take back', () => {
  const markup = buildDoingSessionHtml(
    { _id: 's1', status: 'active', timeBudgetMinutes: 30 },
    [{ _id: 't1', name: 'Water the plants', estimatedDuration: 10 }],
    [{ _id: 'x1', taskId: 't1', outcome: 'done', rawDurationMs: 420000 }],
    []
  )

  assert.match(markup, /data-reopen-execution-id="x1"[^>]*>Reopen</)
  assert.match(markup, /aria-label="Reopen Water the plants"/)
})

test('an unresolved chore has nothing to reopen', () => {
  const markup = buildDoingSessionHtml(
    { _id: 's1', status: 'active', timeBudgetMinutes: 30 },
    [{ _id: 't1', name: 'Water the plants', estimatedDuration: 10 }],
    [],
    []
  )

  assert.doesNotMatch(markup, /data-reopen-execution-id/)
})

test('the Inbox says what suggestions will and will not do, on or off', () => {
  const on = suggestionsNote(true)
  assert.match(on, /never pick the date/)
  assert.match(on, /editable/)

  const off = suggestionsNote(false)
  assert.match(off, /off/)
  assert.match(off, /Setup/)
})
