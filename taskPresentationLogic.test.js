// ABOUTME: Unit tests for safe, stable task presentation markup.
// ABOUTME: Run with: node --test taskPresentationLogic.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildActiveTaskDetailsHtml,
  buildBundlePreviewHtml,
  buildDoingTaskHtml,
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

test('doing markup resolves a renamed category by stable id and escapes stored names', () => {
  const markup = buildDoingTaskHtml({
    _id: 'task-1',
    name: '<img src=x onerror=alert(1)>',
    categoryId: 'category-1',
    category: 'Stale category snapshot',
    estimatedDuration: 15
  }, 0, 1, [{
    _id: 'category-1',
    name: '<svg onload=alert(2)>Renamed category',
    status: 'active'
  }])

  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(markup, /&lt;svg onload=alert\(2\)&gt;Renamed category/)
  assert.doesNotMatch(markup, /<img|<svg|Stale category snapshot/)

  const activeMarkup = buildActiveTaskDetailsHtml({
    categoryId: 'category-1',
    category: 'Stale category snapshot',
    estimatedDuration: 15,
    scheduledDate: '2026-08-16',
    schedule: { type: 'one_off' }
  }, [{
    _id: 'category-1',
    name: '<svg onload=alert(2)>Renamed category',
    status: 'active'
  }])
  assert.match(activeMarkup, /&lt;svg onload=alert\(2\)&gt;Renamed category/)
  assert.doesNotMatch(activeMarkup, /<svg|Stale category snapshot/)
})

test('doing markup keeps completion recovery status and actions safely rendered', () => {
  const markup = buildDoingTaskHtml({
    name: '<button id="retryCompletionBtn">Fake retry</button>',
    category: 'Home',
    estimatedDuration: 10
  }, 0, 1)

  assert.match(markup, /<div id="doingStatus"><\/div>/)
  assert.match(markup, /<button id="doneBtn">Done<\/button>/)
  assert.match(markup, /<button id="alreadyDoneBtn">Already Done<\/button>/)
  assert.match(markup, /<button id="cancelBtn">Cancel<\/button>/)
  assert.match(markup, /<button id="endSessionBtn">End Session<\/button>/)
  assert.doesNotMatch(markup, /<h2><button/)
  assert.equal((markup.match(/id="retryCompletionBtn"/g) || []).length, 0)
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
