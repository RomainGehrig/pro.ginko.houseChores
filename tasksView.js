import { listAllTasks, createTask, updateTask } from './taskData.js'
import { enrichTasks } from './aiEnrich.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import {
  buildCategoryAssignmentFields,
  buildProposedTaskEditorModel,
  buildTaskEditorModel,
  sanitizeLocationIds,
  selectableReferences
} from './categoryLocationLogic.js'
import { escapeAttribute } from './categoryLocationView.js'
import { escapeHtml } from './helpers.js'
import {
  buildActiveTaskDetailsHtml,
  buildEnrichmentAvailability
} from './taskPresentationLogic.js'
import { saveTaskWithRefresh } from './taskSaveLogic.js'
import {
  buildScheduleEditorModel,
  readScheduleEditor,
  scheduleEditorHtml,
  syncScheduleEditor
} from './scheduleEditor.js'

let tasksCache = []
let editingTaskId = null
let taskEditorError = ''

export async function initTasksView() {
  document.getElementById('addTasksBtn').addEventListener('click', handleAddTasks)
  document.getElementById('enrichBtn').addEventListener('click', handleEnrich)
  document.getElementById('proposedCards').addEventListener('click', handleProposedClick)
  document.getElementById('proposedCards').addEventListener('change', handleProposedScheduleChange)
  document.getElementById('proposedCards').addEventListener('input', handleProposedScheduleChange)
  document.getElementById('activeCards').addEventListener('click', handleActiveClick)
  document.getElementById('activeCards').addEventListener('change', handleActiveScheduleChange)
  document.getElementById('activeCards').addEventListener('input', handleActiveScheduleChange)
  categoryLocationStore.subscribe(renderTasks)
  await refreshTasksView()
}

export async function refreshTasksView() {
  tasksCache = await listAllTasks()
  renderTasks()
}

function renderTasks() {
  renderProposed()
  renderActive()
  renderArchived()
  syncEnrichmentAvailability()
}

export function getActiveTasks() {
  return tasksCache.filter(t => t.status === 'active' || t.status === 'approved_recurring')
}

async function handleAddTasks() {
  const input = document.getElementById('newTaskInput')
  const names = input.value.split('\n').map(n => n.trim()).filter(Boolean)
  if (!names.length) return
  for (const name of names) {
    await createTask(name)
  }
  input.value = ''
  await refreshTasksView()
}

async function handleEnrich() {
  const statusEl = document.getElementById('enrichStatus')
  const categories = selectableReferences(categoryLocationStore.getSnapshot().categories)
  const availability = buildEnrichmentAvailability(categories)
  if (availability.disabled) {
    statusEl.textContent = availability.message
    return
  }
  const proposed = tasksCache.filter(t => t.status === 'proposed' && !t.suggestedCategory)
  if (!proposed.length) {
    statusEl.textContent = 'Nothing to enrich'
    return
  }
  statusEl.innerHTML = '<span class="freezr-spinner"></span>'
  try {
    const suggestions = await enrichTasks(proposed, categories.map(category => category.name))
    for (let i = 0; i < proposed.length; i++) {
      const s = suggestions[i]
      if (!s) continue
      await updateTask(proposed[i]._id, {
        suggestedCategory: s.category || null,
        suggestedDuration: s.estimatedDuration || null,
        suggestedSchedule: s.schedule
      })
    }
    statusEl.textContent = 'Suggestions ready - review below'
    await refreshTasksView()
  } catch (err) {
    statusEl.textContent = 'AI enrichment unavailable: ' + err.message
  }
}

function renderProposed() {
  const container = document.getElementById('proposedCards')
  const snapshot = categoryLocationStore.getSnapshot()
  const proposed = tasksCache.filter(t => t.status === 'proposed')
  container.innerHTML = proposed.length
    ? proposed.map(task => proposedCardHtml(task, snapshot)).join('')
    : '<p class="empty">No tasks awaiting review.</p>'
}

