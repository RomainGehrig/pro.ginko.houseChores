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
    recurrence: null,
    nextDueDate: 0
  }, [{
    _id: 'category-1',
    name: '<svg onload=alert(2)>Renamed category',
    status: 'active'
  }])
  assert.match(activeMarkup, /&lt;svg onload=alert\(2\)&gt;Renamed category/)
  assert.doesNotMatch(activeMarkup, /<svg|Stale category snapshot/)
})

test('bundle preview escapes stored task names', () => {
  const markup = buildBundlePreviewHtml([{
    _id: 'task-1',
    name: '</li><script>globalThis.compromised = true</script><li>',
    estimatedDuration: 5,
    nextDueDate: 0
  }])

  assert.match(markup, /&lt;\/li&gt;&lt;script&gt;globalThis\.compromised = true&lt;\/script&gt;&lt;li&gt;/)
  assert.doesNotMatch(markup, /<script>/)
})
