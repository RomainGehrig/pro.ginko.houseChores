// ABOUTME: Pure task-presentation helpers for stable reference labels and safe markup.
// ABOUTME: Keeps stored task and category values escaped before they enter HTML contexts.

import { escapeHtml, formatDate, formatDuration } from './helpers.js'

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
    '<div class="doing-actions">' +
      '<button id="doneBtn">Done</button>' +
      '<button id="alreadyDoneBtn">Already Done</button>' +
      '<button id="cancelBtn">Cancel</button>' +
      '<button id="endSessionBtn">End Session</button>' +
    '</div>'
}

export function buildActiveTaskDetailsHtml (task, categories = []) {
  return '<div class="task-meta">' + escapeHtml(resolveTaskCategoryName(task, categories)) + ' \u00b7 ' +
    formatDuration(task?.estimatedDuration) +
    (task?.recurrence ? ' \u00b7 every ' + task.recurrence + 'd' : '') + '</div>' +
    '<div class="task-meta">Next due: ' + formatDate(task?.nextDueDate) + '</div>'
}

export function buildBundlePreviewHtml (bundle) {
  const total = bundle.reduce((sum, task) => sum + task.estimatedDuration, 0)
  return '<h3>Proposed bundle (' + formatDuration(total) + ')</h3><ul>' +
    bundle.map(task => '<li>' + escapeHtml(String(task?.name ?? '')) + ' - ' + formatDuration(task.estimatedDuration) +
      ' <span class="task-meta">(due ' + formatDate(task.nextDueDate) + ')</span></li>').join('') +
    '</ul>'
}
