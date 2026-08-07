// ABOUTME: Renders and reads the reusable progressive task schedule controls.
// ABOUTME: Keeps schedule form state separate from task view wiring and persistence.

import { escapeAttribute } from './categoryLocationView.js'
import { escapeHtml } from './helpers.js'
import {
  normalizeSchedule,
  scheduleSummary,
  validateScheduleInput
} from './scheduleLogic.js'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function selected (actual, expected) {
  return actual === expected ? ' selected' : ''
}

function checked (values, expected) {
  return values.includes(expected) ? ' checked' : ''
}

function scheduleFromValues (values = {}) {
  if (values.type === 'one_off') return { type: 'one_off' }
  if (values.type === 'periodic') {
    return normalizeSchedule({
      type: 'periodic',
      every: values.every,
      unit: values.unit
    })
  }
  if (values.type === 'fixed') {
    let pattern
    if (values.fixedKind === 'weekdays') {
      pattern = { kind: 'weekdays', weekdays: values.weekdays }
    } else if (values.fixedKind === 'month_day') {
      pattern = { kind: 'month_day', day: values.monthDay }
    } else if (values.fixedKind === 'annual_date') {
      pattern = { kind: 'annual_date', month: values.annualMonth, day: values.annualDay }
    } else {
      return null
    }
    return normalizeSchedule({ type: 'fixed', pattern })
  }
  return null
}

function editorValues (root) {
  const valueFor = field => root.querySelector(`[data-schedule-field="${field}"]`)?.value || ''
  return {
    scheduledDate: valueFor('date'),
    type: valueFor('type'),
    every: valueFor('every'),
    unit: valueFor('unit'),
    fixedKind: valueFor('fixed-kind'),
    weekdays: [...root.querySelectorAll('[data-schedule-field="weekday"]:checked')]
      .map(input => input.value),
    monthDay: valueFor('month-day'),
    annualMonth: valueFor('annual-month'),
    annualDay: valueFor('annual-day')
  }
}

export function buildScheduleEditorModel (task = {}, useSuggestion = false) {
  const schedule = normalizeSchedule(useSuggestion ? task.suggestedSchedule : task.schedule) ||
    normalizeSchedule(task.schedule) || { type: 'one_off' }
  return {
    scheduledDate: task.scheduledDate == null ? '' : String(task.scheduledDate),
    schedule
  }
}

