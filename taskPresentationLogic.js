// ABOUTME: Pure task-presentation helpers for stable reference labels and safe markup.
// ABOUTME: Keeps stored task and category values escaped before they enter HTML contexts.

import { escapeHtml, formatDuration } from './helpers.js'
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

export function buildDoingTaskHtml (task, bundleIndex, bundleLength, categories = []) {
  const categoryName = resolveTaskCategoryName(task, categories)
  return '<div class="doing-progress">Task ' + (bundleIndex + 1) + ' of ' + bundleLength + '</div>' +
    '<h2>' + escapeHtml(String(task?.name ?? '')) + '</h2>' +
    '<div class="task-meta">' + escapeHtml(categoryName) + ' \u00b7 target ' + formatDuration(task?.estimatedDuration) + '</div>' +
    '<div class="timer" id="timerDisplay">00:00</div>' +
    '<div id="doingStatus"></div>' +
    '<div class="doing-actions">' +
      '<button id="doneBtn">Done</button>' +
      '<button id="alreadyDoneBtn">Already Done</button>' +
      '<button id="cancelBtn">Cancel</button>' +
      '<button id="endSessionBtn">End Session</button>' +
    '</div>'
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
