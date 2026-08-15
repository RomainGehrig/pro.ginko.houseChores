// ABOUTME: Tests the Log's markup — the range control, the active-time chart and the session cards.
// ABOUTME: Guards that a card reports what a session took without ever scoring it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { activeBars } from './logLogic.js'
import {
  logChartHtml,
  logRangesHtml,
  logSessionCardHtml,
  logSessionsHtml
} from './logView.js'

const NOW = new Date(2026, 7, 15, 12, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

const session = (overrides = {}) => ({
  id: 's1',
  startTime: NOW - DAY,
  timeBudgetMinutes: 30,
  activeMinutes: 26,
  totalActualMinutes: 24,
  statusLabel: null,
  entries: [
    { taskName: 'Mop', outcome: 'done', actualDuration: 14, estimatedDuration: 10 },
    { taskName: 'Bins', outcome: 'done', actualDuration: 10, estimatedDuration: 10 }
  ],
  ...overrides
})

test('the range control presses the one showing and names each range', () => {
  const markup = logRangesHtml('30')
  assert.match(markup, /data-log-range="7"[^>]*aria-pressed="false"[^>]*>Last <span class="fig">7<\/span> days</)
  assert.match(markup, /data-log-range="30"[^>]*aria-pressed="true"/)
  assert.match(markup, /data-log-range="all"[^>]*>Everything</)
})

test('a bar stands as tall as its own active time and says which day it is', () => {
  const markup = logChartHtml(activeBars([
    session({ id: 'a', startTime: NOW - 1000, activeMinutes: 20 }),
    session({ id: 'b', startTime: NOW - 2 * DAY, activeMinutes: 40 })
  ], NOW))

  assert.match(markup, /height: 88px[\s\S]*?2d ago/)
  assert.match(markup, /height: 44px[\s\S]*?Today/)
  assert.match(markup, /title="2d ago · 40 min active"/)
  assert.doesNotMatch(markup, /target|goal|behind/i)
})

test('an empty chart says so rather than drawing a floor to fall short of', () => {
  assert.match(logChartHtml([]), /Nothing to chart yet/)
  assert.doesNotMatch(logChartHtml([]), /<span class="log-bar"/)
})

test('a closed card states its day, what it held and how long ago it was', () => {
  const markup = logSessionCardHtml(session(), { now: NOW })
  assert.match(markup, /data-id="s1"/)
  assert.match(markup, /aria-expanded="false"/)
  assert.match(markup, /<span class="fig">2<\/span> chores/)
  assert.match(markup, /<span class="fig">24<\/span> min recorded/)
  assert.match(markup, /<span class="fig">26<\/span> min active/)
  assert.match(markup, /Yesterday/)
  assert.doesNotMatch(markup, /log-row/)
})

test('an open card lists each chore with what it took and how that compares', () => {
  const markup = logSessionCardHtml(session(), { open: true, now: NOW })
  assert.match(markup, /aria-expanded="true"/)
  assert.match(markup, /Mop<\/span>[\s\S]*?Took <span class="fig">14<\/span> min · <span class="fig">4<\/span> min over/)
  assert.match(markup, /Bins<\/span>[\s\S]*?same as the estimate/)
  assert.match(markup, /<span class="fig">4<\/span> min inside the <span class="fig">30<\/span> min set/)
})

test('a skipped chore is stated, and its bar draws nothing rather than a shortfall', () => {
  const markup = logSessionCardHtml(session({
    entries: [{ taskName: 'Bins', outcome: 'cancelled', actualDuration: 0, estimatedDuration: 10 }]
  }), { open: true, now: NOW })

  assert.match(markup, /Skipped/)
  assert.match(markup, /class="log-row-fill is-quiet" style="width: 0%/)
})

test('nothing in a card is coloured or worded as a failure', () => {
  const markup = logSessionCardHtml(session({ activeMinutes: 51 }), { open: true, now: NOW })
  assert.match(markup, /<span class="fig">21<\/span> min past the <span class="fig">30<\/span> min set/)
  assert.doesNotMatch(markup, /overdue|over budget|late|failed|only/i)
  assert.doesNotMatch(markup, /--ripe-warm|#c0392b|red/i)
})

test('a session that never finished says so, without being told off for it', () => {
  const markup = logSessionCardHtml(session({ statusLabel: 'interrupted' }), { now: NOW })
  assert.match(markup, /class="log-status">interrupted</)
})

test('a chore keeps the note and the difficulty that were written about it', () => {
  const markup = logSessionCardHtml(session({
    entries: [{
      taskName: 'Mop', outcome: 'done', actualDuration: 14, estimatedDuration: 10,
      difficultyRating: 4, notes: 'Needed <2 buckets'
    }]
  }), { open: true, now: NOW })

  assert.match(markup, /Hard/)
  assert.match(markup, /Needed &lt;<span class="fig">2<\/span> buckets/)
  assert.doesNotMatch(markup, /<2 buckets/)
})

test('a chore name that looks like markup is shown as text', () => {
  const markup = logSessionCardHtml(session({
    id: 'x" autofocus="',
    entries: [{ taskName: '<img src=x onerror=alert(1)>', outcome: 'done', actualDuration: 1 }]
  }), { open: true, now: NOW })
  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /data-id="x&quot; autofocus=&quot;"/)
})

test('the list opens only the card that was asked for', () => {
  const markup = logSessionsHtml([
    session({ id: 's1' }), session({ id: 's2', startTime: NOW - 3 * DAY })
  ], { openId: 's2', now: NOW })

  assert.equal((markup.match(/aria-expanded="true"/g) || []).length, 1)
  assert.match(markup, /data-id="s2"[\s\S]*?aria-expanded="true"/)
})

test('an empty range explains itself instead of showing a bare zero', () => {
  assert.match(logSessionsHtml([], { now: NOW }), /No sessions in this stretch/)
})