export function scheduleEditorHtml (model = {}) {
  const schedule = normalizeSchedule(model.schedule) || { type: 'one_off' }
  const scheduledDate = model.scheduledDate == null ? '' : String(model.scheduledDate)
  const periodic = schedule.type === 'periodic'
  const fixed = schedule.type === 'fixed'
  const pattern = fixed ? schedule.pattern : { kind: 'weekdays', weekdays: [] }
  const fixedKind = pattern.kind
  const weekdays = fixedKind === 'weekdays' ? pattern.weekdays : []
  const every = periodic ? schedule.every : 1
  const unit = periodic ? schedule.unit : 'week'
  const monthDay = fixedKind === 'month_day' ? pattern.day : 1
  const annualMonth = fixedKind === 'annual_date' ? pattern.month : 1
  const annualDay = fixedKind === 'annual_date' ? pattern.day : 1
  const weekdayInputs = WEEKDAYS.map((name, index) => {
    const day = index + 1
    return '<label><input type="checkbox" name="scheduleWeekday" data-schedule-field="weekday" value="' + day + '"' +
      checked(weekdays, day) + '> ' + name + '</label>'
  }).join('')

  return '<section class="schedule-editor">' +
    '<label class="schedule-row">Scheduled date <input type="date" name="scheduledDate" data-schedule-field="date" value="' +
      escapeAttribute(scheduledDate) + '"></label>' +
    '<label class="schedule-row">Repeats <select name="scheduleType" data-schedule-field="type">' +
      '<option value="one_off"' + selected(schedule.type, 'one_off') + '>Once</option>' +
      '<option value="periodic"' + selected(schedule.type, 'periodic') + '>Flexible cadence</option>' +
      '<option value="fixed"' + selected(schedule.type, 'fixed') + '>Fixed calendar</option>' +
    '</select></label>' +
    '<div data-schedule-group="periodic"' + (periodic ? '' : ' hidden') + '>' +
      '<label class="schedule-row">Every <input type="number" name="scheduleEvery" min="1" step="1" data-schedule-field="every" value="' +
        escapeAttribute(every) + '"> <select name="scheduleUnit" data-schedule-field="unit">' +
          '<option value="day"' + selected(unit, 'day') + '>day(s)</option>' +
          '<option value="week"' + selected(unit, 'week') + '>week(s)</option>' +
          '<option value="month"' + selected(unit, 'month') + '>month(s)</option>' +
          '<option value="year"' + selected(unit, 'year') + '>year(s)</option>' +
        '</select> after completion</label>' +
    '</div>' +
    '<div data-schedule-group="fixed"' + (fixed ? '' : ' hidden') + '>' +
      '<label class="schedule-row">Pattern <select name="scheduleFixedKind" data-schedule-field="fixed-kind">' +
        '<option value="weekdays"' + selected(fixedKind, 'weekdays') + '>Days of the week</option>' +
        '<option value="month_day"' + selected(fixedKind, 'month_day') + '>Day of each month</option>' +
        '<option value="annual_date"' + selected(fixedKind, 'annual_date') + '>Annual date</option>' +
      '</select></label>' +
      '<div class="schedule-weekdays" data-schedule-fixed-group="weekdays"' + (fixedKind === 'weekdays' ? '' : ' hidden') + '>' + weekdayInputs + '</div>' +
      '<label class="schedule-row" data-schedule-fixed-group="month_day"' + (fixedKind === 'month_day' ? '' : ' hidden') + '>Day <input type="number" name="scheduleMonthDay" min="1" max="31" step="1" data-schedule-field="month-day" value="' + escapeAttribute(monthDay) + '"> of each month</label>' +
      '<label class="schedule-row" data-schedule-fixed-group="annual_date"' + (fixedKind === 'annual_date' ? '' : ' hidden') + '>Month <input type="number" name="scheduleAnnualMonth" min="1" max="12" step="1" data-schedule-field="annual-month" value="' + escapeAttribute(annualMonth) + '"> Day <input type="number" name="scheduleAnnualDay" min="1" max="31" step="1" data-schedule-field="annual-day" value="' + escapeAttribute(annualDay) + '"></label>' +
    '</div>' +
    '<div class="schedule-summary">' + escapeHtml(scheduleSummary(schedule)) + '</div>' +
  '</section>'
}

export function scheduleFromEditorValues (values, options) {
  return validateScheduleInput({
    scheduledDate: values?.scheduledDate,
    schedule: scheduleFromValues(values)
  }, options)
}

export function readScheduleEditor (root, options) {
  return scheduleFromEditorValues(editorValues(root), options)
}

export function syncScheduleEditor (root) {
  const values = editorValues(root)
  const periodic = root.querySelector('[data-schedule-group="periodic"]')
  const fixed = root.querySelector('[data-schedule-group="fixed"]')
  const fixedGroups = {
    weekdays: root.querySelector('[data-schedule-fixed-group="weekdays"]'),
    month_day: root.querySelector('[data-schedule-fixed-group="month_day"]'),
    annual_date: root.querySelector('[data-schedule-fixed-group="annual_date"]')
  }

  if (periodic) periodic.hidden = values.type !== 'periodic'
  if (fixed) fixed.hidden = values.type !== 'fixed'
  for (const [kind, group] of Object.entries(fixedGroups)) {
    if (group) group.hidden = values.type !== 'fixed' || values.fixedKind !== kind
  }

  const summary = root.querySelector('.schedule-summary')
  if (summary) summary.textContent = scheduleSummary(scheduleFromValues(values))
}
