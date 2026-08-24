// ABOUTME: Unit tests for the Today vessel and pool markup.
// ABOUTME: Guards that the vessel states facts and never refuses or scolds a pick.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildVesselFillHtml, buildVesselListHtml, buildPoolChipsHtml,
  buildCategoryTabsHtml, buildPoolEmptyHtml, buildChoreDetailHtml
} from './vesselPresentation.js'

const TODAY = '2026-08-12'
const chore = (overrides = {}) => ({
  _id: 't1',
  name: 'Empty the dishwasher',
  estimatedDuration: 5,
  scheduledDate: '2026-08-10',
  lastCompletedDate: Date.UTC(2026, 7, 9),
  schedule: { type: 'periodic', every: 2, unit: 'day' },
  ...overrides
})

test('a vessel block grows in proportion to its estimate', () => {
  const markup = buildVesselFillHtml([chore(), chore({ _id: 't2', estimatedDuration: 20 })], TODAY)
  assert.match(markup, /style="flex:5;/)
  assert.match(markup, /style="flex:20;/)
})

test('a vessel block is coloured on the ripeness ramp, not a fixed fill', () => {
  const markup = buildVesselFillHtml([chore()], TODAY)
  assert.match(markup, /background:color-mix\(in srgb, var\(--ripe-warm\) \d+%, var\(--ripe-cold\)\)/)
})

test('a vessel block says that taking a chore out sets it aside', () => {
  const markup = buildVesselFillHtml([chore()], TODAY)
  assert.match(markup, /data-remove-id="t1"/)
  assert.match(markup,
    /aria-label="Set Empty the dishwasher aside for this Quick session"/)
})

test('vessel markup escapes a chore name that looks like markup', () => {
  const markup = buildVesselFillHtml([chore({ name: '<script>x</script>' })], TODAY)
  assert.doesNotMatch(markup, /<script>/)
  assert.match(markup, /&lt;script&gt;/)
})

test('the vessel list names each chore with the fact behind it', () => {
  const markup = buildVesselListHtml([chore()], TODAY)
  assert.match(markup, /Empty the dishwasher/)
  assert.match(markup, /last done/)
  assert.match(markup, /data-remove-id="t1"/)
  assert.match(markup,
    /aria-label="Set Empty the dishwasher aside for this Quick session"/)
})

test('an empty bundle draws no blocks and no entries', () => {
  assert.equal(buildVesselFillHtml([], TODAY), '')
  assert.equal(buildVesselListHtml(null, TODAY), '')
})

test('a pool chip reports whether it is already in the session', () => {
  const markup = buildPoolChipsHtml([chore(), chore({ _id: 't2' })], ['t2'], TODAY)
  assert.match(markup, /data-pick-id="t1" aria-pressed="false"/)
  assert.match(markup, /data-pick-id="t2" aria-pressed="true"/)
})

test('a set-aside pool chip stays available and says why it looks different', () => {
  const markup = buildPoolChipsHtml([chore()], [], TODAY, ['t1'])

  assert.match(markup, /pool-chip-wrap is-excluded/)
  assert.match(markup, /Set aside/)
  assert.match(markup, /data-pick-id="t1" aria-pressed="false"/)
  assert.doesNotMatch(markup, /disabled/)
})

test('every pool chip carries a detail control reachable without a long press', () => {
  const markup = buildPoolChipsHtml([chore()], [], TODAY)
  assert.match(markup, /data-detail-id="t1"/)
  assert.match(markup, /aria-label="Details for Empty the dishwasher"/)
})

test('no pool chip is ever disabled, whatever the budget', () => {
  const markup = buildPoolChipsHtml([chore({ estimatedDuration: 600 })], [], TODAY)
  assert.doesNotMatch(markup, /disabled/)
})

test('category tabs lead with All and mark the chosen one', () => {
  const markup = buildCategoryTabsHtml([{ _id: 'c1', name: 'Admin' }], 'c1')
  assert.match(markup, /data-category-id="" aria-pressed="false"[^>]*>All</)
  assert.match(markup, /data-category-id="c1" aria-pressed="true"[^>]*>Admin</)
})

test('an empty pool points at Capture rather than blaming the filter', () => {
  const markup = buildPoolEmptyHtml('Admin')
  assert.match(markup, /Nothing waiting in Admin/)
  assert.match(markup, /Capture/)
  assert.doesNotMatch(markup, /late|overdue|behind/i)
})

test('chore detail states the facts a chore can offer about itself', () => {
  const markup = buildChoreDetailHtml(chore(), [{ _id: 'c1', name: 'Clean' }], TODAY)
  assert.match(markup, /Schedule/)
  assert.match(markup, /About every <span class="fig">2<\/span> days after completion/)
  assert.match(markup, /Estimate/)
  assert.match(markup, /History/)
  assert.match(markup, /last done <span class="fig">3<\/span>d ago/)
})

test('chore detail carries no controls of its own, so the sheet keeps its focus trap', () => {
  const markup = buildChoreDetailHtml(chore(), [], TODAY)
  assert.doesNotMatch(markup, /<button/)
})

test('nothing in the vessel or pool calls a waiting chore late', () => {
  const stale = chore({ scheduledDate: '2025-01-01', lastCompletedDate: Date.UTC(2025, 0, 1) })
  const markup = buildVesselFillHtml([stale], TODAY) + buildVesselListHtml([stale], TODAY) +
    buildPoolChipsHtml([stale], [], TODAY) + buildChoreDetailHtml(stale, [], TODAY)
  assert.doesNotMatch(markup, /late|overdue|behind|\+\d+ ?d\b/i)
})

// A chore can be hand-picked from the ledger before anyone has estimated it.
// It is in the session, so the vessel has to show it — a block with no share of
// the fill would be a chore that vanished on being added.
test('a chore with no estimate still gets a block, and says the estimate is missing', () => {
  const markup = buildVesselFillHtml([chore({ estimatedDuration: null })], TODAY)
  assert.match(markup, /style="flex:1;/)
  assert.match(markup, />\?</)
})

test('an estimated chore keeps its full share beside an unestimated one', () => {
  const markup = buildVesselFillHtml(
    [chore({ estimatedDuration: null }), chore({ _id: 't2', estimatedDuration: 20 })], TODAY)
  assert.match(markup, /style="flex:1;/)
  assert.match(markup, /style="flex:20;/)
})
