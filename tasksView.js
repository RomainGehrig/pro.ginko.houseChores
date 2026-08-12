import { listAllTasks, createTask, createTaskWithId, updateTask, deleteTask } from './taskData.js'
import { enrichTasks } from './aiEnrich.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import {
  buildCategoryAssignmentFields,
  buildProposedTaskEditorModel,
  sanitizeLocationIds,
  selectableReferences
} from './categoryLocationLogic.js'
import { escapeAttribute } from './categoryLocationView.js'
import { escapeHtml, formatDuration } from './helpers.js'
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
const pendingTaskArchives = new Map()

export function overlayPendingTaskArchives (tasks, pendingArchives) {
  const fetchedIds = new Set(tasks.map(task => String(task._id)))
  const overlaid = tasks.map(task =>
    pendingArchives.get(`task:${task._id}`)?.archived || task
  )
  for (const transaction of pendingArchives.values()) {
    if (!fetchedIds.has(String(transaction.archived._id))) overlaid.push(transaction.archived)
  }
  return overlaid
}

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
  tasksCache = overlayPendingTaskArchives(await listAllTasks(), pendingTaskArchives)
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
  showFailure,
  pending = null
}) {
  const transaction = optimisticArchive(task)
  pending?.set(transaction.key, transaction)
  replace(transaction.archived)
  clearEditing()
  render()

  const action = {
    key: transaction.key,
    label: 'Archived',
    commit: async () => {
      try {
        const value = await update(task._id, { status: 'archived' })
        if (pending?.get(transaction.key) === transaction) pending.delete(transaction.key)
        replace(transaction.archived)
        return { ok: true, value }
      } catch {
        if (pending?.get(transaction.key) === transaction) pending.delete(transaction.key)
        replace(transaction.original)
        render()
        const message = "Couldn't archive that. The chore is unchanged."
        showFailure(message)
        return { ok: false, message }
      }
    },
    revert: async () => {
      if (pending?.get(transaction.key) === transaction) pending.delete(transaction.key)
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
  renderInboxNavigation(proposed.length)
  container.innerHTML = proposed.length
    ? proposed.map(task => proposedCardHtml(task, snapshot)).join('')
    : '<div class="inbox-clear card"><p class="display inbox-clear-title">Inbox clear</p>' +
      '<p class="muted">Nothing waiting to confirm. Anything you capture above lands here first.</p></div>'
}

export function buildInboxCountLine (proposedCount) {
  if (proposedCount === 0) return 'Inbox · clear'
  return 'Inbox · ' + proposedCount + ' waiting'
}

export function buildChoresCountLine (activeCount) {
  if (activeCount === 0) return 'Chores · none yet'
  return 'Chores · ' + activeCount + ' active'
}

export function renderInboxNavigation (
  proposedCount,
  inboxNav = document.getElementById('inboxNav')
) {
  const countLine = typeof document === 'undefined'
    ? null
    : document.getElementById('inboxCountLine')
  if (countLine) countLine.textContent = buildInboxCountLine(proposedCount)
  if (inboxNav) {
    inboxNav.hidden = false
    inboxNav.setAttribute(
      'aria-label',
      proposedCount === 0 ? 'Inbox, no tasks to confirm' : 'Inbox, ' + proposedCount + ' to confirm'
    )
    const count = inboxNav.querySelector('.nav-count')
    if (count) {
      count.hidden = proposedCount === 0
      count.textContent = proposedCount
    }
  }
}

const DURATION_CHOICES = [5, 10, 15, 20, 30, 45]

const inboxMetaLine = (task, model) => {
  const parts = []
  const category = model.categoryOptions.find(item => item._id === model.categoryId)
  if (category) parts.push(String(category.name))
  const duration = task.suggestedDuration || task.estimatedDuration
  if (duration) parts.push(formatDuration(Number(duration)))
  if (task.suggestedCategory || task.suggestedDuration || task.suggestedSchedule) {
    parts.push('suggested — yours to change')
  }
  return parts.length ? parts.join(' · ') : 'Nothing filled in yet'
}

// Category is a pill group over a hidden input: the pills are what you touch,
// the input stays the single value everything else already reads.
const categoryPillsHtml = model =>
  '<input type="hidden" class="f-category" name="categoryId" value="' +
    escapeAttribute(model.categoryId || '') + '">' +
  '<div class="pill-set" role="group" aria-label="Category">' +
  model.categoryOptions.map(category =>
    '<button type="button" class="pill pill-compact" data-field="category" data-value="' +
      escapeAttribute(category._id) + '" aria-pressed="' +
      (category._id === model.categoryId ? 'true' : 'false') + '">' +
      escapeHtml(String(category.name)) + referenceStateSuffix(category) + '</button>'
  ).join('') + '</div>'

// Like category: the pills and the custom field both write one hidden value, so
// the custom box only ever shows a duration the pills cannot express.
const durationPillsHtml = duration => {
  const chosen = Number(duration)
  const isCustom = Boolean(duration) && !DURATION_CHOICES.includes(chosen)
  return '<input type="hidden" class="f-duration" name="estimatedDuration" value="' +
    escapeAttribute(duration) + '">' +
    '<div class="pill-set" role="group" aria-label="Takes about">' +
    DURATION_CHOICES.map(minutes =>
      '<button type="button" class="pill pill-compact" data-field="duration" data-value="' + minutes +
        '" aria-pressed="' + (chosen === minutes ? 'true' : 'false') + '">' +
        minutes + ' min</button>'
    ).join('') +
    '<input class="duration-custom pill pill-compact pill-input fig" type="number" ' +
      'name="customDuration" min="1" ' +
      'inputmode="numeric" placeholder="Custom" aria-label="Custom minutes" value="' +
      escapeAttribute(isCustom ? duration : '') + '">' +
    '</div>'
}

const locationPillsHtml = (model, selectedLocationIds) => model.locationOptions.length
  ? model.locationOptions.map(location =>
      '<label class="pill pill-compact pill-check"><input class="f-location" name="locationIds" ' +
        'type="checkbox" value="' + escapeAttribute(location._id) + '"' +
        (selectedLocationIds.has(location._id) ? ' checked' : '') + '><span>' +
        escapeHtml(String(location.name)) + referenceStateSuffix(location) + '</span></label>'
    ).join('')
  : '<span class="empty">No locations available.</span>'

function proposedCardHtml(task, snapshot) {
  const model = buildProposedTaskEditorModel(task, snapshot)
  const duration = task.suggestedDuration || task.estimatedDuration || ''
  const selectedLocationIds = new Set(model.locationIds)
  const name = escapeHtml(task.name)

  return (
    '<div class="task-card inbox-card" data-id="' + escapeAttribute(task._id) + '">' +
      '<div class="inbox-card-head">' +
        '<div class="inbox-card-title">' +
          '<div class="task-name display">' + name + '</div>' +
          '<p class="inbox-meta muted">' + escapeHtml(inboxMetaLine(task, model)) + '</p>' +
        '</div>' +
        '<div class="inbox-card-tools">' +
          '<button type="button" class="pill-icon enrich-one-btn" aria-label="Suggest details for ' +
            name + '">\u2726</button>' +
          '<button type="button" class="pill-icon discard-btn" aria-label="Discard ' +
            name + '">\u00d7</button>' +
          '<button type="button" class="btn btn-sage approve-btn">Confirm</button>' +
        '</div>' +
      '</div>' +
      '<div class="inbox-card-body">' +
        '<div class="field-group"><span class="eyebrow eyebrow-quiet">Category</span>' +
          categoryPillsHtml(model) + '</div>' +
        '<div class="field-group"><span class="eyebrow eyebrow-quiet">Takes about</span>' +
          durationPillsHtml(duration) + '</div>' +
        '<div class="field-group"><span class="eyebrow eyebrow-quiet">Where</span>' +
          '<fieldset class="f-locations pill-set">' +
          '<legend class="visually-hidden">Locations</legend>' +
          locationPillsHtml(model, selectedLocationIds) + '</fieldset></div>' +
        '<div class="field-group">' + scheduleEditorHtml(buildScheduleEditorModel(task, true)) + '</div>' +
        '<div class="task-card-error" role="alert"></div>' +
      '</div>' +
    '</div>'
  )
}

// Pills write to the field the rest of the app already reads, then repaint
// their own group so the pressed state and the value never disagree.
function handleInboxPillClick (evt) {
  const pill = evt.target.closest('[data-field]')
  if (!pill) return
  const card = pill.closest('.task-card')
  if (!card) return

  const field = pill.dataset.field
  const target = card.querySelector(field === 'category' ? '.f-category' : '.f-duration')
  if (!target) return

  const alreadyOn = pill.getAttribute('aria-pressed') === 'true'
  target.value = alreadyOn ? '' : pill.dataset.value
  if (field === 'duration') card.querySelector('.duration-custom').value = ''
  for (const sibling of pill.parentElement.querySelectorAll('[data-field="' + field + '"]')) {
    sibling.setAttribute('aria-pressed', sibling === pill && !alreadyOn ? 'true' : 'false')
  }
  target.dispatchEvent(new Event('change', { bubbles: true }))
}

function handleCustomDurationInput (evt) {
  const input = evt.target.closest('.duration-custom')
  if (!input) return
  const card = input.closest('.task-card')
  card.querySelector('.f-duration').value = input.value
  for (const pill of card.querySelectorAll('[data-field="duration"]')) {
    pill.setAttribute('aria-pressed', 'false')
  }
}

function handleProposedScheduleChange (evt) {
  if (evt.target.closest('.duration-custom')) handleCustomDurationInput(evt)
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
  const countLine = document.getElementById('choresCountLine')
  if (countLine) countLine.textContent = buildChoresCountLine(active.length)
  container.innerHTML = activeTaskGroupsHtml(active, snapshot, localDateFromDate(new Date()), {
    editingTaskId,
    taskEditorError
  })
}

async function handleEnrichOne (evt) {
  const card = evt.target.closest('.task-card')
  const task = tasksCache.find(item => item._id === card?.dataset.id)
  if (!task) return
  const categories = selectableReferences(categoryLocationStore.getSnapshot().categories)
  const availability = buildEnrichmentAvailability(categories)
  const errorElement = card.querySelector('.task-card-error')
  if (availability.disabled) {
    errorElement.textContent = availability.message
    return
  }

  errorElement.textContent = ''
  setTaskCardBusy(card, true)
  try {
    const [suggestion] = await enrichTasks([task], categories.map(category => category.name))
    if (suggestion) {
      await updateTask(task._id, {
        suggestedCategory: suggestion.category || null,
        suggestedDuration: suggestion.estimatedDuration || null,
        suggestedSchedule: suggestion.schedule
      })
      await refreshTasksView()
      return
    }
    errorElement.textContent = 'No suggestion came back. Everything you typed is untouched.'
  } catch (error) {
    errorElement.textContent = 'AI enrichment unavailable: ' + error.message
  } finally {
    setTaskCardBusy(card, false)
  }
}

// Discarding a captured line is reversible for six seconds, so the Inbox never
// has to ask twice for something you only just typed.
function handleDiscard (evt) {
  const card = evt.target.closest('.task-card')
  const task = tasksCache.find(item => item._id === card?.dataset.id)
  if (!task) return

  tasksCache = tasksCache.filter(item => item._id !== task._id)
  renderTasks()

  pendingUndo({
    key: 'discard:' + task._id,
    label: 'Discarded',
    commit: async () => {
      try {
        await deleteTask(task._id)
        return { ok: true }
      } catch {
        tasksCache = tasksCache.concat([task])
        renderTasks()
        const message = "Couldn't discard that. The chore is unchanged."
        document.getElementById('enrichStatus').textContent = message
        return { ok: false, message }
      }
    },
    revert: async () => {
      try {
        await createTaskWithId(task.name, task._id)
      } catch {
        // The record was never removed, so the refresh below still finds it.
      }
      await refreshTasksView()
      return { taskId: task._id }
    }
  }, 6000)
}

async function handleProposedClick(evt) {
  if (evt.target.closest('[data-field]')) return handleInboxPillClick(evt)
  if (evt.target.closest('.enrich-one-btn')) return handleEnrichOne(evt)
  if (evt.target.closest('.discard-btn')) return handleDiscard(evt)
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
      },
      pending: pendingTaskArchives
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
