import { listAllTasks, createTask, createTaskWithId, updateTask, deleteTask } from './taskData.js'
import { enrichTasks } from './aiEnrich.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import {
  buildCategoryAssignmentFields,
  buildProposedTaskEditorModel,
  sanitizeLocationIds,
  selectableReferences
} from './categoryLocationLogic.js'
import { escapeAttribute, escapeHtml, formatDuration, formatFactHtml } from './helpers.js'
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
import { editModalHtml, readEditModal } from './chores/editModal.js'
import {
  armOrConfirmDone, choreDoneButtonHtml, choreSessionButtonHtml,
  completionFailureMessage, disarmDone
} from './chores/choreActions.js'
import { unscheduledTasks } from './chores/ledgerLogic.js'
import { closeSheetWith, openSheet, sheetBody, sheetHeadAction } from './sheet.js'
import { optimisticArchive, pendingUndo } from './undoToast.js'
import { runArchiveAction } from './archiveView.js'
import { sessionStore } from './sessionStore.js'
import { sessionPicks } from './sessionPicks.js'
import { bundleTotal, pickedBundle } from './pickingLogic.js'
import { isAsNeededTask, isTaskEligible, taskModeFields } from './taskModeLogic.js'
import { deferReadinessFields, markReadyFields } from './asNeededLogic.js'
import { asNeededCategoryPillsHtml, asNeededScreenHtml } from './asNeededView.js'
import {
  sessionAddActionLabel, sessionAddLanded, sessionAddNote, sessionAddRejected, sessionAddTarget,
  sessionFloatModel, sessionMarks, sessionUnderWay
} from './sessionAdd.js'
import { setCurrentSessionAggregate, state } from './state.js'

let tasksCache = []
const pendingTaskArchives = new Map()
const taskOperationQueues = new Map()
let tasksRefreshGeneration = 0
let tasksViewNow = Date.now

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

