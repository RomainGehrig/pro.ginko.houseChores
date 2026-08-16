// ABOUTME: Renders the Chores ledger — bands, rows, the inline editor, the unscheduled list and the archive.
// ABOUTME: A row states facts only: no overdue figure, no red, nothing counting how far behind you are.

import { buildTaskEditorModel } from '../categoryLocationLogic.js'
import { escapeAttribute, escapeHtml, formatDuration } from '../helpers.js'
import { buildChoreNoteHtml } from '../taskPresentationLogic.js'
import { dueGroup } from '../slip.js'
import { scheduleSummary, localDateFromDate } from '../scheduleLogic.js'
import { buildScheduleEditorModel, scheduleEditorHtml } from '../scheduleEditor.js'
import { categoryPillsHtml, locationPillsHtml, referenceStateSuffix } from './fieldPills.js'
import {
  bandLabel, bandIsNear, cadenceColor, cadenceProgress, cadenceProgressNote,
  buildLedgerGroups, unscheduledTasks,
  archivedCountLine, unscheduledCountLine, doneLabel, permanentDeleteLabel, ledgerViews
} from './ledgerLogic.js'

export { referenceStateSuffix }

export const ESTIMATE_PRESETS = [5, 10, 15, 20, 30, 45, 60]

// The meter runs 0–2 cadences, so a chore exactly at its cadence sits at the
// halfway tick. Past that it keeps filling, and the colour stops moving.
const RIPE_SPAN = 2

const emptyCard = (title, body) =>
  '<div class="card ledger-empty"><p class="display ledger-empty-title">' + escapeHtml(title) +
  '</p><p class="muted">' + escapeHtml(body) + '</p></div>'

export function ledgerViewsHtml (unscheduledCount, activeView = 'active') {
  return ledgerViews(unscheduledCount).map(view =>
    '<button type="button" class="seg-opt" data-ledger-view="' + view.key +
      '" aria-pressed="' + (view.key === activeView ? 'true' : 'false') + '">' +
      escapeHtml(view.label) + '</button>'
  ).join('')
}

// The pool's underlined tabs were reused here early on; the ledger's own filter
// is a wrapping row of pills, which is what a set of equal choices looks like
// everywhere else in this app.
export function ledgerCategoryPillsHtml (categories, selectedId) {
  return [{ _id: '', name: 'All' }].concat(categories || []).map(category => {
    const on = (category._id || '') === (selectedId || '')
    return '<button type="button" class="pill" data-category-id="' +
      escapeAttribute(category._id || '') + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      escapeHtml(String(category.name ?? '')) + '</button>'
  }).join('')
}

export function ripeMeterHtml (task, today) {
  const progress = cadenceProgress(task, today)
  if (progress === null) return ''
  const percent = Math.min(100, (progress / RIPE_SPAN) * 100)
  return '<span class="ripe" aria-hidden="true" title="' +
    escapeAttribute(cadenceProgressNote(progress)) + '">' +
    '<span class="ripe-fill" style="width: ' + percent + '%; background: ' +
      cadenceColor(progress) + ';"></span>' +
    '<span class="ripe-due"></span></span>'
}

const taskCategory = (task, snapshot) => task?.categoryId
  ? (snapshot?.categories || []).find(item => item._id === task.categoryId) || null
  : null

function categoryFlag (task, snapshot) {
  if (!task?.categoryId) return ''
  const category = taskCategory(task, snapshot)
  if (!category) return 'Unavailable'
  return category.status === 'archived' ? 'Archived' : ''
}

// The category a chore belongs to, on the row rather than only in the editor.
// A chore with no category, and one whose category has gone, both show a dash:
// there is no name to print, and the flag beside it is where the reason goes.
function categoryTagHtml (task, snapshot) {
  const category = taskCategory(task, snapshot)
  return '<span class="row-cat tag tag-sage">' +
    (category ? escapeHtml(String(category.name ?? '')) : '—') + '</span>'
}

