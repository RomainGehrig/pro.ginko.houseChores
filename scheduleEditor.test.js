import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildScheduleEditorModel,
  readScheduleEditor,
  scheduleEditorHtml,
  scheduleFromEditorValues,
  syncScheduleEditor
} from './scheduleEditor.js'

test('uses an AI rule suggestion without inventing a date', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' },
    suggestedSchedule: { type: 'periodic', every: 2, unit: 'week' }
  }, true), {
    scheduledDate: '',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  })
})

test('prefills an AI annual rule while keeping the user-owned date empty', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' },
    suggestedSchedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    }
  }, true), {
    scheduledDate: '',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    }
  })
})

test('renders progressive controls and a human summary', () => {
  const markup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
  assert.match(markup, /data-schedule-field="date"/)
  assert.match(markup, /data-schedule-field="type"/)
  assert.match(markup, /Flexible cadence/)
  assert.match(markup, /Fixed calendar/)
  assert.match(markup, /Every Sunday/)
  assert.match(markup, /data-schedule-group="fixed"/)
})

test('names every schedule form control for browser form semantics', () => {
  const markup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
  const controls = markup.match(/<(?:input|select)\b[^>]*>/g) || []

  assert.ok(controls.length > 0)
  controls.forEach(control => assert.match(control, /\bname="[^"]+"/))
})

test('gives cadence and calendar controls distinct accessible names and groups weekdays', () => {
  const markup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 8, day: 16 }
    }
  })
  const expectedNames = new Map([
    ['date', 'Scheduled date'],
    ['type', 'Repeat type'],
    ['every', 'Cadence interval'],
    ['unit', 'Cadence unit'],
    ['fixed-kind', 'Fixed calendar pattern'],
    ['month-day', 'Monthly day'],
    ['annual-month', 'Annual month'],
    ['annual-day', 'Annual day']
  ])

  for (const [field, accessibleName] of expectedNames) {
    const control = markup.match(new RegExp('<(?:input|select)\\b[^>]*data-schedule-field="' + field + '"[^>]*>'))?.[0]
    assert.ok(control, `missing ${field}`)
    assert.match(control, new RegExp('aria-label="' + accessibleName + '"'))
  }
  assert.match(markup, /<fieldset[^>]*class="schedule-weekdays"[^>]*aria-label="Weekdays"/)
  assert.match(markup, /<label><input[^>]*value="1"[^>]*> Monday<\/label>/)
  assert.match(markup, /data-schedule-fixed-group="annual_date"[^>]*role="group"[^>]*aria-label="Annual date"/)
})

test('converts form values into a validated schedule', () => {
  assert.deepEqual(scheduleFromEditorValues({
    scheduledDate: '2026-08-21',
    type: 'periodic',
    every: '2',
    unit: 'week'
  }, { requirePatternMatch: true }), {
    ok: true,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  })
})

test('serializes one-off, monthly, and annual editor flows', () => {
  assert.deepEqual(scheduleFromEditorValues({
    scheduledDate: '2026-08-21',
    type: 'one_off'
  }), {
    ok: true,
    scheduledDate: '2026-08-21',
    schedule: { type: 'one_off' }
  })
  assert.equal(scheduleFromEditorValues({
    scheduledDate: '2026-02-28',
    type: 'fixed',
    fixedKind: 'month_day',
    monthDay: '31'
  }, { requirePatternMatch: true }).ok, true)
  assert.equal(scheduleFromEditorValues({
    scheduledDate: '2026-02-28',
    type: 'fixed',
    fixedKind: 'annual_date',
    annualMonth: '2',
    annualDay: '29'
  }, { requirePatternMatch: true }).ok, true)
})

test('rejects an unknown fixed pattern instead of treating it as annual', () => {
  assert.deepEqual(scheduleFromEditorValues({
    scheduledDate: '2026-08-21',
    type: 'fixed',
    fixedKind: 'unknown',
    annualMonth: '8',
    annualDay: '21'
  }), {
    ok: false,
    message: 'Choose a valid schedule.'
  })
})

function scheduleRoot (values) {
  const nodes = new Map([
    ['[data-schedule-field="date"]', { value: values.scheduledDate }],
    ['[data-schedule-field="type"]', { value: values.type }],
    ['[data-schedule-field="every"]', { value: values.every }],
    ['[data-schedule-field="unit"]', { value: values.unit }],
    ['[data-schedule-field="fixed-kind"]', { value: values.fixedKind }],
    ['[data-schedule-field="month-day"]', { value: values.monthDay }],
    ['[data-schedule-field="annual-month"]', { value: values.annualMonth }],
    ['[data-schedule-field="annual-day"]', { value: values.annualDay }],
    ['[data-schedule-group="periodic"]', { hidden: false }],
    ['[data-schedule-group="fixed"]', { hidden: false }],
    ['[data-schedule-fixed-group="weekdays"]', { hidden: false }],
    ['[data-schedule-fixed-group="month_day"]', { hidden: false }],
    ['[data-schedule-fixed-group="annual_date"]', { hidden: false }],
    ['.schedule-summary', { textContent: '' }]
  ])
  const weekdays = values.weekdays.map(value => ({ value }))
  return {
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector => selector === '[data-schedule-field="weekday"]:checked' ? weekdays : [],
    node: selector => nodes.get(selector)
  }
}

test('reads the stable controls into a validated fixed schedule', () => {
  const root = scheduleRoot({
    scheduledDate: '2026-08-16',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'weekdays',
    weekdays: ['7'],
    monthDay: '1',
    annualMonth: '1',
    annualDay: '1'
  })

  assert.deepEqual(readScheduleEditor(root, { requirePatternMatch: true }), {
    ok: true,
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
})

test('syncs visible schedule groups and summary without changing values', () => {
  const root = scheduleRoot({
    scheduledDate: '2026-08-21',
    type: 'periodic',
    every: '2',
    unit: 'week',
    fixedKind: 'weekdays',
    weekdays: [],
    monthDay: '1',
    annualMonth: '1',
    annualDay: '1'
  })

  syncScheduleEditor(root)

  assert.equal(root.node('[data-schedule-group="periodic"]').hidden, false)
  assert.equal(root.node('[data-schedule-group="fixed"]').hidden, true)
  assert.equal(root.node('[data-schedule-fixed-group="weekdays"]').hidden, true)
  assert.equal(root.node('.schedule-summary').textContent, 'About every 2 weeks after completion')
  assert.equal(root.node('[data-schedule-field="every"]').value, '2')
})

test('validation preserves invalid annual values for correction', () => {
  const root = scheduleRoot({
    scheduledDate: '2026-02-28',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '99'
  })

  assert.equal(readScheduleEditor(root, { requirePatternMatch: true }).ok, false)
  assert.equal(root.node('[data-schedule-field="annual-month"]').value, '2')
  assert.equal(root.node('[data-schedule-field="annual-day"]').value, '99')
})
