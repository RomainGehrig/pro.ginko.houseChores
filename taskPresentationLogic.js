// ABOUTME: Pure task-presentation helpers for stable reference labels and safe markup.
// ABOUTME: Keeps stored task and category values escaped before they enter HTML contexts.

import { escapeHtml, formatDuration, formatFactHtml } from './helpers.js'
import { activeElapsedMs } from './sessionLogic.js'
import {
  autoPauseNote, fitsLabel, pauseLabel, progressLine, quickAddLabel, remainingLine,
  sessionStatusLine, spentLine, tookLabel
} from './doingLines.js'
import { normalizeReferenceName, resolveReference } from './categoryLocationLogic.js'
import { cadencePhrase, formatScheduledDate, parseLocalDate, scheduleSummary } from './scheduleLogic.js'
import { daysSinceCompletion } from './slip.js'

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]
// Suggestions are a permission, not a feature that happens to you. Whichever
// way the switch is set, the Inbox says what that means before you use it.
export function suggestionsNote (on) {
  return on
    ? 'Suggestions propose a category, estimate and schedule rule for anything ' +
      'untouched. They never pick the date, and every one stays editable.'
    : 'Suggestions are off. Turn them on in Setup if you want the app to ' +
      'propose a category, estimate and schedule.'
}

export function buildEnrichmentAvailability (categories) {
  return {
    disabled: categories.length === 0,
    message: 'Add a category before using AI enrichment.'
  }
}

function compactScheduledDate (value) {
  const date = parseLocalDate(value)
  return date ? `${date.day} ${SHORT_MONTHS[date.month - 1]}` : '—'
}

function scheduleFactHtml (schedule) {
  return formatFactHtml(scheduleSummary(schedule))
}

// The one phrasing for "where this chore stands": what the rhythm is, when it
// last happened, and which day it is on — never a count of how far behind you
// are. The day is stated once, as a plain fact, and only when there is one.
export function buildChoreNoteHtml (task, today) {
  const completedDaysAgo = daysSinceCompletion(task?.lastCompletedDate, today)
  const rhythm = task?.schedule?.type === 'periodic'
    ? [
        completedDaysAgo === null ? 'not yet done' : 'last done ' + completedDaysAgo + 'd ago',
        cadencePhrase(task.schedule)
      ]
    : [scheduleSummary(task?.schedule)]

  const day = parseLocalDate(task?.scheduledDate)
    ? compactScheduledDate(task.scheduledDate)
    : ''
  return formatFactHtml(rhythm.concat(day).filter(Boolean).join(' · '))
}

export function resolveTaskCategoryName (task, categories = []) {
  if (!task?.categoryId) return String(task?.category || 'Uncategorized')
  const category = categories.find(item => item._id === task.categoryId)
  return String(category?.name || task.category || 'Unknown category')
}

const outcomeButton = (task, outcome, label, className) =>
  '<button type="button" class="' + className + '" data-task-id="' + escapeHtml(task._id) +
  '" data-outcome="' + outcome + '">' + label + '</button>'

const outcomeActionsHtml = task => task.unavailable
  ? outcomeButton(task, 'cancelled', 'Skip', 'btn btn-ghost')
  : outcomeButton(task, 'done', 'Done', 'btn btn-sage doing-done-btn') +
    outcomeButton(task, 'already_done', 'Already done', 'btn btn-secondary') +
    outcomeButton(task, 'cancelled', 'Skip', 'btn btn-ghost')

const outcomeLabel = outcome => ({
  done: 'Done',
  already_done: 'Already done',
  cancelled: 'Skipped'
})[outcome] || String(outcome || '')

const outcomeTagClass = outcome => outcome === 'done' ? 'tag tag-sage' : 'tag tag-neutral'

