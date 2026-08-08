// ABOUTME: Pure task-presentation helpers for stable reference labels and safe markup.
// ABOUTME: Keeps stored task and category values escaped before they enter HTML contexts.

import { escapeHtml, formatDuration, formatTimer } from './helpers.js'
import { normalizeReferenceName, resolveReference } from './categoryLocationLogic.js'
import { formatScheduledDate, scheduleSummary } from './scheduleLogic.js'

export function buildEnrichmentAvailability (categories) {
  return {
    disabled: categories.length === 0,
    message: 'Add a category before using AI enrichment.'
  }
}

export function resolveTaskCategoryName (task, categories = []) {
  if (!task?.categoryId) return String(task?.category || 'Uncategorized')
  const category = categories.find(item => item._id === task.categoryId)
  return String(category?.name || task.category || 'Unknown category')
}

const outcomeActionsHtml = task => task.unavailable
  ? '<button data-task-id="' + escapeHtml(task._id) +
    '" data-outcome="cancelled">Cancel</button>'
  : '<button data-task-id="' + escapeHtml(task._id) + '" data-outcome="done">Done</button>' +
    '<button data-task-id="' + escapeHtml(task._id) +
      '" data-outcome="already_done">Already Done</button>' +
    '<button data-task-id="' + escapeHtml(task._id) +
      '" data-outcome="cancelled">Cancel</button>'

const outcomeLabel = outcome => ({
  done: 'Done',
  already_done: 'Already Done',
  cancelled: 'Cancelled'
})[outcome] || String(outcome || '')

const hasRawDuration = value => (typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))

const executionSeconds = execution => Math.max(0,
  hasRawDuration(execution.rawDurationMs)
    ? Math.floor(Number(execution.rawDurationMs) / 1000)
    : Math.round(Number(execution.actualDuration || 0) * 60)
)

export function buildDoingSessionHtml (session, bundle, executions, categories = []) {
  const executionByTaskId = new Map(executions.map(execution => [execution.taskId, execution]))
  const active = session?.status === 'active'
  const tasksHtml = bundle.map(task => {
    const execution = executionByTaskId.get(task._id)
    const categoryName = resolveTaskCategoryName(task, categories)
    const resultHtml = execution
      ? '<div class="doing-task-result">' + escapeHtml(outcomeLabel(execution.outcome)) +
        ' \u00b7 ' + formatTimer(executionSeconds(execution)) + '</div>'
      : active
        ? '<div class="doing-task-actions">' + outcomeActionsHtml(task) + '</div>'
        : ''
    return '<article class="doing-task' + (execution ? ' is-resolved' : '') +
      '" data-task-id="' + escapeHtml(task._id) + '">' +
        '<div class="task-name">' + escapeHtml(String(task?.name ?? '')) + '</div>' +
        '<div class="task-meta">' + escapeHtml(categoryName) + ' \u00b7 target ' +
          escapeHtml(formatDuration(task?.estimatedDuration)) + '</div>' +
        resultHtml +
      '</article>'
  }).join('')
  const paused = session?.status === 'paused'

  return '<div class="doing-session-head">' +
      '<div>' +
        '<div class="doing-progress">Session time</div>' +
        '<div class="timer" id="sessionTimerDisplay">00:00</div>' +
        '<div class="task-meta">Budget ' + escapeHtml(formatDuration(session?.timeBudgetMinutes)) + '</div>' +
      '</div>' +
      '<button id="pauseSessionBtn"' + (paused ? ' hidden' : '') + '>Pause</button>' +
    '</div>' +
    '<div id="doingStatus" class="inline-status" role="status"></div>' +
    '<div id="doingTaskList">' + tasksHtml + '</div>' +
    '<div id="doingDecisionPanel"' + (paused ? '' : ' hidden') + '>' +
      '<p>The session is paused.</p>' +
      '<button id="concludeSessionBtn">Conclude</button>' +
      '<button id="openContinueBtn">Continue</button>' +
    '</div>' +
    '<div id="doingContinuePanel" hidden></div>'
}

export function buildContinuationSuggestionsHtml (tasks) {
  if (!tasks.length) return '<p class="empty">No suggestions fit the remaining time.</p>'
  return tasks.map(task =>
    '<label class="continue-option">' +
      '<input type="checkbox" data-continuation-suggestion-id="' + escapeHtml(task._id) + '"> ' +
      '<span>' + escapeHtml(String(task?.name ?? '')) + '</span>' +
      '<span class="task-meta">' + escapeHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
    '</label>'
  ).join('')
}

export function buildContinuationSearchResultsHtml (tasks) {
  return tasks.map(task =>
    '<button type="button" data-continuation-search-id="' + escapeHtml(task._id) + '">' +
      'Add ' + escapeHtml(String(task?.name ?? '')) + ' · ' +
      escapeHtml(formatDuration(task?.estimatedDuration)) +
    '</button>'
  ).join('')
}

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
  return escapeHtml(String(reference.name)) + badge
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
    formatDuration(task?.estimatedDuration) +
    ' \u00b7 ' + escapeHtml(scheduleSummary(task?.schedule)) + '</div>' +
    '<div class="task-meta">Locations: ' + locationMarkup + '</div>' +
    '<div class="task-meta">Scheduled: ' + escapeHtml(formatScheduledDate(task?.scheduledDate)) + '</div>'
}

export function buildBundlePreviewHtml (bundle) {
  const total = bundle.reduce((sum, task) => sum + task.estimatedDuration, 0)
  return '<h3>Proposed bundle (' + formatDuration(total) + ')</h3><ul>' +
    bundle.map(task => '<li>' + escapeHtml(String(task?.name ?? '')) + ' - ' + formatDuration(task.estimatedDuration) +
      ' <span class="task-meta">(scheduled ' + escapeHtml(formatScheduledDate(task?.scheduledDate)) +
      ' \u00b7 ' + escapeHtml(scheduleSummary(task?.schedule)) + ')</span></li>').join('') +
    '</ul>'
}