const asNeededState = {
  query: '',
  categoryId: '',
  confirmingDoneId: null,
  datePrompt: null
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
const taskRefreshSubscribers = new Set()

export function subscribeTaskRefresh (subscriber) {
  if (typeof subscriber !== 'function') return () => {}
  taskRefreshSubscribers.add(subscriber)
  return () => taskRefreshSubscribers.delete(subscriber)
}

function announceTaskRefresh () {
  for (const subscriber of [...taskRefreshSubscribers]) {
    try { subscriber() } catch { /* one screen must not block another */ }
  }
}

export async function initTasksView({
  onSessionAggregateChange = null,
  now = Date.now
} = {}) {
  applySessionAggregate = onSessionAggregateChange
  tasksViewNow = now
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
  document.getElementById('asNeededCards')?.addEventListener('click', handleAsNeededClick)
  document.getElementById('asNeededCards')?.addEventListener('input', handleAsNeededInput)
  document.getElementById('asNeededCategoryFilter')?.addEventListener('click', handleAsNeededCategoryClick)
  document.getElementById('asNeededSearch')?.addEventListener('input', event => {
    asNeededState.query = event.target.value
    renderAsNeeded()
  })

  categoryLocationStore.subscribe(renderTasksAfterReferencePublication)
  // Picking happens on two screens now, so the list repaints on either.
  sessionPicks.subscribe(() => {
    if (document.getElementById('activeCards')) renderLedger()
  })
  await refreshTasksView()
}

export function setSuggestionsEnabled (enabled) {
  const next = enabled === true
  if (suggestionsOn === next) return
  suggestionsOn = next
  if (typeof document !== 'undefined' && document.getElementById('proposedCards')) renderTasks()
}

// The router owns which view the Chores screen opens on, so #/archive is a
// place you can link to rather than a tab you have to find. Arriving always
// repaints: a session may have started or ended while you were elsewhere, and
// the list says which chores are in one.
export function selectLedgerView (routeName) {
  const next = routeName === 'archive' ? 'archive' : 'active'
  if (ledger.view !== next) {
    Object.assign(ledger, {
      view: next, openTaskId: null, confirmDoneId: null, confirmDeleteId: null
    })
  }
  if (typeof document === 'undefined') return
  // The line describes something that happened while you were here. Arriving
  // fresh, it is about a moment that has passed — and a session may have
  // started since, which would leave it naming the wrong one.
  clearChoresNote()
  renderLedger()
}

// The session the ledger describes can arrive after the first paint — recovery
// reads it from the server — and it can end on another screen. Either way the
// list has to be told; nothing it owns has changed.
export function refreshSessionMarks () {
  if (typeof document !== 'undefined' && document.getElementById('activeCards')) renderLedger()
}

export async function refreshTasksView() {
  const refreshGeneration = ++tasksRefreshGeneration
  const fetched = await listAllTasks()
  // A task read is a snapshot of the entire cache. A later read or optimistic
  // replacement owns publication, even when this older response arrives last.
  if (refreshGeneration !== tasksRefreshGeneration) return
  tasksCache = overlayPendingTaskArchives(fetched, pendingTaskArchives)
  reconcileAsNeededTransientState()
  // A pick is a chore you mean to do next, so one that has left the list is not
  // a pick any more — left behind, it would put the chore back in the session
  // the day it is restored. What the server holds is what counts here: an
  // archive still waiting on its undo keeps its pick, to give back with the
  // chore if the undo comes.
  sessionPicks.retain(fetched.filter(availableLiveTask).map(task => task._id))
  renderTasks()
  announceTaskRefresh()
}

function reconcileAsNeededTransientState () {
  const confirmingTask = tasksCache.find(task => task._id === asNeededState.confirmingDoneId)
  if (!confirmingTask || !liveTask(confirmingTask) || !isAsNeededTask(confirmingTask) ||
    confirmingTask.readiness !== 'ready') {
    asNeededState.confirmingDoneId = null
  }

  const prompt = asNeededState.datePrompt
  if (!prompt) return
  const promptTask = tasksCache.find(task => task._id === prompt.taskId)
  const applicableReadiness = prompt?.action === 'not-ready' ? 'ready' : 'waiting'
  if (!promptTask || !liveTask(promptTask) || !isAsNeededTask(promptTask) ||
    promptTask.schedule?.type !== 'one_off' || promptTask.readiness !== applicableReadiness) {
    asNeededState.datePrompt = null
  }
}

function renderTasks() {
  const snapshot = categoryLocationStore.getSnapshot()
  renderProposed()
  renderLedger(snapshot)
  renderAsNeeded(snapshot)
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

const liveTask = task =>
  task.status === 'active' || task.status === 'approved_recurring'

const availableLiveTask = task => liveTask(task) && isTaskEligible(task)

export function getActiveTasks() {
  return tasksCache.filter(availableLiveTask)
}

export function getAsNeededTasks () {
  return tasksCache.filter(task => liveTask(task) && isAsNeededTask(task))
}

function replaceCachedTask (replacement) {
  // Do this before replacing so an already-fetched aggregate cannot overwrite
  // the new optimistic task while its own write and refresh are still moving.
  tasksRefreshGeneration++
  tasksCache = tasksCache.map(task =>
    task._id === replacement._id ? replacement : task)
}

export async function saveChoreEditorFields (task, fields, {
  getCurrent = id => tasksCache.find(item => item._id === id),
  replace = replaceCachedTask,
  render = renderTasks,
  update = updateTask,
  picks = sessionPicks,
  eligibleIds = () => tasksCache.filter(availableLiveTask).map(item => item._id),
  showFailure = message => showEditorFailure(message)
} = {}) {
  try {
    await update(task._id, fields)
  } catch {
    const message = "Couldn't save that. The chore is unchanged."
    showFailure(message)
    return { ok: false, stage: 'write', message }
  }

  // Publication starts only after the write is durable. replaceCachedTask also
  // invalidates any aggregate read that captured the older task beforehand.
  const current = getCurrent(task._id) || task
  replace({ ...current, ...fields })
  reconcileAsNeededTransientState()
  const before = picks.getPickedIds()
  const after = picks.retain(eligibleIds())
  const pickChanged = before.length !== after.length ||
    before.some((id, index) => id !== after[index])
  render()
  if (!pickChanged) announceTaskRefresh()
  return { ok: true, stage: null, message: '' }
}

// Readiness and completion both rewrite the same task record. Every click gets
// a turn in arrival order, even after the prior turn fails, and each turn reads
// the cache left by the turn before it rather than the card that was clicked.
function enqueueTaskOperation (taskId, operation) {
  const previous = taskOperationQueues.get(taskId)
  const pending = previous ? previous.then(operation, operation) : operation()
  let tracked
  tracked = pending.finally(() => {
    if (taskOperationQueues.get(taskId) === tracked) {
      taskOperationQueues.delete(taskId)
    }
  })
  taskOperationQueues.set(taskId, tracked)
  return tracked
}

async function runAsNeededTaskUpdate (task, fieldsForTurn, {
  getCurrent = id => tasksCache.find(item => item._id === id),
  replace = replaceCachedTask,
  render = renderTasks,
  update = updateTask,
  refresh = refreshTasksView,
  picks = sessionPicks,
  clearFeedback = () => {
    if (typeof document !== 'undefined' && document.getElementById('asNeededStatus')) {
      showEditorNote('', 'as-needed')
    }
  },
  showFailure = message => showEditorFailure(message, 'as-needed')
} = {}) {
  clearFeedback()
  const original = getCurrent(task._id) || task
  const fields = typeof fieldsForTurn === 'function'
    ? fieldsForTurn(original)
    : fieldsForTurn
  if (!fields || typeof fields !== 'object') {
    const message = 'That readiness action no longer applies. The chore is unchanged.'
    showFailure(message)
    return { ok: false, stage: 'validation', message }
  }
  const optimistic = { ...original, ...fields }
  const wasPicked = picks.isPicked(task._id)

  replace(optimistic)
  let pickChanged = false
  if (optimistic.readiness === 'waiting' && wasPicked) {
    picks.toggle(task._id)
    pickChanged = true
  }
  render()
  if (!pickChanged) announceTaskRefresh()

  const result = await saveTaskWithRefresh(
    () => update(task._id, fields),
    refresh
  )
  if (result.stage === 'write') {
    replace(original)
    const nowPicked = picks.isPicked(task._id)
    let restoredPick = false
    if (nowPicked !== wasPicked) {
      picks.toggle(task._id)
      restoredPick = true
    }
    render()
    if (!restoredPick) announceTaskRefresh()
    const message = "Couldn't update that. The chore is unchanged."
    showFailure(message)
    return { ...result, message }
  }
  if (result.stage === 'refresh') showFailure(result.message)
  return result
}

export function updateAsNeededTaskOptimistically (task, fieldsForTurn, dependencies = {}) {
  return enqueueTaskOperation(task._id, () =>
    runAsNeededTaskUpdate(task, fieldsForTurn, dependencies))
}

function asNeededFilterCategoryName (snapshot) {
  return (snapshot.categories || [])
    .find(category => category._id === asNeededState.categoryId)?.name || 'All'
}

function currentAsNeededState (snapshot) {
  return {
    ...asNeededState,
    filter: {
      query: asNeededState.query,
      category: asNeededFilterCategoryName(snapshot)
    }
  }
}

function rememberAsNeededFocus (container) {
  const active = document.activeElement
  if (!active || typeof container.contains !== 'function' || !container.contains(active)) return null
  const row = active.closest?.('.as-needed-row')
  const taskId = active.dataset?.id || row?.dataset?.id
  if (!taskId) return null
  const controlClass = [...(active.classList || [])]
    .find(name => name.startsWith('as-needed-')) || null
  return { taskId, controlClass }
}

function restoreAsNeededFocus (container, focusKey) {
  if (!focusKey || typeof container.querySelectorAll !== 'function') return
  const row = [...container.querySelectorAll('.as-needed-row')]
    .find(item => item.dataset?.id === focusKey.taskId)
  const preferred = focusKey.controlClass
    ? row?.querySelector?.('.' + focusKey.controlClass)
    : null
  const inverseClass = focusKey.controlClass === 'as-needed-ready'
    ? 'as-needed-not-ready'
    : focusKey.controlClass === 'as-needed-not-ready'
      ? 'as-needed-ready'
      : null
  const inverse = inverseClass ? row?.querySelector?.('.' + inverseClass) : null
  const target = preferred || inverse || row?.querySelector?.('.as-needed-edit') ||
    document.querySelector?.('#view-as-needed .route-heading')
  target?.focus?.()
}

function renderAsNeeded (snapshot = categoryLocationStore.getSnapshot()) {
  const container = document.getElementById('asNeededCards')
  if (!container) return
  const focusKey = rememberAsNeededFocus(container)

  const tasks = getAsNeededTasks()
  const state = currentAsNeededState(snapshot)
  const readyCount = tasks.filter(task => task.readiness === 'ready').length
  const countLine = document.getElementById('asNeededCountLine')
  if (countLine) countLine.textContent = tasks.length + ' as needed · ' + readyCount + ' ready'

  const categoryFilter = document.getElementById('asNeededCategoryFilter')
  if (categoryFilter) {
    categoryFilter.innerHTML = asNeededCategoryPillsHtml(
      selectableReferences(snapshot.categories), state)
  }
  container.innerHTML = asNeededScreenHtml(
    tasks, snapshot, localDateFromDate(new Date(tasksViewNow())), state)
  restoreAsNeededFocus(container, focusKey)
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
  if (activeCount === 0) return 'Chores · none available'
  return 'Chores · ' + activeCount + ' available'
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

function ledgerState (snapshot, marks) {
  return {
    openTaskId: ledger.openTaskId,
    confirmDoneId: ledger.confirmDoneId,
    confirmDeleteId: ledger.confirmDeleteId,
    marks,
    filter: { query: ledger.query, category: ledgerFilterCategoryName(snapshot) }
  }
}

// The session the ledger is describing: the one being done if there is one,
// otherwise the one being put together. Both are read fresh, so concluding a
// session elsewhere is reflected the next time the list is painted.
function currentSessionBundle () {
  return sessionUnderWay(state.currentSession)
    ? { kind: 'doing', bundle: state.currentBundle }
    : { kind: 'picked', bundle: pickedBundle(getActiveTasks(), sessionPicks.getPickedIds()) }
}

// Absent when nothing is in a session: an empty readout is clutter, not
// information, and the space it claims is given back to the list.
function renderSessionFloat () {
  const float = document.getElementById('sessionFloat')
  if (!float) return
  const { kind, bundle } = currentSessionBundle()
  const model = sessionFloatModel({
    kind, count: bundle.length, minutes: bundleTotal(bundle)
  })

  float.hidden = !model
  if (model) document.documentElement.dataset.sessionFloat = 'on'
  else delete document.documentElement.dataset.sessionFloat
  if (!model) return

  float.href = model.href
  float.dataset.kind = model.kind
  document.getElementById('sessionFloatLabel').textContent = model.label
  document.getElementById('sessionFloatFacts').innerHTML = formatFactHtml(model.facts)
}

function renderLedger (snapshot = categoryLocationStore.getSnapshot()) {
  const today = localDateFromDate(new Date(tasksViewNow()))
  const active = getActiveTasks()
  const marks = sessionMarks(
    state.currentSession, sessionPicks.getPickedIds(), active.map(task => task._id))
  const listState = ledgerState(snapshot, marks)
  const looseCount = unscheduledTasks(active, today, {}, snapshot.categories || []).length
  renderSessionFloat()

  const countLine = document.getElementById('choresCountLine')
  if (countLine) countLine.textContent = buildChoresCountLine(active.length)
  document.getElementById('choresViews').innerHTML = ledgerViewsHtml(looseCount, ledger.view)
  document.getElementById('choreCategoryFilter').innerHTML = ledgerCategoryPillsHtml(
    selectableReferences(snapshot.categories), ledger.categoryId)
  document.getElementById('choresFilters').hidden = ledger.view === 'archive'

  const panes = {
    active: ledgerGroupsHtml(active, snapshot, today, listState),
    unscheduled: unscheduledListHtml(active, snapshot, today, listState),
    archive: archiveListHtml(tasksCache, snapshot, today, listState)
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
    ...taskModeFields(task, scheduleResult.taskMode),
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
    ...taskModeFields(task, scheduleResult.taskMode),
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
function editorStatus (origin) {
  return document.getElementById(origin === 'as-needed' ? 'asNeededStatus' : 'choresStatus')
}

function showEditorNote (message, origin = 'chores') {
  const status = editorStatus(origin)
  status.textContent = message
  status.removeAttribute('data-state')
  status.setAttribute('role', 'status')
}

function clearChoresNote () {
  const status = document.getElementById('choresStatus')
  if (!status) return
  status.textContent = ''
  status.removeAttribute('data-state')
  status.setAttribute('role', 'status')
}

function showEditorFailure (message, origin = 'chores') {
  const status = editorStatus(origin)
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

function handleAsNeededCategoryClick (evt) {
  const tab = evt.target.closest('[data-category-id]')
  if (!tab) return
  asNeededState.categoryId = tab.dataset.categoryId || ''
  renderAsNeeded()
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

// This is the Chores-screen meaning of "Mark as done": move the chore's rhythm
// from now without inventing a session or a timed execution. Quick Session
// details deliberately use the same boundary.
async function runChoreCompletion (task, {
  nowMs = Date.now(),
  getCurrent = id => tasksCache.find(item => item._id === id),
  replace = replaceCachedTask,
  render = () => {
    if (typeof document !== 'undefined' && document.getElementById('activeCards')) {
      renderTasks()
    }
  },
  update = updateTask,
  refresh = refreshTasksView,
  picks = sessionPicks
} = {}) {
  const current = getCurrent(task._id) || task
  const fields = taskUpdateForOutcome(current, 'completed', {
    completedAt: nowMs,
    completionDate: localDateFromDate(new Date(nowMs))
  })
  const result = await saveTaskWithRefresh(
    async () => {
      await update(task._id, fields)
      // If the aggregate refresh fails, storage still owns this completion.
      // Keep the cache on that persisted state for the next queued turn.
      replace({ ...current, ...fields })
    },
    refresh
  )
  // Once the write has landed, this chore is no longer part of the work the
  // user plans to do next. A failed repaint must not put persisted work back.
  let pickChanged = false
  if (result.stage !== 'write' && picks.isPicked(task._id)) {
    picks.toggle(task._id)
    pickChanged = true
  }
  if (result.stage === 'refresh') {
    render()
    if (!pickChanged) announceTaskRefresh()
  }
  return result
}

export function markChoreRecentlyDone (task, dependencies = {}) {
  return enqueueTaskOperation(task._id, () => runChoreCompletion(task, dependencies))
}

// Putting a chore in a session is not an edit of the chore, so it leaves the
// editor rather than waiting for Save. Which session it means is settled before
// the sheet opens, so the label and the act cannot disagree.
async function addChoreToSession (task, target, origin) {
  if (target === 'running') return addChoreToRunningSession(task, origin)

  const added = sessionPicks.toggle(task._id)
  showEditorNote(sessionAddNote({ name: task.name, target: 'next', added }), origin)
}

async function addChoreToRunningSession (task, origin) {
  try {
    const aggregate = await sessionStore.attachTasks(
      state.currentSession._id, [task._id], { whileRunning: true })
    setCurrentSessionAggregate(aggregate)
    // Attaching cannot refuse: a session that finished while the sheet was open
    // comes back untouched rather than throwing. Handing that one on to Doing
    // would carry the user off to a receipt they never asked for, on the
    // strength of an add that never happened.
    if (!sessionAddLanded(aggregate.session, task._id)) {
      if (sessionAddRejected(aggregate, task._id)) {
        renderLedger()
        showEditorNote(
          sessionAddNote({ name: task.name, target: 'unavailable', added: false }), origin)
        return
      }
      return addChoreToFinishedSession(task, origin)
    }
    await applySessionAggregate?.(aggregate)
    // The picks store did not move, so nothing else will repaint the list.
    renderLedger()
    showEditorNote(sessionAddNote({ name: task.name, target: 'running', added: true }), origin)
  } catch (error) {
    showEditorFailure('Could not add that to the session you are doing: ' + error.message, origin)
  }
}

// The session it was going into has finished. The chore still has somewhere to
// go, so it goes to the one being put together rather than nowhere at all.
function addChoreToFinishedSession (task, origin) {
  if (!sessionPicks.isPicked(task._id)) sessionPicks.toggle(task._id)
  // The session in hand is a finished one now, so the stamps it was casting
  // have to go whether or not the pick itself moved.
  renderLedger()
  showEditorNote(sessionAddNote({ name: task.name, target: 'ended', added: true }), origin)
}

// The editor is a dialogue of its own, so an edit can be abandoned without
// having already been written. Only Save writes, and it writes everything at
// once — including the name, which the row itself never let you touch.
async function openChoreEditor (id, origin = 'chores') {
  const task = tasksCache.find(item => item._id === id)
  if (!task) return
  const snapshot = categoryLocationStore.getSnapshot()
  ledger.openTaskId = id
  ledger.confirmDoneId = null

  // Both title-row controls are about the chore rather than about the edit:
  // one files a completion, the other puts eligible work in a session.
  const target = sessionAddTarget(state.currentSession, id)
  const sessionAction = isTaskEligible(task)
    ? choreSessionButtonHtml(sessionAddActionLabel(target, sessionPicks.isPicked(id)))
    : ''
  const readinessAction = !isTaskEligible(task) && isAsNeededTask(task)
    ? '<button type="button" class="btn btn-quiet ready-btn">Mark ready</button>'
    : ''
  const choice = await openSheet({
    title: 'Edit chore',
    headerActionHtml: choreDoneButtonHtml() + sessionAction + readinessAction,
    bodyHtml: editModalHtml(task, snapshot),
    actions: [
      { label: 'Cancel', value: null, className: 'btn btn-ghost' },
      { label: 'Save', value: 'save', className: 'btn btn-primary' }
    ]
  })

  ledger.openTaskId = null
  const body = sheetBody()
  if (choice === 'session') return addChoreToSession(task, target, origin)
  if (choice === 'ready') {
    return updateAsNeededTaskOptimistically(task, () => markReadyFields())
  }
  if (choice === 'done') {
    const result = await markChoreRecentlyDone(task)
    if (!result.ok) {
      showEditorFailure(completionFailureMessage(result), origin)
    }
    return result
  }
  if (choice === 'archive') {
    return archiveTaskOptimistically(task, {
      replace: replacement => {
        tasksCache = tasksCache.map(item => item._id === id ? replacement : item)
      },
      clearEditing: () => {},
      render: renderTasks,
      showFailure: message => showEditorFailure(message, origin),
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

  return saveChoreEditorFields(task, fields, {
    showFailure: message => showEditorFailure(message, origin)
  })
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
    if (!armOrConfirmDone(done)) return
    return closeSheetWith('done')
  }
  if (evt.target.closest('.ready-btn')) return closeSheetWith('ready')
  if (evt.target.closest('.session-btn')) return closeSheetWith('session')
  if (evt.target.closest('.archive-btn')) return closeSheetWith('archive')

  // Anything else you touch is you carrying on editing, so the armed
  // confirmation stands down rather than waiting for a stray second press.
  const armed = head?.querySelector('.done-btn')
  disarmDone(armed)

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
  openChoreEditor(card.dataset.id, 'chores')
}

function showAsNeededDateFailure (saveButton) {
  const prompt = saveButton.closest('.as-needed-date-prompt')
  if (!prompt) return
  let status = prompt.querySelector('.as-needed-date-message')
  if (!status) {
    status = document.createElement('p')
    status.className = 'as-needed-date-message'
    status.setAttribute('role', 'status')
    prompt.appendChild(status)
  }
  status.textContent = 'Choose a valid date.'
}

function handleAsNeededInput (evt) {
  const input = evt.target.closest?.('.as-needed-date')
  if (!input || asNeededState.datePrompt?.taskId !== input.dataset.id ||
    asNeededState.datePrompt?.action !== input.dataset.action) return
  asNeededState.datePrompt = { ...asNeededState.datePrompt, value: input.value }
}

async function handleAsNeededClick (evt) {
  const edit = evt.target.closest('.as-needed-edit')
  if (edit) {
    const card = edit.closest('.as-needed-row')
    if (card) return openChoreEditor(card.dataset.id, 'as-needed')
    return
  }

  const ready = evt.target.closest('.as-needed-ready')
  const later = evt.target.closest('.as-needed-later')
  const notReady = evt.target.closest('.as-needed-not-ready')
  const dateSave = evt.target.closest('.as-needed-date-save')
  const dateCancel = evt.target.closest('.as-needed-date-cancel')
  const done = evt.target.closest('.as-needed-done')
  const action = ready || later || notReady || dateSave || dateCancel || done
  if (!action) return

  const card = action.closest('.as-needed-row')
  const id = action.dataset.id || card?.dataset.id
  const task = tasksCache.find(item => item._id === id)
  if (!task) return

  if (dateCancel) {
    asNeededState.datePrompt = null
    renderAsNeeded()
    return
  }

  const actionTime = new Date(tasksViewNow())
  const today = localDateFromDate(actionTime)
  if (ready) {
    return updateAsNeededTaskOptimistically(task, () => markReadyFields(today))
  }

  if (later || notReady) {
    const promptAction = later ? 'later' : 'not-ready'
    const fields = deferReadinessFields(task, today)
    if (!fields) {
      asNeededState.datePrompt = { taskId: task._id, action: promptAction }
      renderAsNeeded()
      return
    }
    return updateAsNeededTaskOptimistically(task, current =>
      deferReadinessFields(current, today))
  }

  if (dateSave) {
    const prompt = dateSave.closest('.as-needed-date-prompt')
    const input = prompt?.querySelector('.as-needed-date') || card?.querySelector('.as-needed-date')
    const selectedDate = input?.value
    const fields = deferReadinessFields(task, today, selectedDate)
    if (!fields) {
      showAsNeededDateFailure(dateSave)
      return
    }
    const result = await updateAsNeededTaskOptimistically(task, current =>
      deferReadinessFields(current, today, selectedDate))
    if (result.ok && asNeededState.datePrompt?.taskId === task._id) {
      asNeededState.datePrompt = null
      renderAsNeeded()
    }
    return result
  }

  if (!armOrConfirmDone(done)) {
    asNeededState.confirmingDoneId = task._id
    renderAsNeeded()
    return
  }

  const result = await markChoreRecentlyDone(task, { nowMs: actionTime.getTime() })
  if (!result.ok) {
    showEditorFailure(completionFailureMessage(result), 'as-needed')
  }
  return result
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
