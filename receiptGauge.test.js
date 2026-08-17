// ABOUTME: Tests the Receipt gauge's geometry — the scale, its ticks and where labels sit.
// ABOUTME: Pure arithmetic, so the drag behaviour can be trusted without a browser.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gaugeSpan, gaugePercent, gaugeTicks, pinPlacement, handleOffset
} from './receiptGauge.js'

test('the scale leaves a quarter of headroom above the largest figure on it', () => {
  assert.equal(gaugeSpan({ actual: 20, estimate: 15 }), 25)
  assert.equal(gaugeSpan({ actual: 8, estimate: 15 }), 18.75)
  assert.equal(gaugeSpan({ actual: 8, estimate: 15, suggestion: 40 }), 50)
  assert.equal(gaugeSpan({ actual: 8, estimate: 15, past: [12, 60, 9] }), 75)
})

test('a gauge with nothing on it still has a scale to draw', () => {
  assert.equal(gaugeSpan({ actual: 0, estimate: 0 }), 10)
  assert.equal(gaugeSpan({}), 10)
})

test('a frozen span holds the scale still while a handle is dragged', () => {
  assert.equal(gaugeSpan({ actual: 90, estimate: 15, frozen: 25 }), 25)
})

test('percentages stay on the track however far a value runs past it', () => {
  assert.equal(gaugePercent(10, 40), 25)
  assert.equal(gaugePercent(80, 40), 100)
  assert.equal(gaugePercent(-5, 40), 0)
  assert.equal(gaugePercent(10, 0), 0)
})

test('ticks land on a round step that reads three to seven times across', () => {
  const count = span => gaugeTicks(span).length
  for (const span of [12, 25, 37.5, 50, 75, 125, 250, 600]) {
    assert.ok(count(span) >= 3 && count(span) <= 7, span + ' gave ' + count(span) + ' ticks')
  }
  assert.deepEqual(gaugeTicks(25).map(t => t.value), [5, 10, 15, 20, 25])
  assert.deepEqual(gaugeTicks(75).map(t => t.value), [10, 20, 30, 40, 50, 60, 70])
})

test('a tick carries its own label and its place on the track', () => {
  const [first] = gaugeTicks(25)
  assert.equal(first.label, '5')
  assert.equal(first.percent, 20)
})

test('a label near the left edge flips to the right of its mark', () => {
  assert.equal(pinPlacement(1, 40), 'after')
  assert.equal(pinPlacement(20, 40), 'before')
  assert.equal(pinPlacement(4.8, 40), 'before') // exactly 12% is far enough along
})

test('a handle stays reachable at both ends of the track', () => {
  assert.equal(handleOffset(1, 40), 0)
  assert.equal(handleOffset(20, 40), -11)
  assert.equal(handleOffset(39.5, 40), -22)
})
