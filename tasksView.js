import { listAllTasks, createTask, updateTask } from './taskData.js'
import { enrichTasks } from './aiEnrich.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import {
  buildCategoryAssignmentFields,
  buildProposedTaskEditorModel,
  sanitizeLocationIds,
  selectableReferences
} from './categoryLocationLogic.js'
import { escapeAttribute } from './categoryLocationView.js'
import { escapeHtml } from './helpers.js'
import { buildEnrichmentAvailability } from './taskPresentationLogic.js'
import { localDateFromDate } from './scheduleLogic.js'
import { saveTaskWithRefresh } from './taskSaveLogic.js'
import {
  buildScheduleEditorModel,
  readScheduleEditor,
  scheduleEditorHtml,
  syncScheduleEditor
} from './scheduleEditor.js'
import { activeTaskGroupsHtml, referenceStateSuffix } from './chores/listView.js'
import { optimisticArchive, pendingUndo } from './undoToast.js'
import { renderArchiveView } from './archiveView.js'

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
  categoryLocationStore.subscribe(renderTasksAfterReferencePublication)
  await refreshTasksView()
}

export async function refreshTasksView() {
  tasksCache = await listAllTasks()
  renderTasks()
}

function renderTasks() {
  const snapshot = categoryLocationStore.getSnapshot()
  renderProposed()
  renderActive(snapshot)
  renderArchiveView(tasksCache, snapshot)
  syncEnrichmentAvailability()
}

function renderTasksAfterReferencePublication () {
  const drafts = captureTaskEditorDrafts()
  renderTasks()
  restoreTaskEditorDrafts(drafts)
}

function captureTaskEditorDrafts () {
  const drafts = new Map()
  const containers = [
    { id: 'proposedCards', accepts: () => true },
    { id: 'activeCards', accepts: card => Boolean(card.querySelector('.task-edit-form')) }
  ]

  for (const { id, accepts } of containers) {
    const container = document.getElementById(id)
    if (!container) continue
    for (const card of container.querySelectorAll('.task-card')) {
      if (!accepts(card)) continue
      const controls = [...card.querySelectorAll('input[name], select[name], textarea[name]')]
      drafts.set(id + ':' + card.dataset.id, {
        controls: controls.map(control => ({
          tagName: control.tagName,
          name: control.name,
          value: control.value,
          checked: control.type === 'checkbox' || control.type === 'radio'
            ? control.checked
            : null
        })),
        scheduleDateOwner: card.querySelector('.schedule-editor')?.dataset.scheduleDateOwner || null
      })
    }
  }
  return drafts
}

function restoreTaskEditorDrafts (drafts) {
  for (const [key, draft] of drafts) {
    const separator = key.indexOf(':')
    const container = document.getElementById(key.slice(0, separator))
    const taskId = key.slice(separator + 1)
    const card = [...(container?.querySelectorAll('.task-card') || [])]
      .find(candidate => candidate.dataset.id === taskId)
    if (!card) continue

    const controls = [...card.querySelectorAll('input[name], select[name], textarea[name]')]
    for (const draftControl of draft.controls) {
      const control = controls.find(candidate =>
        candidate.tagName === draftControl.tagName &&
        candidate.name === draftControl.name &&
        (draftControl.checked === null || candidate.value === draftControl.value)
      )
      if (!control) continue
      if (draftControl.checked === null) control.value = draftControl.value
      else control.checked = draftControl.checked
    }

    const scheduleEditor = card.querySelector('.schedule-editor')
    if (scheduleEditor) {
      if (draft.scheduleDateOwner) {
        scheduleEditor.dataset.scheduleDateOwner = draft.scheduleDateOwner
      }
      syncScheduleEditor(scheduleEditor)
    }
  }
}

export function getActiveTasks() {
  return tasksCache.filter(t => t.status === 'active' || t.status === 'approved_recurring')
}

export function archiveTaskOptimistically (task, {
  replace,
  clearEditing,
  render,
  queue = pendingUndo,
  update = updateTask,
  showFailure
}) {
  const transaction = optimisticArchive(task)
  replace(transaction.archived)
  clearEditing()
  render()

  const action = {
    key: transaction.key,
    label: 'Archived',
    commit: async () => {
      try {
        const value = await update(task._id, { status: 'archived' })
        return { ok: true, value }
      } catch {
        replace(transaction.original)
        render()
        const message = "Couldn't archive that. The chore is unchanged."
        showFailure(message)
        return { ok: false, message }
      }
    },
    revert: async () => {
      replace(transaction.original)
      render()
      return { taskId: task._id, status: transaction.original.status }
    }
  }

  return { transaction, queued: queue(action, 6000) }
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
  const inboxNav = document.getElementById('inboxNav')
  if (inboxNav) {
    inboxNav.hidden = proposed.length === 0
    inboxNav.setAttribute('aria-label', 'Inbox, ' + proposed.length + ' to confirm')
    const count = inboxNav.querySelector('.nav-count')
    if (count) count.textContent = proposed.length
  }
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
  if (editor) {
    syncScheduleEditor(editor, {
      userEditedDate: evt.target.matches('[data-schedule-field="date"]')
    })
  }
}

function handleActiveScheduleChange (evt) {
  const editor = evt.target.closest('.schedule-editor')
  if (editor) {
    syncScheduleEditor(editor, {
      userEditedDate: evt.target.matches('[data-schedule-field="date"]')
    })
  }
}

function renderActive(snapshot = categoryLocationStore.getSnapshot()) {
  const container = document.getElementById('activeCards')
  const active = getActiveTasks()
  container.innerHTML = activeTaskGroupsHtml(active, snapshot, localDateFromDate(new Date()), {
    editingTaskId,
    taskEditorError
  })
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
  const scheduleResult = readScheduleEditor(card)
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
    const task = tasksCache.find(item => item._id === id)
    if (!task) return
    archiveTaskOptimistically(task, {
      replace: replacement => {
        tasksCache = tasksCache.map(item => item._id === id ? replacement : item)
      },
      clearEditing: () => {
        if (editingTaskId === id) {
          editingTaskId = null
          taskEditorError = ''
        }
      },
      render: renderTasks,
      showFailure: message => {
        const status = document.getElementById('choresStatus')
        status.textContent = message
        status.dataset.state = 'error'
        status.setAttribute('role', 'alert')
      }
    })
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
  const scheduleResult = readScheduleEditor(card)
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
