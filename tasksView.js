import { listAllTasks, createTask, createTaskWithId, updateTask, deleteTask } from './taskData.js'
import { enrichTasks } from './aiEnrich.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import {
  buildCategoryAssignmentFields,
  buildProposedTaskEditorModel,
  sanitizeLocationIds,
  selectableReferences
} from './categoryLocationLogic.js'
import { escapeAttribute, escapeHtml, formatDuration } from './helpers.js'
import { buildEnrichmentAvailability, suggestionsNote } from './taskPresentationLogic.js'
import { localDateFromDate, taskUpdateForOutcome } from './scheduleLogic.js'
import { saveTaskWithRefresh } from './taskSaveLogic.js'
import {
  applyScheduleChoice,
  buildScheduleEditorModel,
  readScheduleEditor,
  scheduleEditorHtml,
  syncScheduleEditor
} from './scheduleEditor.js'
import {
  archiveListHtml,
  ledgerCategoryPillsHtml,
  ledgerGroupsHtml,
  ledgerViewsHtml,
  unscheduledListHtml
} from './chores/listView.js'
import { categoryPillsHtml, locationPillsHtml, referenceStateSuffix } from './chores/fieldPills.js'
import {
  choreDoneButtonHtml, choreSessionButtonHtml, editModalHtml, readEditModal
} from './chores/editModal.js'
import { doneLabel, unscheduledTasks } from './chores/ledgerLogic.js'
import { closeSheetWith, openSheet, sheetBody, sheetHeadAction } from './sheet.js'
import { optimisticArchive, pendingUndo } from './undoToast.js'
import { runArchiveAction } from './archiveView.js'
import { sessionStore } from './sessionStore.js'
import { sessionPicks } from './sessionPicks.js'
import { bundleTotal, pickedBundle } from './pickingLogic.js'
import { sessionAddActionLabel, sessionAddNote, sessionAddTarget } from './sessionAdd.js'
import { setCurrentSessionAggregate, state } from './state.js'

let tasksCache = []
const pendingTaskArchives = new Map()

// Suggestions are one optional permission, owned by Setup. Off is the default,
// and off means the control is not there at all — not there and refusing.
let suggestionsOn = false

// The Chores screen is one ledger with three views. Everything the user is part
// way through — which row is open, which button has been asked once — lives
// here so a repaint never loses it.
const ledger = {
  view: 'active',
  query: '',
  categoryId: '',
  openTaskId: null,
  confirmDoneId: null,
  confirmDeleteId: null
}

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

// A chore added to a session already under way changes what Doing is showing,
// and Doing is not this module's to import — index wires its repaint in.
let applySessionAggregate = null

export async function initTasksView({ onSessionAggregateChange = null } = {}) {
  applySessionAggregate = onSessionAggregateChange
  document.getElementById('addTasksBtn').addEventListener('click', handleAddTasks)
  document.getElementById('enrichBtn').addEventListener('click', handleEnrich)
  document.getElementById('proposedCards').addEventListener('click', handleProposedClick)
  document.getElementById('proposedCards').addEventListener('change', handleProposedScheduleChange)
  document.getElementById('proposedCards').addEventListener('input', handleProposedScheduleChange)

  for (const id of ['activeCards', 'unscheduledCards']) {
    document.getElementById(id).addEventListener('click', handleLedgerClick)
  }
  // The editor lives in the shared sheet rather than in either pane, so its
  // controls are reached from the document and filtered to the sheet's body.
  document.addEventListener('click', handleEditorClick)
  document.addEventListener('change', handleEditorChange)
  document.addEventListener('input', handleEditorChange)
  document.getElementById('archivedCards').addEventListener('click', handleArchivedClick)
  document.getElementById('choresViews').addEventListener('click', handleLedgerViewClick)
  document.getElementById('choreCategoryFilter').addEventListener('click', handleLedgerCategoryClick)
  document.getElementById('choreSearch').addEventListener('input', event => {
    ledger.query = event.target.value
    renderLedger()
  })

  categoryLocationStore.subscribe(renderTasksAfterReferencePublication)
  await refreshTasksView()
}

export function setSuggestionsEnabled (enabled) {
  const next = enabled === true
  if (suggestionsOn === next) return
  suggestionsOn = next
  if (typeof document !== 'undefined' && document.getElementById('proposedCards')) renderTasks()
}

// The router owns which view the Chores screen opens on, so #/archive is a
// place you can link to rather than a tab you have to find.
export function selectLedgerView (routeName) {
  const next = routeName === 'archive' ? 'archive' : 'active'
  if (ledger.view === next) return
  Object.assign(ledger, { view: next, openTaskId: null, confirmDoneId: null, confirmDeleteId: null })
  if (typeof document !== 'undefined') renderLedger()
}