function proposedCardHtml(task, snapshot) {
  const model = buildProposedTaskEditorModel(task, snapshot)
  const categoryId = model.categoryId
  const duration = task.suggestedDuration || task.estimatedDuration || ''
  const categoryOptions = model.categoryOptions.map(category =>
    '<option value="' + escapeAttribute(category._id) + '"' +
      (category._id === categoryId ? ' selected' : '') + '>' +
      escapeHtml(String(category.name)) + referenceStateSuffix(category) + '</option>'
  ).join('')
  const selectedLocationIds = new Set(model.locationIds)
  const locationOptions = model.locationOptions.length
    ? model.locationOptions.map(location =>
        '<label class="task-location"><input class="f-location" name="locationIds" type="checkbox" value="' +
          escapeAttribute(location._id) + '"' + (selectedLocationIds.has(location._id) ? ' checked' : '') + '> ' +
          escapeHtml(String(location.name)) + referenceStateSuffix(location) + '</label>'
      ).join('')
    : '<span class="empty">No locations available.</span>'
  return (
    '<div class="task-card" data-id="' + escapeAttribute(task._id) + '">' +
      '<div class="task-name">' + escapeHtml(task.name) + '</div>' +
      '<label>Category <select class="f-category" name="categoryId"><option value="">-</option>' + categoryOptions + '</select></label>' +
      '<fieldset class="f-locations"><legend>Locations</legend>' + locationOptions + '</fieldset>' +
      '<label>Duration (min) <input class="f-duration" name="estimatedDuration" type="number" min="1" value="' + escapeAttribute(duration) + '"></label>' +
      scheduleEditorHtml(buildScheduleEditorModel(task, true)) +
      '<button class="approve-btn">Approve</button>' +
      '<div class="task-card-error" role="alert"></div>' +
    '</div>'
  )
}

function handleProposedScheduleChange (evt) {
  const editor = evt.target.closest('.schedule-editor')
  if (editor) syncScheduleEditor(editor)
}

function handleActiveScheduleChange (evt) {
  const editor = evt.target.closest('.schedule-editor')
  if (editor) syncScheduleEditor(editor)
}

function referenceStateSuffix (reference) {
  if (reference.status === 'archived') return ' (Archived)'
  if (reference.unresolved) return ' (Unavailable)'
  return ''
}

function renderActive() {
  const container = document.getElementById('activeCards')
  const active = getActiveTasks()
  const snapshot = categoryLocationStore.getSnapshot()
  container.innerHTML = active.length
    ? active.map(task => activeTaskCardHtml(task, snapshot)).join('')
    : '<p class="empty">No active tasks.</p>'
}

export function activeTaskCardHtml(task, snapshot) {
  const isEditing = task._id === editingTaskId
  const content = isEditing
    ? taskEditorHtml(task, snapshot)
    : buildActiveTaskDetailsHtml(task, snapshot)
  const actions = isEditing
    ? '<button class="save-task-edit-btn" type="button">Save</button>' +
      '<button class="cancel-task-edit-btn" type="button">Cancel</button>'
    : '<button class="edit-task-btn" type="button">Edit</button>'

  return (
    '<div class="task-card" data-id="' + escapeAttribute(task._id) + '">' +
      '<div class="task-name">' + escapeHtml(String(task.name ?? '')) + '</div>' +
      content + actions +
      '<button class="archive-btn" type="button">Archive</button>' +
    '</div>'
  )
}