const estimateStepperHtml = task => {
  const minutes = Number(task?.estimatedDuration) || ''
  return '<div class="field-group"><span class="eyebrow eyebrow-quiet">Estimate</span>' +
    '<div class="estimate-stepper">' +
      '<button type="button" class="pill-icon est-minus" aria-label="Less time">−</button>' +
      '<input class="input fig est-input" type="number" name="estimatedDuration" min="1" step="1" ' +
        'inputmode="numeric" aria-label="Estimate in minutes" value="' +
        escapeAttribute(minutes) + '">' +
      '<span class="est-unit muted">min</span>' +
      '<button type="button" class="pill-icon est-plus" aria-label="More time">+</button>' +
    '</div>' +
    '<div class="pill-set" role="group" aria-label="Common estimates">' +
      ESTIMATE_PRESETS.map(preset =>
        '<button type="button" class="pill pill-compact" data-estimate="' + preset +
          '" aria-pressed="' + (minutes === preset ? 'true' : 'false') + '">' +
          preset + ' min</button>').join('') +
    '</div></div>'
}

// No Save: every control writes through as it is touched. The only two writes
// that are awkward to take back — done, and delete — ask a second time in their
// own label instead.
function rowEditorHtml (task, snapshot, state) {
  const model = buildTaskEditorModel(task, snapshot)
  const selectedLocationIds = new Set(model.locationIds)
  const confirming = state.confirmDoneId === task._id

  return '<div class="ledger-row-editor">' +
    '<div class="ledger-row-actions">' +
      '<button type="button" class="pill done-btn" aria-pressed="' +
        (confirming ? 'true' : 'false') + '">' + doneLabel(confirming) + '</button>' +
      '<button type="button" class="btn btn-ghost archive-btn">Archive</button>' +
    '</div>' +
    estimateStepperHtml(task) +
    // Every open row carries the schedule, the unscheduled ones most of all:
    // that list exists precisely to be given a day from.
    '<div class="field-group"><span class="eyebrow eyebrow-quiet">Schedule</span>' +
      scheduleEditorHtml(buildScheduleEditorModel(task)) + '</div>' +
    '<div class="field-group"><span class="eyebrow eyebrow-quiet">Category</span>' +
      categoryPillsHtml(model) + '</div>' +
    '<div class="field-group"><span class="eyebrow eyebrow-quiet">Where</span>' +
      '<fieldset class="f-locations pill-set"><legend class="visually-hidden">Locations</legend>' +
      locationPillsHtml(model, selectedLocationIds) + '</fieldset></div>' +
    '<p class="task-card-error" role="alert">' +
      escapeHtml(state.openTaskId === task._id ? (state.rowError || '') : '') + '</p>' +
  '</div>'
}

// Split out so a write-through edit can repaint one row's facts without
// rebuilding the editor the user is still touching.
export function rowSummaryHtml (task, snapshot, today, { band, tag } = {}) {
  const stamp = band === null
    ? ''
    : '<span class="row-band" aria-hidden="true">' +
      escapeHtml(band || bandLabel(dueGroup(task, today))) + '</span>'
  const flag = categoryFlag(task, snapshot)

  return stamp +
    '<span class="row-main">' +
      '<span class="row-name">' + escapeHtml(String(task?.name ?? '')) + '</span>' +
      '<span class="row-note">' + buildChoreNoteHtml(task, today) + '</span>' +
    '</span>' +
    categoryTagHtml(task, snapshot) +
    (flag ? '<span class="row-flag">' + flag + '</span>' : '') +
    (tag ? '<span class="row-tag">' + escapeHtml(tag) + '</span>' : '') +
    '<span class="row-est fig">' + escapeHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
    ripeMeterHtml(task, today)
}

export function ledgerRowHtml (task, snapshot, today, state = {}, placement = {}) {
  const open = state.openTaskId === task._id
  const band = placement.band

  return '<li class="task-card ledger-row" data-id="' + escapeAttribute(task._id) + '"' +
      (band === null ? ' data-band=""' : ' data-band="' +
        escapeAttribute(band || bandLabel(dueGroup(task, today))) + '"') +
      (placement.tag ? ' data-tag="' + escapeAttribute(placement.tag) + '"' : '') +
      (open ? ' data-open="true"' : '') + '>' +
    '<button type="button" class="ledger-row-summary" aria-expanded="' +
      (open ? 'true' : 'false') + '">' +
      rowSummaryHtml(task, snapshot, today, placement) +
    '</button>' +
    (open ? rowEditorHtml(task, snapshot, state) : '') +
  '</li>'
}

