// ABOUTME: Pure task-presentation helpers for stable reference labels and safe markup.
// ABOUTME: Keeps stored task and category values escaped before they enter HTML contexts.

import { escapeHtml, formatDuration, formatFactHtml, formatTimer } from './helpers.js'
import { normalizeReferenceName, resolveReference } from './categoryLocationLogic.js'
import { formatScheduledDate, parseLocalDate, scheduleSummary } from './scheduleLogic.js'
import { cadenceDays, daysSinceCompletion } from './slip.js'

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]
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

function compactCadence (value) {
  if (!Number.isFinite(value)) return ''
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}

function scheduleFactHtml (schedule) {
  return formatFactHtml(scheduleSummary(schedule))
}

// The one phrasing for "where this chore stands": a completion fact and the
// cadence it is measured against, never a count of how far behind you are.
export function buildChoreNoteHtml (task, today) {
  const cadenceText = compactCadence(cadenceDays(task?.schedule))
  const completedDaysAgo = daysSinceCompletion(task?.lastCompletedDate, today)
  if (task?.schedule?.type !== 'periodic') {
    // A one-off's date is the only thing it knows about itself, so the note
    // carries it — once, as a plain fact, with no tally against it.
    const date = task?.schedule?.type === 'one_off' && parseLocalDate(task?.scheduledDate)
      ? ' · ' + compactScheduledDate(task.scheduledDate)
      : ''
    return formatFactHtml(scheduleSummary(task?.schedule) + date)
  }

  return formatFactHtml((completedDaysAgo === null
    ? 'not yet done'
    : 'last done ' + completedDaysAgo + 'd ago') +
    (cadenceText ? ' · about every ' + cadenceText : ''))
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

const hasRawDuration = value => (typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))

const executionSeconds = execution => Math.max(0,
  hasRawDuration(execution.rawDurationMs)
    ? Math.floor(Number(execution.rawDurationMs) / 1000)
    : Math.round(Number(execution.actualDuration || 0) * 60)
)

const outcomeTagClass = outcome => outcome === 'cancelled' ? 'tag tag-neutral' : 'tag tag-sage'

// "2 of 5 resolved" is a position, not a score. There is no target to fall short of.
function progressLine (bundle, executions) {
  const resolved = executions.filter(execution =>
    bundle.some(task => task._id === execution.taskId)).length
  return formatFactHtml(resolved + ' of ' + bundle.length + ' resolved')
}

export function buildDoingSessionHtml (session, bundle, executions, categories = []) {
  const executionByTaskId = new Map(executions.map(execution => [execution.taskId, execution]))
  const active = session?.status === 'active'
  const paused = session?.status === 'paused'

  const tasksHtml = bundle.map(task => {
    const execution = executionByTaskId.get(task._id)
    const categoryName = resolveTaskCategoryName(task, categories)
    const outcomeTag = execution
      ? '<span class="' + outcomeTagClass(execution.outcome) + '">' +
        escapeHtml(outcomeLabel(execution.outcome)) + '</span>'
      : ''
    const resultHtml = execution
      ? '<div class="doing-task-result">' +
        '<span>' + formatFactHtml(outcomeLabel(execution.outcome)) + ' \u00b7 ' +
          formatFactHtml(formatTimer(executionSeconds(execution))) + '</span>' +
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

  return '<div class="doing-session-head">' +
      '<div class="doing-head-lines">' +
        '<p class="eyebrow">Doing</p>' +
        '<div class="timer" id="sessionTimerDisplay">00:00</div>' +
        '<div class="task-meta">Budget ' +
          formatFactHtml(formatDuration(session?.timeBudgetMinutes)) + '</div>' +
      '</div>' +
      '<button id="pauseSessionBtn" class="btn btn-secondary"' + (paused ? ' hidden' : '') +
        '>Pause</button>' +
    '</div>' +
    '<p class="doing-progress">' + progressLine(bundle, executions) + '</p>' +
    '<div id="doingStatus" class="inline-status" role="status"></div>' +
    '<div id="doingTaskList">' + tasksHtml + '</div>' +
    '<div id="doingDecisionPanel"' + (paused ? '' : ' hidden') + '>' +
      '<p>The session is paused. The clock is not running.</p>' +
      '<button id="concludeSessionBtn" class="btn btn-primary">Conclude</button>' +
      '<button id="openContinueBtn" class="btn btn-secondary">Continue</button>' +
    '</div>' +
    '<div id="doingContinuePanel" hidden></div>'
}

export function buildContinuationSuggestionsHtml (tasks) {
  if (!tasks.length) return '<p class="empty">No suggestions fit the remaining time.</p>'
  return tasks.map(task =>
    '<label class="continue-option">' +
      '<input type="checkbox" data-continuation-suggestion-id="' + escapeHtml(task._id) + '"> ' +
      '<span>' + formatFactHtml(String(task?.name ?? '')) + '</span>' +
      '<span class="task-meta">' + formatFactHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
    '</label>'
  ).join('')
}

export function buildContinuationSearchResultsHtml (tasks) {
  return tasks.map(task =>
    '<button type="button" data-continuation-search-id="' + escapeHtml(task._id) + '">' +
      'Add ' + formatFactHtml(String(task?.name ?? '')) + ' · ' +
      formatFactHtml(formatDuration(task?.estimatedDuration)) +
    '</button>'
  ).join('')
}

export function buildContinuationRemainingHtml (minutes) {
  return formatFactHtml(formatDuration(minutes)) +
    ' remain in the original session budget for suggestions.'
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
