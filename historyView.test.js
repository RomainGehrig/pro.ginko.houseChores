// ABOUTME: Unit tests for history presentation markup.
// ABOUTME: Verifies mixed facts isolate figures without dimming or escaping mistakes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { historyRowHtml } from './historyView.js'

test('history rows keep every displayed number in instrument markup', () => {
  const markup = historyRowHtml({
    startTime: new Date(2026, 7, 8, 9, 5).getTime(),
    timeBudgetMinutes: 15,
    categoryFilter: 'Floor 2 & <all>',
    statusLabel: null,
    taskCount: 1,
    outcomeCounts: { done: 1, already_done: 0, cancelled: 0 },
    totalActualMinutes: 12,
    entries: [{
      taskName: 'Sink 2',
      outcome: 'done',
      actualDuration: 12,
      difficultyRating: 3,
      notes: 'Used <2 cloths'
    }]
  })

  assert.doesNotMatch(markup, /<script|<all>/)
  assert.match(markup, /Floor <span class="fig">2<\/span> &amp; &lt;all&gt;/)
  assert.match(markup, /<span class="fig">15<\/span> min/)
  assert.match(markup, /<span class="fig">1<\/span> task/)
  assert.match(markup, /<span class="fig">1<\/span> done/)
  assert.match(markup, /<span class="fig">12<\/span> min/)
  assert.match(markup, /Sink <span class="fig">2<\/span>/)
  assert.match(markup, /Used &lt;<span class="fig">2<\/span> cloths/)
})