export async function refreshTasksView() {
  tasksCache = overlayPendingTaskArchives(await listAllTasks(), pendingTaskArchives)
  renderTasks()
}

function renderTasks() {
  const snapshot = categoryLocationStore.getSnapshot()
  renderProposed()
  renderLedger(snapshot)
  syncEnrichmentAvailability()
}

function renderTasksAfterReferencePublication () {
  const drafts = captureTaskEditorDrafts()
  renderTasks()
  restoreTaskEditorDrafts(drafts)
}

// Only the Inbox cards are repainted underneath a half-finished edit. A chore's
// editor lives in the sheet, which no repaint of the ledger touches, so its
// draft survives a rename without having to be carried across.
function captureTaskEditorDrafts () {
  const drafts = new Map()

  for (const id of ['proposedCards']) {
    const container = document.getElementById(id)
    if (!container) continue
    for (const card of container.querySelectorAll('.task-card')) {
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
        weekdays: [...card.querySelectorAll('[data-schedule-toggle="weekday"][aria-pressed="true"]')]
          .map(pill => pill.dataset.scheduleValue),
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

    for (const pill of card.querySelectorAll('[data-schedule-toggle="weekday"]')) {
      pill.setAttribute('aria-pressed',
        String(draft.weekdays?.includes(pill.dataset.scheduleValue) === true))
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
    : '<div class="inbox-clear card"><p class="display inbox-clear-title">Nothing waiting</p>' +
      '<p class="muted">Nothing waiting to confirm. Anything you capture lands here first.</p></div>'
}

export function buildInboxCountLine (proposedCount) {
  if (proposedCount === 0) return 'Capture · clear'
  return 'Capture · ' + proposedCount + ' waiting'
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
      proposedCount === 0 ? 'Capture, no chores to confirm' : 'Capture, ' + proposedCount + ' to confirm'
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

// The ✦ appears only where suggestions are turned on. A control the user has
// switched off should not be present to be pressed and refused.
export const suggestionControlHtml = (name, enabled) => enabled
  ? '<button type="button" class="pill-icon enrich-one-btn" aria-label="Suggest details for ' +
    name + '">\u2726</button>'
  : ''

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
          suggestionControlHtml(name, suggestionsOn) +
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
// The same pills serve the Inbox card and the chore editor, so they climb to
// whichever of the two they are inside rather than assuming the Inbox's card.
function handleInboxPillClick (evt) {
  const pill = evt.target.closest('[data-field]')
  if (!pill) return
  const card = pill.closest('.task-card, .edit-modal')
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

// A schedule pill writes into the field behind it, then the editor repaints
// itself from those fields — the same one-way path a select would take.
function handleScheduleChoiceClick (evt) {
  const editor = evt.target.closest?.('.schedule-editor')
  if (!editor) return false
  if (!applyScheduleChoice(editor, evt.target)) return false
  syncScheduleEditor(editor)
  return true
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

function ledgerFilterCategoryName (snapshot) {
  if (!ledger.categoryId) return 'All'
  return (snapshot.categories || []).find(item => item._id === ledger.categoryId)?.name || 'All'
}

function ledgerState (snapshot) {
  return {
    openTaskId: ledger.openTaskId,
    confirmDoneId: ledger.confirmDoneId,
    confirmDeleteId: ledger.confirmDeleteId,
    filter: { query: ledger.query, category: ledgerFilterCategoryName(snapshot) }
  }
}

function renderLedger (snapshot = categoryLocationStore.getSnapshot()) {
  const today = localDateFromDate(new Date())
  const active = getActiveTasks()
  const state = ledgerState(snapshot)
  const looseCount = unscheduledTasks(active, today, {}, snapshot.categories || []).length

  const countLine = document.getElementById('choresCountLine')
  if (countLine) countLine.textContent = buildChoresCountLine(active.length)
  document.getElementById('choresViews').innerHTML = ledgerViewsHtml(looseCount, ledger.view)
  document.getElementById('choreCategoryFilter').innerHTML = ledgerCategoryPillsHtml(
    selectableReferences(snapshot.categories), ledger.categoryId)
  document.getElementById('choresFilters').hidden = ledger.view === 'archive'

  const panes = {
    active: ledgerGroupsHtml(active, snapshot, today, state),
    unscheduled: unscheduledListHtml(active, snapshot, today, state),
    archive: archiveListHtml(tasksCache, snapshot, today, state)
  }
  for (const [view, id] of [['active', 'activeCards'], ['unscheduled', 'unscheduledCards'], ['archive', 'archivedCards']]) {
    const pane = document.getElementById(id)
    pane.innerHTML = panes[view]
    pane.hidden = ledger.view !== view
  }
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
  if (handleScheduleChoiceClick(evt)) return
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
  const note = document.getElementById('enrichNote')
  button.hidden = !suggestionsOn
  if (note) note.textContent = suggestionsNote(suggestionsOn)
  button.disabled = availability.disabled
  if (!suggestionsOn) {
    if (status.textContent === availability.message) status.textContent = ''
    return
  }
  if (availability.disabled) status.textContent = availability.message
  else if (status.textContent === availability.message) status.textContent = ''
}

// A fact about what just happened, in the colour everything else is in. The
// failure line below it is the only thing on this screen that is not neutral.
function showChoresNote (message) {
  const status = document.getElementById('choresStatus')
  status.textContent = message
  status.removeAttribute('data-state')
  status.setAttribute('role', 'status')
}

function showChoresFailure (message) {
  const status = document.getElementById('choresStatus')
  status.textContent = message
  status.dataset.state = 'error'
  status.setAttribute('role', 'alert')
}

function handleLedgerViewClick (evt) {
  const tab = evt.target.closest('[data-ledger-view]')
  if (!tab) return
  Object.assign(ledger, {
    view: tab.dataset.ledgerView,
    openTaskId: null,
    confirmDoneId: null,
    confirmDeleteId: null
  })
  renderLedger()
}

function handleLedgerCategoryClick (evt) {
  const tab = evt.target.closest('[data-category-id]')
  if (!tab) return
  ledger.categoryId = tab.dataset.categoryId || ''
  renderLedger()
}

// The estimate is one value written from three places — the two steps, the
// presets and the field itself — so they all go through here.
function setRowEstimate (card, minutes) {
  const input = card.querySelector('.est-input')
  input.value = minutes > 0 ? String(minutes) : ''
  for (const preset of card.querySelectorAll('[data-estimate]')) {
    preset.setAttribute('aria-pressed', String(Number(preset.dataset.estimate) === minutes))
  }
}

function handleEstimateClick (evt, card) {
  const input = card.querySelector('.est-input')
  if (!input) return false
  const current = Number(input.value) || 0

  const preset = evt.target.closest('[data-estimate]')
  if (preset) {
    setRowEstimate(card, Number(preset.dataset.estimate))
    return true
  }
  if (evt.target.closest('.est-minus')) {
    setRowEstimate(card, Math.max(1, current - 1))
    return true
  }
  if (evt.target.closest('.est-plus')) {
    setRowEstimate(card, current + 1)
    return true
  }
  return false
}

async function markChoreRecentlyDone (task) {
  const now = Date.now()
  const fields = taskUpdateForOutcome(task, 'completed', {
    completedAt: now,
    completionDate: localDateFromDate(new Date(now))
  })
  try {
    await updateTask(task._id, fields)
    await refreshTasksView()
  } catch {
    showChoresFailure("Couldn't record that. The chore is unchanged.")
  }
}

// Putting a chore in a session is not an edit of the chore, so it leaves the
// editor rather than waiting for Save. Which session it means is settled before
// the sheet opens, so the label and the act cannot disagree.
async function addChoreToSession (task, target) {
  if (target === 'running') return addChoreToRunningSession(task)

  const added = sessionPicks.toggle(task._id)
  const bundle = pickedBundle(getActiveTasks(), sessionPicks.getPickedIds())
  showChoresNote(sessionAddNote({
    name: task.name,
    target: 'next',
    added,
    count: bundle.length,
    minutes: bundleTotal(bundle)
  }))
}

async function addChoreToRunningSession (task) {
  try {
    const aggregate = await sessionStore.attachTasks(
      state.currentSession._id, [task._id], { whileRunning: true })
    setCurrentSessionAggregate(aggregate)
    await applySessionAggregate?.(aggregate)
    showChoresNote(sessionAddNote({
      name: task.name,
      target: 'running',
      added: true,
      count: aggregate.bundle.length
    }))
  } catch (error) {
    showChoresFailure('Could not add that to the session you are doing: ' + error.message)
  }
}

// The editor is a dialogue of its own, so an edit can be abandoned without
// having already been written. Only Save writes, and it writes everything at
// once — including the name, which the row itself never let you touch.
async function openChoreEditor (id) {
  const task = tasksCache.find(item => item._id === id)
  if (!task) return
  const snapshot = categoryLocationStore.getSnapshot()
  ledger.openTaskId = id
  ledger.confirmDoneId = null

  // Both title-row controls are about the chore rather than about the edit:
  // one files a completion, the other puts it in a session.
  const target = sessionAddTarget(state.currentSession, id)
  const choice = await openSheet({
    title: 'Edit chore',
    headerActionHtml: choreDoneButtonHtml() +
      choreSessionButtonHtml(sessionAddActionLabel(target, sessionPicks.isPicked(id))),
    bodyHtml: editModalHtml(task, snapshot),
    actions: [
      { label: 'Cancel', value: null, className: 'btn btn-ghost' },
      { label: 'Save', value: 'save', className: 'btn btn-primary' }
    ]
  })

  ledger.openTaskId = null
  const body = sheetBody()
  if (choice === 'session') return addChoreToSession(task, target)
  if (choice === 'done') return markChoreRecentlyDone(task)
  if (choice === 'archive') {
    return archiveTaskOptimistically(task, {
      replace: replacement => {
        tasksCache = tasksCache.map(item => item._id === id ? replacement : item)
      },
      clearEditing: () => {},
      render: renderTasks,
      showFailure: showChoresFailure,
      pending: pendingTaskArchives
    })
  }
  if (choice !== 'save' || !body) return

  const edit = readEditModal(body, task)

  const fields = {
    ...buildTaskReferenceFields(task, edit.categoryId, edit.locationIds, snapshot),
    ...buildActiveTaskScheduleFields(task, edit.schedule),
    name: edit.name,
    estimatedDuration: edit.estimatedDuration
  }

  try {
    await updateTask(task._id, fields)
    tasksCache = tasksCache.map(item =>
      item._id === task._id ? { ...item, ...fields } : item)
    renderLedger()
  } catch {
    showChoresFailure("Couldn't save that. The chore is unchanged.")
  }
}

// The chore actions live inside the editor, so they close it: pressing them is
// leaving the edit, not part of it. Each resolves the sheet with its own value.
function handleEditorClick (evt) {
  const body = sheetBody()
  const head = sheetHeadAction()
  // Marking done sits in the title row, so the editor listens to both halves of
  // the sheet — they are siblings, not one inside the other.
  const inEditor = body?.contains(evt.target) || head?.contains(evt.target)
  if (!inEditor) return
  const card = body?.querySelector('.edit-modal')
  if (!card) return

  const done = evt.target.closest('.done-btn')
  if (done) {
    // Marking a chore done is awkward to take back, so it asks a second time
    // in its own label rather than in a dialogue on top of a dialogue.
    if (done.getAttribute('aria-pressed') !== 'true') {
      done.setAttribute('aria-pressed', 'true')
      done.textContent = doneLabel(true)
      return
    }
    return closeSheetWith('done')
  }
  if (evt.target.closest('.session-btn')) return closeSheetWith('session')
  if (evt.target.closest('.archive-btn')) return closeSheetWith('archive')

  // Anything else you touch is you carrying on editing, so the armed
  // confirmation stands down rather than waiting for a stray second press.
  const armed = head?.querySelector('.done-btn')
  if (armed?.getAttribute('aria-pressed') === 'true') {
    armed.setAttribute('aria-pressed', 'false')
    armed.textContent = doneLabel(false)
  }

  if (handleScheduleChoiceClick(evt)) return
  handleEstimateClick(evt, card)
  if (evt.target.closest('[data-field="category"]')) handleInboxPillClick(evt)
}

function handleEditorChange (evt) {
  const body = sheetBody()
  if (!body?.contains(evt.target)) return
  const editor = evt.target.closest('.schedule-editor')
  if (editor) {
    syncScheduleEditor(editor, {
      userEditedDate: evt.target.matches('[data-schedule-field="date"]')
    })
  }
  if (evt.target.closest('.est-input')) {
    for (const preset of body.querySelectorAll('[data-estimate]')) {
      preset.setAttribute('aria-pressed',
        String(Number(preset.dataset.estimate) === Number(evt.target.value)))
    }
  }
}

function handleLedgerClick (evt) {
  const card = evt.target.closest('.ledger-row')
  if (!card || !evt.target.closest('.ledger-row-summary')) return
  openChoreEditor(card.dataset.id)
}

async function handleArchivedClick (evt) {
  const button = evt.target.closest('.restore-task-btn, .delete-task-btn')
  if (!button) return
  const card = button.closest('.ledger-row')
  if (!card || card.getAttribute('aria-busy') === 'true') return
  const task = tasksCache.find(item => item._id === card.dataset.id)
  if (!task) return

  const deleting = button.classList.contains('delete-task-btn')
  if (deleting && ledger.confirmDeleteId !== task._id) {
    ledger.confirmDeleteId = task._id
    renderLedger()
    return
  }
  ledger.confirmDeleteId = null

  const status = document.getElementById('archiveStatus')
  status.textContent = ''
  status.removeAttribute('data-state')
  status.setAttribute('role', 'status')
  card.setAttribute('aria-busy', 'true')
  const result = await runArchiveAction({
    action: deleting ? 'delete' : 'restore',
    task,
    refresh: refreshTasksView
  })
  if (card.isConnected) card.setAttribute('aria-busy', 'false')
  if (!result.ok) {
    status.textContent = result.message
    status.dataset.state = 'error'
    status.setAttribute('role', 'alert')
  } else if (result.pendingArchiveRestored) {
    await refreshTasksView()
  } else {
    renderLedger()
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
