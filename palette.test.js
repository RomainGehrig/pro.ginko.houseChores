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

// Plain CSS cannot share one rule between a media query and an attribute, so
// the dark palette is written twice. This is what stops the copies drifting.
function declarationsIn (selector, from = 0) {
  const at = css.indexOf(selector, from)
  assert.notEqual(at, -1, 'missing rule: ' + selector)
  const open = css.indexOf('{', at) + 1
  let depth = 1
  let i = open
  while (depth) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') depth -= 1
    i += 1
  }
  return css.slice(open, i - 1)
    .split(';')
    .map(line => line.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter(Boolean)
    .map(line => line.replace(/\s+/g, ' '))
}

test('the system-dark and chosen-dark palettes declare exactly the same tokens', () => {
  const system = declarationsIn(':root:not([data-theme="light"])')
  const chosen = declarationsIn(':root[data-theme="dark"] {')

  assert.ok(system.length >= 15, 'the dark palette should be the whole set, got ' + system.length)
  assert.deepEqual(chosen, system)
})

test('a chosen theme wins over the device, and pins the scheme native controls read', () => {
  // The media query has to stand aside when the user has asked for light.
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/)
  assert.match(css, /:root\[data-theme="light"\] \{ color-scheme: light; \}/)
  assert.match(css, /:root\[data-theme="dark"\] \{ color-scheme: dark; \}/)
})