function taskEditorHtml(task, snapshot) {
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

function renderArchived() {
  const container = document.getElementById('archivedCards')
  const archived = tasksCache.filter(t => t.status === 'archived')
  const snapshot = categoryLocationStore.getSnapshot()
  container.innerHTML = archived.length
    ? archived.map(task => archivedTaskCardHtml(task, snapshot)).join('')
    : '<p class="empty">No archived tasks.</p>'
}

export function archivedTaskCardHtml (task, snapshot) {
  return '<div class="task-card archived" data-id="' + escapeAttribute(task._id) + '">' +
    '<div class="task-name">' + escapeHtml(String(task.name ?? '')) + '</div>' +
    buildActiveTaskDetailsHtml(task, snapshot) +
  '</div>'
}

async function handleProposedClick(evt) {
  if (!evt.target.classList.contains('approve-btn')) return
  const card = evt.target.closest('.task-card')
  if (card.dataset.saving === 'true') return
  const id = card.dataset.id
  const task = tasksCache.find(item => item._id === id)
  if (!task) return
  const snapshot = categoryLocationStore.getSnapshot()
  const selectedCategoryId = card.querySelector('.f-category').value || null
  const selectedLocationIds = [...card.querySelectorAll('.f-location:checked')].map(input => input.value)
  const duration = Number(card.querySelector('.f-duration').value) || null
  const errorElement = card.querySelector('.task-card-error')
  errorElement.textContent = ''
  const scheduleResult = readScheduleEditor(card, { requirePatternMatch: true })
  if (!scheduleResult.ok) {
    errorElement.textContent = scheduleResult.message
    return
  }
  const referenceFields = buildTaskReferenceFields(task, selectedCategoryId, selectedLocationIds, snapshot)
  const fields = buildApprovedTaskFields(task, referenceFields, duration, scheduleResult)
  setTaskCardBusy(card, true)
  try {
    const result = await saveTaskWithRefresh(
      () => updateTask(id, fields),
      refreshTasksView
    )
    if (!result.ok) errorElement.textContent = result.message
  } finally {
    setTaskCardBusy(card, false)
  }
}

export function buildApprovedTaskFields (task, referenceFields, duration, scheduleResult) {
  return {
    ...referenceFields,
    estimatedDuration: duration,
    scheduledDate: scheduleResult.scheduledDate,
    schedule: scheduleResult.schedule,
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null,
    status: scheduleResult.schedule.type === 'one_off' ? 'active' : 'approved_recurring'
  }
}

export function buildActiveTaskScheduleFields (task, scheduleResult) {
  return {
    scheduledDate: scheduleResult.scheduledDate,
    schedule: scheduleResult.schedule,
    status: scheduleResult.schedule.type === 'one_off' ? 'active' : 'approved_recurring'
  }
}

export function buildTaskReferenceFields (
  task,
  requestedCategoryId,
  requestedLocationIds,
  snapshot = {}
) {
  const categories = snapshot.categories || []
  const locations = snapshot.locations || []
  return {
    ...buildCategoryAssignmentFields(task, requestedCategoryId, categories, {
      referencesReady: snapshot.readiness?.categories !== false
    }),
    locationIds: sanitizeLocationIds(requestedLocationIds, locations, task?.locationIds || [])
  }
}

function syncEnrichmentAvailability() {
  const categories = selectableReferences(categoryLocationStore.getSnapshot().categories)
  const availability = buildEnrichmentAvailability(categories)
  const button = document.getElementById('enrichBtn')
  const status = document.getElementById('enrichStatus')
  button.disabled = availability.disabled
  if (availability.disabled) status.textContent = availability.message
  else if (status.textContent === availability.message) status.textContent = ''
}

async function handleActiveClick(evt) {
  const card = evt.target.closest('.task-card')
  if (!card) return
  if (card.dataset.saving === 'true') return
  const id = card.dataset.id

  if (evt.target.classList.contains('archive-btn')) {
    await updateTask(id, { status: 'archived' })
    if (editingTaskId === id) {
      editingTaskId = null
      taskEditorError = ''
    }
    await refreshTasksView()
    return
  }

  if (evt.target.classList.contains('edit-task-btn')) {
    editingTaskId = id
    taskEditorError = ''
    renderActive()
    return
  }

  if (evt.target.classList.contains('cancel-task-edit-btn')) {
    editingTaskId = null
    taskEditorError = ''
    renderActive()
    return
  }

  if (!evt.target.classList.contains('save-task-edit-btn')) return
  const task = tasksCache.find(item => item._id === id)
  if (!task) return
  const snapshot = categoryLocationStore.getSnapshot()
  const requestedCategoryId = card.querySelector('.task-edit-category').value || null
  const requestedLocationIds = [...card.querySelectorAll('.task-edit-location:checked')].map(input => input.value)
  const errorElement = card.querySelector('.task-card-error')
  taskEditorError = ''
  errorElement.textContent = ''
  const dateInput = card.querySelector('[data-schedule-field="date"]')
  const scheduleResult = readScheduleEditor(card, {
    requirePatternMatch: dateInput?.value !== String(task.scheduledDate ?? '')
  })
  if (!scheduleResult.ok) {
    taskEditorError = scheduleResult.message
    errorElement.textContent = taskEditorError
    return
  }
  const referenceFields = buildTaskReferenceFields(task, requestedCategoryId, requestedLocationIds, snapshot)
  const scheduleFields = buildActiveTaskScheduleFields(task, scheduleResult)
  setTaskCardBusy(card, true)
  try {
    const result = await saveTaskWithRefresh(
      () => updateTask(id, { ...referenceFields, ...scheduleFields }),
      refreshTasksView
    )
    if (!result.ok) {
      taskEditorError = result.message
      errorElement.textContent = taskEditorError
      return
    }
    editingTaskId = null
    renderActive()
  } finally {
    setTaskCardBusy(card, false)
  }
}

function setTaskCardBusy (card, busy) {
  card.dataset.saving = String(busy)
  card.classList.toggle('is-saving', busy)
  card.setAttribute('aria-busy', String(busy))
  card.querySelectorAll('button, input, select').forEach(control => {
    control.disabled = busy
  })
}
