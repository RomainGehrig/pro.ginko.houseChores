// ABOUTME: Pins the app's colour tokens to the Organic design system's tonal ramp.
// ABOUTME: The revised design document dropped every hand-mixed translucency for a flat ramp step.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('./index.css', import.meta.url), 'utf8')

// The document quotes these literals directly, so the app has to resolve to the
// same six figures rather than to something that merely looks close.
const RAMP = {
  '--graphite': '#645C50', // neutral-700 — every secondary line
  '--stamp': '#8C491A', // accent-700 — eyebrows and confirm states
  '--sage-soft': '#E1EECC', // accent-2-200 — the settled plate
  '--sage-ink': '#56633F', // accent-2-700 — sage-voiced text on the ground
  '--on-sage-soft': '#3D472B' // accent-2-800 — text on that plate
}

function lightRoot () {
  const start = css.indexOf(':root {')
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

test('the light palette sits on the design system ramp', () => {
  const root = lightRoot()
  for (const [token, value] of Object.entries(RAMP)) {
    assert.match(root, new RegExp(token + ':\\s*' + value + ';'), token + ' should be ' + value)
  }
})

test('no hand-mixed colour from the earlier pass survives', () => {
  for (const legacy of ['#5A544D', '#9C3520', '#DFE6CF', '#3D4A2C']) {
    assert.equal(css.includes(legacy), false, legacy + ' should be gone')
  }
})

test('eyebrows are stamped in accent-700, not in the accent itself', () => {
  const eyebrow = css.slice(css.indexOf('\n.eyebrow {'), css.indexOf('\n.eyebrow-quiet'))
  assert.match(eyebrow, /color: var\(--stamp\);/)
})

test('dark keeps the same relationships with the ramp read upwards', () => {
  const dark = css.slice(css.indexOf('prefers-color-scheme: dark'), css.indexOf('\n*,\n*::before'))
  assert.match(dark, /--stamp:\s*#FFC6A5;/) // accent-300, as far above the accent as #8C491A is below
  assert.match(dark, /--sage-ink:\s*#CCDBB2;/) // accent-2-300
  assert.match(dark, /--on-sage-soft:\s*#E1EECC;/) // accent-2-200 on the dark sage plate
})
