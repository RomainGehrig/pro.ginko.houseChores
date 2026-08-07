import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildScheduleEditorModel,
  readScheduleEditor,
  scheduleEditorHtml,
  scheduleFromEditorValues,
  syncScheduleEditor
} from './scheduleEditor.js'

test('keeps a blank app-managed date for a flexible AI rule', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' },
    suggestedSchedule: { type: 'periodic', every: 2, unit: 'week' }
  }, true, '2026-08-07'), {
    scheduledDate: '',
    schedule: { type: 'periodic', every: 2, unit: 'week' },
    dateOwner: 'app'
  })
})

test('keeps a blank app-managed date for a one-off task', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' }
  }, false, '2026-08-07'), {
    scheduledDate: '',
    schedule: { type: 'one_off' },
    dateOwner: 'app'
  })
})

test('infers an app-managed date from an AI fixed calendar rule', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' },
    suggestedSchedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    }
  }, true, '2026-08-07'), {
    scheduledDate: '2027-02-28',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    },
    dateOwner: 'app'
  })
})

test('treats an existing scheduled date as user-managed', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: '2026-08-08',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    }
  }, false, '2026-08-07'), {
    scheduledDate: '2026-08-08',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    },
    dateOwner: 'user'
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
  assert.match(markup, /data-schedule-date-owner="user"/)
  assert.match(markup, /class="schedule-date-hint"/)
  assert.match(markup, /Suggested from the calendar; choose any date\./)
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
  }), {
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
  }).ok, true)
  assert.equal(scheduleFromEditorValues({
    scheduledDate: '2026-08-08',
    type: 'fixed',
    fixedKind: 'annual_date',
    annualMonth: '7',
    annualDay: '1'
  }).ok, true)
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
    ['.schedule-date-hint', { hidden: false }],
    ['.schedule-summary', { textContent: '' }]
  ])
  const weekdays = values.weekdays.map(value => ({ value }))
  return {
    dataset: { scheduleDateOwner: values.dateOwner || 'app' },
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

  assert.deepEqual(readScheduleEditor(root), {
    ok: true,
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
})

test('syncs visible schedule groups and summary without changing values', () => {
  const root = scheduleRoot({
    scheduledDate: '',
    dateOwner: 'app',
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
  assert.equal(root.node('[data-schedule-field="date"]').value, '')
})

test('updates a fixed date while it remains app-managed', () => {
  const root = scheduleRoot({
    scheduledDate: '',
    dateOwner: 'app',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '29'
  })

  syncScheduleEditor(root, { today: '2026-08-07' })
  assert.equal(root.node('[data-schedule-field="date"]').value, '2027-02-28')

  root.node('[data-schedule-field="annual-month"]').value = '12'
  root.node('[data-schedule-field="annual-day"]').value = '25'
  syncScheduleEditor(root, { today: '2026-08-07' })
  assert.equal(root.node('[data-schedule-field="date"]').value, '2026-12-25')
})

test('preserves a manually edited date across later fixed rule changes', () => {
  const root = scheduleRoot({
    scheduledDate: '2027-02-28',
    dateOwner: 'app',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '29'
  })

  root.node('[data-schedule-field="date"]').value = '2026-08-08'
  syncScheduleEditor(root, { today: '2026-08-07', userEditedDate: true })
  root.node('[data-schedule-field="annual-month"]').value = '12'
  root.node('[data-schedule-field="annual-day"]').value = '25'
  syncScheduleEditor(root, { today: '2026-08-07' })

  assert.equal(root.dataset.scheduleDateOwner, 'user')
  assert.equal(root.node('[data-schedule-field="date"]').value, '2026-08-08')
})

test('waits on an invalid fixed rule without clearing an app-managed date', () => {
  const root = scheduleRoot({
    scheduledDate: '2026-08-08',
    dateOwner: 'app',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '99'
  })

  syncScheduleEditor(root, { today: '2026-08-07' })
  assert.equal(root.node('[data-schedule-field="date"]').value, '2026-08-08')
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

  assert.equal(readScheduleEditor(root).ok, false)
  assert.equal(root.node('[data-schedule-field="annual-month"]').value, '2')
  assert.equal(root.node('[data-schedule-field="annual-day"]').value, '99')
})