export function buildDoingSessionHtml (
  session, bundle, executions, categories = [], nowMs = Date.now()
) {
  const executionByTaskId = new Map(executions.map(execution => [execution.taskId, execution]))
  const active = session?.status === 'active'
  const paused = session?.status === 'paused'
  const elapsedMs = activeElapsedMs(session, nowMs)
  const resolvedCount = executions.filter(execution =>
    bundle.some(task => task._id === execution.taskId)).length
  const allResolved = bundle.length > 0 && resolvedCount === bundle.length

  const tasksHtml = bundle.map(task => {
    const execution = executionByTaskId.get(task._id)
    const categoryName = resolveTaskCategoryName(task, categories)
    const outcomeTag = execution
      ? '<span class="' + outcomeTagClass(execution.outcome) + '">' +
        escapeHtml(outcomeLabel(execution.outcome)) + '</span>'
      : ''
    const resultHtml = execution
      ? '<div class="doing-task-result">' +
        '<span>' + formatFactHtml(tookLabel(execution)) + '</span>' +
        '<button type="button" class="btn btn-ghost reopen-btn" data-reopen-execution-id="' +
          escapeHtml(String(execution._id ?? '')) + '" aria-label="Reopen ' +
          escapeHtml(String(task?.name ?? '')) + '">Reopen</button>' +
        '</div>'
      : active
        ? '<div class="doing-task-actions">' + outcomeActionsHtml(task) + '</div>'
        : ''

    return '<article class="doing-task' + (execution ? ' is-resolved' : '') +
      '" data-task-id="' + escapeHtml(task._id) + '">' +
        '<div class="doing-task-line">' +
          '<div class="doing-task-title">' +
            '<div class="task-name display">' + formatFactHtml(String(task?.name ?? '')) + '</div>' +
            '<div class="task-meta">' + formatFactHtml(categoryName) + ' \u00b7 estimate ' +
              formatFactHtml(formatDuration(task?.estimatedDuration)) + '</div>' +
          '</div>' + outcomeTag +
        '</div>' + resultHtml +
      '</article>'
  }).join('')

  // The clock and what is left of the budget both move while the session runs,
  // so each carries an id the tick refreshes in place.
  return '<div class="doing-layout">' +
    '<div class="doing-main">' +
      '<div class="doing-session-head">' +
        '<div class="doing-head-lines">' +
          '<p class="eyebrow">Doing</p>' +
          '<div class="timer" id="sessionTimerDisplay">00:00</div>' +
          '<p class="doing-status">' + escapeHtml(sessionStatusLine(session)) + '</p>' +
        '</div>' +
        '<div class="doing-head-actions">' +
          '<button id="concludeSessionBtn" class="btn btn-secondary">Conclude</button>' +
          '<button id="pauseSessionBtn" class="btn ' +
            (active ? 'btn-secondary' : 'btn-primary') + '">' +
            escapeHtml(pauseLabel(session)) + '</button>' +
        '</div>' +
      '</div>' +
      '<p class="doing-progress">' +
        formatFactHtml(progressLine(bundle.length, resolvedCount)) +
        ' \u00b7 <span id="doingRemaining">' +
        formatFactHtml(remainingLine(session, elapsedMs)) + '</span></p>' +
      '<p class="doing-spent" id="doingSpent">' +
        formatFactHtml(spentLine(executions)) + '</p>' +
      '<div id="doingStatus" class="inline-status" role="status"></div>' +
      (allResolved
        ? '<p class="doing-auto-note card">' + escapeHtml(autoPauseNote()) + '</p>'
        : '') +
      '<div id="doingTaskList">' + tasksHtml + '</div>' +
    '</div>' +
    '<aside id="doingContinuePanel" class="doing-add" aria-label="Add to the session"' +
      (active || paused ? '' : ' hidden') + '></aside>' +
  '</div>'
}

// One field does both jobs the doc gives it: it searches the chores you have,
// and whatever it does not find is offered as a new one.
export function buildAddPanelHtml (remainingMs) {
  return '<h2 class="display doing-add-title">Add to the session</h2>' +
    '<p class="muted doing-add-note" id="continueRemaining"></p>' +
    '<p class="eyebrow eyebrow-quiet doing-add-fits">' +
      escapeHtml(fitsLabel(remainingMs)) + '</p>' +
    '<div id="continueSuggestions" class="continue-rows"></div>' +
    '<input id="continueSearchInput" class="input doing-add-search" type="search" ' +
      'placeholder="Search a chore, or type a new one" ' +
      'aria-label="Search a chore, or type a new one">' +
    '<div id="continueQuickAdd"></div>' +
    '<div id="continueSearchResults" class="continue-rows"></div>' +
    '<p class="muted doing-add-foot">Anything you type that isn’t already a chore can be ' +
      'added straight to the session.</p>'
}

const continueRow = (task, control) =>
  '<label class="continue-row">' + control +
    '<span class="continue-row-name">' + formatFactHtml(String(task?.name ?? '')) + '</span>' +
    '<span class="continue-row-est fig">' +
      escapeHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
  '</label>'