export function ledgerGroupsHtml (tasks, snapshot, today = localDateFromDate(new Date()), state = {}) {
  const groups = buildLedgerGroups(tasks, today, state.filter || {}, snapshot?.categories || [])
  if (!groups.length) {
    return emptyCard('Nothing matches',
      'No chore in this category answers to that. Clear the search, or widen the category.')
  }

  return groups.map(group => {
    const slug = group.key.toLowerCase().replace(/\s+/g, '-')
    const near = bandIsNear(group.key)
    return '<section class="ledger-group' + (near ? ' is-near' : '') +
      '" aria-labelledby="ledger-' + slug + '">' +
      '<h3 id="ledger-' + slug + '" class="ledger-eyebrow' + (near ? ' stamp' : '') +
        '"><span>' + escapeHtml(group.label) + '</span>' +
        '<span class="ledger-count fig">' + group.count + '</span></h3>' +
      '<ul class="ledger">' +
        group.tasks.map(task =>
          ledgerRowHtml(task, snapshot, today, state, { band: group.label })).join('') +
      '</ul>' +
    '</section>'
  }).join('')
}

export function unscheduledListHtml (tasks, snapshot, today = localDateFromDate(new Date()), state = {}) {
  const loose = unscheduledTasks(tasks, today, state.filter || {}, snapshot?.categories || [])
  if (!loose.length) {
    return emptyCard('Everything has a day',
      'Nothing is waiting for a date.')
  }

  return '<section class="ledger-group" aria-labelledby="ledger-unscheduled">' +
    '<h3 id="ledger-unscheduled" class="ledger-eyebrow"><span>' +
      escapeHtml(unscheduledCountLine(loose.length)) + '</span></h3>' +
    '<p class="muted ledger-group-note">No day set — these sit out of the bands ' +
      'until you give them one.</p>' +
    '<ul class="ledger">' +
      loose.map(task =>
        ledgerRowHtml(task, snapshot, today, state, { band: null, tag: 'No day set' })).join('') +
    '</ul>' +
  '</section>'
}

export function archiveListHtml (tasks, snapshot, today = localDateFromDate(new Date()), state = {}) {
  const archived = (tasks || []).filter(task => task.status === 'archived')
  if (!archived.length) {
    return emptyCard('Nothing archived',
      'Archiving a chore from the list puts it here, with its category, location and schedule intact.')
  }

  return '<section class="ledger-group" aria-labelledby="ledger-archive">' +
    '<h3 id="ledger-archive" class="ledger-eyebrow"><span>' +
      escapeHtml(archivedCountLine(archived.length)) + '</span></h3>' +
    '<ul class="ledger">' +
      archived.map(task => archivedRowHtml(task, snapshot, today, state)).join('') +
    '</ul>' +
    '<p class="muted ledger-group-note">Archived chores keep their category, location and ' +
      'schedule. Restoring returns them to the list on their own cadence. Deleting is the one ' +
      'thing the app asks twice about.</p>' +
  '</section>'
}

function archivedRowHtml (task, snapshot, today, state) {
  const confirming = state.confirmDeleteId === task._id
  const facts = [
    (snapshot?.categories || []).find(item => item._id === task.categoryId)?.name,
    formatDuration(task?.estimatedDuration),
    scheduleSummary(task?.schedule)
  ].filter(Boolean).join(' · ')

  return '<li class="task-card ledger-row archived-row" data-id="' + escapeAttribute(task._id) + '">' +
    '<div class="archived-row-head">' +
      '<span class="row-main">' +
        '<span class="row-name">' + escapeHtml(String(task?.name ?? '')) + '</span>' +
        '<span class="row-note">' + escapeHtml(facts) + '</span>' +
      '</span>' +
      '<button type="button" class="btn btn-ghost restore-task-btn">Restore</button>' +
    '</div>' +
    '<button type="button" class="pill delete-task-btn" aria-pressed="' +
      (confirming ? 'true' : 'false') + '">' + permanentDeleteLabel(confirming) + '</button>' +
  '</li>'
}
