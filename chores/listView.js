import { buildTaskEditorModel } from '../categoryLocationLogic.js'
import { escapeAttribute } from '../categoryLocationView.js'
import { escapeHtml } from '../helpers.js'
import { buildTaskLedgerSummaryHtml } from '../taskPresentationLogic.js'
import { groupAndSort } from '../slip.js'
import { localDateFromDate } from '../scheduleLogic.js'
import { buildScheduleEditorModel, scheduleEditorHtml } from '../scheduleEditor.js'

export function referenceStateSuffix (reference) {
  if (reference.status === 'archived') return ' (Archived)'
  if (reference.unresolved) return ' (Unavailable)'
  return ''
}

function dueGroupSlug (name) {
  return name.toLowerCase().replace(/\s+/g, '-')
}

export function activeTaskGroupsHtml (tasks, snapshot, today, editorState = {}) {
  const groups = groupAndSort(tasks, today)
  if (!groups.length) return '<p class="empty">No active tasks.</p>'

  return groups.map(group => {
    const slug = dueGroupSlug(group.name)
    return '<section class="ledger-group" aria-labelledby="ledger-' + slug + '">' +
      '<h3 id="ledger-' + slug + '" class="ledger-eyebrow stamp"><span>' + group.name +
        '</span><span class="ledger-count fig">' + group.tasks.length + '</span></h3>' +
      '<ul class="ledger">' +
        group.tasks.map(task => activeTaskCardHtml(task, snapshot, today, editorState)).join('') +
      '</ul>' +
    '</section>'
  }).join('')
}

export function activeTaskCardHtml (
  task,
  snapshot,
  today = localDateFromDate(new Date()),
  editorState = {}
) {
  const isEditing = task._id === editorState.editingTaskId
  const editor = isEditing
    ? '<div class="ledger-row-editor">' + taskEditorHtml(task, snapshot, editorState.taskEditorError) + '</div>'
    : ''
  const actions = isEditing
    ? '<button class="btn btn-sage save-task-edit-btn" type="button">Save</button>' +
      '<button class="btn btn-ghost cancel-task-edit-btn" type="button">Cancel</button>'
    : '<button class="btn btn-ghost edit-task-btn" type="button">Edit</button>'

  return (
    '<li class="task-card ledger-row" data-id="' + escapeAttribute(task._id) + '">' +
      '<div class="ledger-row-summary">' + buildTaskLedgerSummaryHtml(task, today) + '</div>' +
      editor +
      '<div class="ledger-row-actions">' + actions +
        '<button class="btn btn-secondary archive-btn" type="button">Archive</button>' +
      '</div>' +
    '</li>'
  )
}

function taskEditorHtml (task, snapshot, taskEditorError = '') {
  const model = buildTaskEditorModel(task, snapshot)
  const selectedLocationIds = new Set(model.locationIds)
  const categoryOptions = model.categoryOptions.map(category =>
    '<option value="' + escapeAttribute(category._id) + '"' +
      (category._id === model.categoryId ? ' selected' : '') + '>' +
      escapeHtml(String(category.name)) + referenceStateSuffix(category) + '</option>'
  ).join('')
  const locationOptions = model.locationOptions.length
    ? model.locationOptions.map(location =>
        '<label class="location-option"><input class="task-edit-location" name="locationIds" type="checkbox" value="' +
          escapeAttribute(location._id) + '"' + (selectedLocationIds.has(location._id) ? ' checked' : '') + '> ' +
          '<span>' + escapeHtml(String(location.name)) + '</span>' +
          (location.status === 'archived' ? ' <span class="archived-badge">Archived</span>' : '') +
          (location.unresolved ? ' <span class="archived-badge">Unavailable</span>' : '') + '</label>'
      ).join('')
    : '<span class="empty">No locations available.</span>'

  return (
    '<div class="task-edit-form">' +
      '<label>Category <select class="task-edit-category" name="categoryId">' +
        '<option value="">-</option>' + categoryOptions + '</select></label>' +
      '<fieldset class="location-options"><legend>Locations</legend>' + locationOptions + '</fieldset>' +
      scheduleEditorHtml(buildScheduleEditorModel(task)) +
      '<div class="task-card-error" role="alert">' + escapeHtml(taskEditorError) + '</div>' +
    '</div>'
  )
}