// The checkbox stays the control — an attachment that fails has to be able to
// un-tick itself — but the row is what you see and press.
export function buildContinuationSuggestionsHtml (tasks) {
  if (!tasks.length) {
    return '<p class="muted continue-empty">Nothing short enough is waiting. ' +
      'Search below for anything at all.</p>'
  }
  return tasks.map(task => continueRow(task,
    '<input type="checkbox" data-continuation-suggestion-id="' +
      escapeHtml(task._id) + '" aria-label="Add ' +
      escapeHtml(String(task?.name ?? '')) + ' to the session">')).join('')
}

export function buildContinuationSearchResultsHtml (tasks) {
  return tasks.map(task =>
    '<button type="button" class="continue-row" data-continuation-search-id="' +
      escapeHtml(task._id) + '">' +
      '<span class="continue-row-name">' + formatFactHtml(String(task?.name ?? '')) + '</span>' +
      '<span class="continue-row-est fig">' +
        escapeHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
    '</button>'
  ).join('')
}

export function buildQuickAddHtml (typed) {
  const label = quickAddLabel(typed)
  return label
    ? '<button type="button" id="continueQuickAddBtn" class="btn btn-sage doing-add-quick">' +
      escapeHtml(label) + '</button>'
    : ''
}

// The budget is stated again here because this is where it would be spent, and
// the sentence after it is the rule: what you choose is never refused.
export const buildContinuationRemainingHtml = (session, elapsedMs) =>
  formatFactHtml(remainingLine(session, elapsedMs)) +
  '. Anything you pick deliberately fits, budget or not.'

function referenceSnapshot (snapshotOrCategories) {
  return Array.isArray(snapshotOrCategories)
    ? { categories: snapshotOrCategories, locations: [] }
    : {
        categories: snapshotOrCategories?.categories || [],
        locations: snapshotOrCategories?.locations || []
      }
}

function categoryPresentation (task, categories) {
  if (task?.categoryId) {
    return resolveReference(categories, task.categoryId, task.category, 'Unknown category')
  }
  const legacyName = String(task?.category || '').trim()
  if (!legacyName) return { name: 'Uncategorized', status: 'active', unresolved: false }
  const category = categories.find(item =>
    normalizeReferenceName(item.name) === normalizeReferenceName(legacyName)
  )
  return category
    ? resolveReference(categories, category._id, legacyName, 'Unknown category')
    : { name: legacyName, status: 'unknown', unresolved: true }
}

function referencePresentationHtml (reference) {
  const badge = reference.status === 'archived'
    ? ' <span class="archived-badge">Archived</span>'
    : reference.unresolved
      ? ' <span class="archived-badge">Unavailable</span>'
      : ''
  return formatFactHtml(String(reference.name)) + badge
}

export function buildActiveTaskDetailsHtml (task, snapshotOrCategories = []) {
  const { categories, locations } = referenceSnapshot(snapshotOrCategories)
  const category = categoryPresentation(task, categories)
  const assignedLocations = (Array.isArray(task?.locationIds) ? task.locationIds : [])
    .map(id => resolveReference(locations, id, null, 'Unknown location'))
  const locationMarkup = assignedLocations.length
    ? assignedLocations.map(referencePresentationHtml).join(', ')
    : 'No locations'

  return '<div class="task-meta">Category: ' + referencePresentationHtml(category) + ' \u00b7 ' +
    formatFactHtml(formatDuration(task?.estimatedDuration)) +
    ' \u00b7 ' + formatFactHtml(scheduleSummary(task?.schedule)) + '</div>' +
    '<div class="task-meta">Locations: ' + locationMarkup + '</div>' +
    '<div class="task-meta">Scheduled: ' + formatFactHtml(formatScheduledDate(task?.scheduledDate)) + '</div>'
}

export function buildBundlePreviewHtml (bundle) {
  const total = bundle.reduce((sum, task) => sum + task.estimatedDuration, 0)
  return '<h3>Proposed bundle (' + formatFactHtml(formatDuration(total)) + ')</h3><ul>' +
    bundle.map(task => '<li>' + formatFactHtml(String(task?.name ?? '')) + ' - ' +
      formatFactHtml(formatDuration(task.estimatedDuration)) +
      ' <span class="task-meta">(scheduled ' + formatFactHtml(formatScheduledDate(task?.scheduledDate)) +
      ' \u00b7 ' + formatFactHtml(scheduleSummary(task?.schedule)) + ')</span></li>').join('') +
    '</ul>'
}
