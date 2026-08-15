// ABOUTME: Tests the Log's ranges, chart geometry and per-session copy.
// ABOUTME: Guards the rule that time is reported here and never scored.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOG_RANGES,
  LOG_SUBLINE,
  activeBars,
  budgetLine,
  driftFillPercent,
  driftLine,
  logHeadline,
  logRanges,
  relativeDay,
  sessionSummaryLine,
  sessionsInRange,
  tookLine
} from './logLogic.js'

const NOW = Date.UTC(2026, 7, 15, 12, 0)
const DAY = 24 * 60 * 60 * 1000

const session = (overrides = {}) => ({
  id: 's1',
  startTime: NOW - DAY,
  timeBudgetMinutes: 30,
  activeMinutes: 26,
  totalActualMinutes: 24,
  entries: [
    { taskName: 'Mop', outcome: 'done', actualDuration: 14, estimatedDuration: 10 },
    { taskName: 'Bins', outcome: 'done', actualDuration: 10, estimatedDuration: 10 }
  ],
  ...overrides
})

test('the three ranges are offered, and the one showing is pressed', () => {
  assert.deepEqual(LOG_RANGES.map(range => range.label),
    ['Last 7 days', 'Last 30 days', 'Everything'])
  assert.deepEqual(logRanges('30').map(range => [range.label, range.active]), [
    ['Last 7 days', false], ['Last 30 days', true], ['Everything', false]
  ])
})

test('a range narrows the record by when the session started, and Everything keeps it all', () => {
  const sessions = [
    session({ id: 'today', startTime: NOW - 1000 }),
    session({ id: 'lastWeek', startTime: NOW - 6 * DAY }),
    session({ id: 'lastMonth', startTime: NOW - 20 * DAY }),
    session({ id: 'ancient', startTime: NOW - 400 * DAY })
  ]
  assert.deepEqual(sessionsInRange(sessions, '7', NOW).map(s => s.id), ['today', 'lastWeek'])
  assert.deepEqual(sessionsInRange(sessions, '30', NOW).map(s => s.id),
    ['today', 'lastWeek', 'lastMonth'])
  assert.deepEqual(sessionsInRange(sessions, 'all', NOW).map(s => s.id),
    ['today', 'lastWeek', 'lastMonth', 'ancient'])
})

test('the headline counts what happened, and the subline says it is not a score', () => {
  assert.equal(logHeadline([session(), session({ id: 's2', totalActualMinutes: 41 })]),
    '2 sessions · 4 chores · 1h 5m')
  assert.equal(logHeadline([session()]), '1 session · 2 chores · 24 min')
  assert.equal(logHeadline([]), 'Nothing recorded yet')
  assert.equal(LOG_SUBLINE, 'What actually happened. Nothing here is a score.')
})

test('a skipped chore is recorded but not counted as a chore done', () => {
  const withSkip = session({
    entries: [
      { taskName: 'Mop', outcome: 'done', actualDuration: 14, estimatedDuration: 10 },
      { taskName: 'Bins', outcome: 'cancelled', actualDuration: 0, estimatedDuration: 10 }
    ]
  })
  assert.match(logHeadline([withSkip]), /1 chore ·/)
  assert.equal(sessionSummaryLine(withSkip),
    '1 chore · 24 min recorded · 26 min active')
})

test('the chart runs oldest to newest and scales to its own tallest bar', () => {
  const bars = activeBars([
    session({ id: 'a', startTime: NOW - 1000, activeMinutes: 20 }),
    session({ id: 'b', startTime: NOW - 2 * DAY, activeMinutes: 40 })
  ], NOW)

  assert.deepEqual(bars.map(bar => bar.id), ['b', 'a'])
  assert.deepEqual(bars.map(bar => bar.height), [88, 44])
  assert.equal(bars[0].label, '2d ago')
  assert.match(bars[1].title, /^Today · 20 min active$/)
})

test('a session with no active time still draws something to stand on', () => {
  const [bar] = activeBars([session({ activeMinutes: 0 })], NOW)
  assert.equal(bar.height, 6)
})

test('the budget line is a readout in both directions, never an error', () => {
  assert.equal(budgetLine(session({ activeMinutes: 38 })), '8 min past the 30 min set')
  assert.equal(budgetLine(session({ activeMinutes: 25 })), '5 min inside the 30 min set')
  assert.equal(budgetLine(session({ activeMinutes: 30 })), 'Exactly the 30 min set')
  assert.equal(budgetLine(session({ timeBudgetMinutes: null })), 'No budget was set')

  for (const active of [25, 30, 38]) {
    assert.doesNotMatch(budgetLine(session({ activeMinutes: active })), /over budget|failed|too|only/i)
  }
})

test('a chore states what it took and how that compares, as one plain fact', () => {
  assert.equal(tookLine({ outcome: 'done', actualDuration: 14 }), 'Took 14 min')
  assert.equal(tookLine({ outcome: 'cancelled', actualDuration: 0 }), 'Skipped')
  assert.equal(tookLine({ outcome: 'already_done', actualDuration: 0 }), 'Already done')

  assert.equal(driftLine({ outcome: 'done', actualDuration: 14, estimatedDuration: 10 }), '4 min over')
  assert.equal(driftLine({ outcome: 'done', actualDuration: 6, estimatedDuration: 10 }), '4 min under')
  assert.equal(driftLine({ outcome: 'done', actualDuration: 10, estimatedDuration: 10 }),
    'same as the estimate')
  assert.equal(driftLine({ outcome: 'cancelled', actualDuration: 0, estimatedDuration: 10 }), '')
  assert.equal(driftLine({ outcome: 'done', actualDuration: 10, estimatedDuration: null }), '')
})

test('the drift bar fills against the larger of what it took and what was guessed', () => {
  assert.equal(driftFillPercent({ outcome: 'done', actualDuration: 5, estimatedDuration: 10 }), 50)
  assert.equal(driftFillPercent({ outcome: 'done', actualDuration: 20, estimatedDuration: 10 }), 100)
  assert.equal(driftFillPercent({ outcome: 'cancelled', actualDuration: 0, estimatedDuration: 10 }), 0)
})

test('a session is placed in time by how long ago it was, not by how late it is', () => {
  assert.equal(relativeDay(NOW - 1000, NOW), 'Today')
  assert.equal(relativeDay(NOW - DAY, NOW), 'Yesterday')
  assert.equal(relativeDay(NOW - 3 * DAY, NOW), '3d ago')
  assert.equal(relativeDay(null, NOW), '')
})
