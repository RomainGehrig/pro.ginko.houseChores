// ABOUTME: Unit tests for safe, stable task presentation markup.
// ABOUTME: Run with: node --test taskPresentationLogic.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildActiveTaskDetailsHtml,
  buildBundlePreviewHtml,
  buildDoingSessionHtml,
  buildEnrichmentAvailability
} from './taskPresentationLogic.js'

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
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(markup, /<img/)
})

test('resolved and unavailable cards remain visible in paused state', () => {
  const markup = buildDoingSessionHtml({
    status: 'paused', timeBudgetMinutes: 15
  }, [
    { _id: 't1', name: 'Clean sink', estimatedDuration: 5 },
    { _id: 'missing', name: 'Unavailable task', unavailable: true }
  ], [{ taskId: 't1', outcome: 'done', rawDurationMs: 5000 }], [])
  assert.match(markup, /data-task-id="t1"[\s\S]*Done · 00:05/)
  assert.match(markup, /data-task-id="missing"[\s\S]*Unavailable task/)
  assert.match(markup, /data-task-id="missing"[\s\S]*data-outcome="cancelled"/)
  assert.match(markup, /id="doingDecisionPanel"/)
  assert.match(markup, />Conclude</)
  assert.match(markup, />Continue</)
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
  assert.match(markup, /About every 3 days after completion/)
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

  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(markup, /Unknown location/)
  assert.equal((markup.match(/>Unavailable</g) || []).length, 2)
  assert.doesNotMatch(markup, /<img/)
})
