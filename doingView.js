// ABOUTME: Renders and mutates the one authoritative whole-session Doing aggregate.
// ABOUTME: Derives one durable clock from persisted timing and retries staged outcome writes.

import { state, setCurrentSessionAggregate } from './state.js'
import { completionAttemptIdFor, createExecution } from './executionData.js'
import { taskFieldsBeforeUpdate } from './reopenLogic.js'
import { listTasksByIds, updateTask } from './taskData.js'
import { updateSession } from './sessionData.js'
import { formatFactHtml, formatTimer } from './helpers.js'
import { fitsLabel, remainingLine } from './doingLines.js'
import {
  buildAddPanelHtml,
  buildContinuationRemainingHtml,
  buildContinuationSearchResultsHtml,
  buildContinuationSuggestionsHtml,
  buildQuickAddHtml,
  buildDoingSessionHtml
} from './taskPresentationLogic.js'
import { createCompletionCoordinator } from './completionSaveLogic.js'
import { prepareCompletionAttempt, retryCompletionForStage } from './doingCompletionLogic.js'
import { localDateFromDate } from './scheduleLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import {
  getActiveTasks,
  refreshTaskCache,
  subscribeTaskRefresh
} from './tasksView.js'
import { showView, setNavVisible } from './router.js'
import { renderReviewLoadError, startReview } from './reviewView.js'
import { sessionStore } from './sessionStore.js'
import {
  canQuickAdd,
  searchContinuationTasks,
  suggestContinuationTasks
} from './continuationLogic.js'
import {
  activeElapsedMs,
  outcomeTiming,
  pauseFields,
  remainingBudgetMs,
  resolvedTaskIds
} from './sessionLogic.js'

let timerInterval = null
let sessionMutationInFlight = false
let pendingCompletion = null
let pendingCompletionStage = null
let pendingSessionRetry = null
let boundDoingContent = null
let boundWindow = null
let taskRefreshSubscribed = false
let continuationTasks = []
let continuationTasksLoaded = false
let continuationSessionId = null
const ambiguousSuggestionIds = new Set()

const completionCoordinator = createCompletionCoordinator({
  createExecution,
  updateTask,
  updateSession
})

const coordinatorHasPendingStage = () =>
  completionCoordinator.hasPendingExecution() ||
  completionCoordinator.hasPendingTaskUpdate() ||
  completionCoordinator.hasPendingSessionUpdate()

const sessionAcceptsAdditions = session =>
  ['active', 'paused'].includes(session?.status)

export function initDoingView () {
  bindDoingContent()
  if (!taskRefreshSubscribed) {
    taskRefreshSubscribed = true
    subscribeTaskRefresh(refreshContinuationTasksFromCache)
  }
  if (typeof window !== 'undefined' && boundWindow !== window) {
    boundWindow = window
    window.addEventListener('focus', () => refreshDoing({
      // Shown screens take their display from the stylesheet, so "not hidden"
      // is what identifies the one the user is actually looking at.
      allowNavigation: document.getElementById('view-doing')?.style.display !== 'none'
    }))
  }
}

function bindDoingContent () {
  const content = document.getElementById('doingContent')
  if (!content || boundDoingContent === content) return
  boundDoingContent = content
  content.addEventListener('click', handleDoingClick)
  content.addEventListener('input', handleDoingInput)
  content.addEventListener('change', handleDoingChange)
}

export function startDoing (aggregate) {
  initDoingView()
  return applyAggregate(aggregate || {
    session: state.currentSession,
    bundle: state.currentBundle,
    executions: state.currentExecutions
  }, { reloadCandidates: true })
}

export async function refreshDoing ({ allowNavigation = true } = {}) {
  if (!state.currentSession?._id ||
    !['active', 'paused'].includes(state.currentSession.status) ||
    sessionMutationInFlight) return null
  try {
    const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
    pendingSessionRetry = null
    await applyAggregate(aggregate, { allowNavigation, reloadCandidates: true })
    return aggregate
  } catch (error) {
    renderSessionMutationFailure(
      'Could not refresh the session: ' + error.message,
      refreshDoing
    )
    return null
  }
}

async function applyAggregate (aggregate, {
  allowNavigation = true,
  reloadCandidates = false
} = {}) {
  const addPanelDraft = captureAddPanelDraft()
  if (continuationSessionId !== aggregate.session._id) {
    continuationSessionId = aggregate.session._id
    continuationTasks = []
    continuationTasksLoaded = false
  }
  setCurrentSessionAggregate(aggregate)
  if (!sessionAcceptsAdditions(aggregate.session)) {
    continuationTasks = []
    continuationTasksLoaded = false
    continuationSessionId = null
    ambiguousSuggestionIds.clear()
  }
  if (aggregate.session.status === 'completed') {
    clearInterval(timerInterval)
    setNavVisible('doing', false)
    setNavVisible('review', true, aggregate.session._id)
    if (allowNavigation) showView('review', aggregate.session._id)
    await loadCurrentReview()
    return
  }
  if (aggregate.session.status === 'interrupted') {
    clearInterval(timerInterval)
    setNavVisible('doing', false)
    renderDoingError('This session was superseded by newer unfinished work.')
    return
  }
  setNavVisible('doing', true)
  renderDoing()
  // Adding a chore does not change whether the clock is running, so the panel
  // belongs to the whole unfinished session rather than only its paused state.
  await openContinuePicker({
    draft: addPanelDraft,
    reloadTasks: reloadCandidates || !continuationTasksLoaded
  })
}

async function loadCurrentReview () {
  return startReview({
    onCurrentError: error => renderReviewLoadError(
      'Could not load this session review: ' + String(error?.message || error),
      loadCurrentReview
    )
  })
}

function renderDoing () {
  clearInterval(timerInterval)
  bindDoingContent()
  const content = document.getElementById('doingContent')
  content.innerHTML = buildDoingSessionHtml(
    state.currentSession,
    state.currentBundle,
    state.currentExecutions,
    categoryLocationStore.getSnapshot().categories
  )
  updateTimerDisplay()
  setSessionMutationControlsDisabled(sessionMutationInFlight)
  if (state.currentSession.status === 'active') {
    timerInterval = setInterval(updateTimerDisplay, 1000)
  }
}

function updateTimerDisplay () {
  const timerDisplay = document.getElementById('sessionTimerDisplay')
  if (!timerDisplay || !state.currentSession) return
  const nowMs = Date.now()
  const elapsedMs = activeElapsedMs(state.currentSession, nowMs)
  const seconds = Math.floor(elapsedMs / 1000)
  timerDisplay.textContent = formatTimer(seconds)

  // Past the time you set, the clock changes colour and nothing else happens.
  // It does not count down, stop the session, or turn red.
  const budgetSeconds = Number(state.currentSession.timeBudgetMinutes || 0) * 60
  timerDisplay.classList.toggle('is-past-budget', budgetSeconds > 0 && seconds > budgetSeconds)

  // What is left of the budget moves with the clock, so it is read out on the
  // same tick rather than going stale until the next render.
  const remaining = document.getElementById('doingRemaining')
  if (remaining) {
    remaining.innerHTML = formatFactHtml(remainingLine(state.currentSession, seconds * 1000))
  }
  updateAddPanelTiming(elapsedMs, nowMs)
}

function updateAddPanelTiming (elapsedMs, nowMs) {
  if (!sessionAcceptsAdditions(state.currentSession)) return
  const remainingMs = remainingBudgetMs(state.currentSession, nowMs)
  const remaining = document.getElementById('continueRemaining')
  if (remaining) {
    remaining.innerHTML = buildContinuationRemainingHtml(state.currentSession, elapsedMs)
  }
  const fits = document.getElementById('continueFits')

  const suggestionsContainer = document.getElementById('continueSuggestions')
  if (!suggestionsContainer) {
    if (fits) fits.textContent = fitsLabel(remainingMs)
    return
  }
  const suggestions = suggestContinuationTasks(
    continuationTasks,
    state.currentSession.taskBundle || [],
    remainingMs,
    localDateFromDate(new Date(nowMs))
  )
  const suggestionIds = suggestions.map(task => task._id).join('\n')
  if (suggestionsContainer.dataset.suggestionIds === suggestionIds) {
    if (fits) fits.textContent = fitsLabel(remainingMs)
    return
  }
  const listAlreadyRendered = suggestionsContainer.dataset.suggestionIds !== undefined
  if (listAlreadyRendered && (sessionMutationInFlight ||
    document.activeElement?.dataset?.continuationSuggestionId)) return
  if (fits) fits.textContent = fitsLabel(remainingMs)
  suggestionsContainer.innerHTML = buildContinuationSuggestionsHtml(suggestions)
  suggestionsContainer.dataset.suggestionIds = suggestionIds
  setSessionMutationControlsDisabled(sessionMutationInFlight)
}

function setSessionMutationControlsDisabled (disabled) {
  const content = document.getElementById('doingContent')
  if (!content) return
  content.querySelectorAll('button, input').forEach(control => {
    if (control.id === 'retryCompletionBtn' || control.id === 'retrySessionMutationBtn') return
    control.disabled = disabled
  })
}

function clearDoingStatus () {
  const status = document.getElementById('doingStatus')
  if (!status) return
  status.textContent = ''
  status.replaceChildren()
  status.setAttribute('role', 'status')
  status.setAttribute('data-state', '')
}

function renderStatusRetry (message, id, label) {
  const status = document.getElementById('doingStatus')
  if (!status) {
    renderDoingError(message)
    return null
  }
  status.replaceChildren()
  status.textContent = message + ' '
  status.setAttribute('role', 'alert')
  status.setAttribute('data-state', 'error')
  const retryButton = document.createElement('button')
  retryButton.id = id
  retryButton.textContent = label
  status.appendChild(retryButton)
  return retryButton
}

function renderDoingError (message) {
  const content = document.getElementById('doingContent')
  if (!content) return
  content.replaceChildren()
  const error = document.createElement('p')
  error.className = 'inline-status'
  error.textContent = message
  error.setAttribute('role', 'alert')
  error.setAttribute('data-state', 'error')
  content.appendChild(error)
}

function renderCompletionFailure (result) {
  pendingCompletionStage = result.stage
  renderStatusRetry(result.message, 'retryCompletionBtn', 'Retry completion')
}

function renderSessionMutationFailure (message, retry) {
  pendingSessionRetry = retry
  renderStatusRetry(message, 'retrySessionMutationBtn', 'Retry')
}

function captureAddPanelDraft () {
  const search = document.getElementById('continueSearchInput')
  if (!search) return null
  return {
    query: search.value,
    focused: document.activeElement === search,
    selectionStart: search.selectionStart,
    selectionEnd: search.selectionEnd
  }
}

function renderContinuationQuery (typed) {
  const results = searchContinuationTasks(
    continuationTasks,
    typed,
    state.currentSession.taskBundle || [],
    localDateFromDate(new Date())
  )
  const container = document.getElementById('continueSearchResults')
  if (container) container.innerHTML = buildContinuationSearchResultsHtml(results)

  // The doc gives this field both jobs, so anything the chores do not already
  // answer to is offered as a new one on the same keystroke.
  const quickAdd = document.getElementById('continueQuickAdd')
  if (quickAdd) {
    quickAdd.innerHTML = canQuickAdd(typed, continuationTasks) ? buildQuickAddHtml(typed) : ''
  }
}

function restoreAddPanelDraft (draft) {
  if (!draft) return
  const search = document.getElementById('continueSearchInput')
  if (!search) return
  search.value = draft.query
  renderContinuationQuery(draft.query)
  if (!draft.focused) return
  search.focus()
  if (typeof search.setSelectionRange === 'function' &&
    Number.isInteger(draft.selectionStart) && Number.isInteger(draft.selectionEnd)) {
    search.setSelectionRange(draft.selectionStart, draft.selectionEnd)
  }
}

function renderContinuationTasksFailure (error) {
  const status = document.getElementById('continueTasksStatus')
  if (!status) return
  status.replaceChildren()
  status.textContent = 'Could not refresh chores: ' + error.message + '. '
  status.setAttribute('role', 'alert')
  status.setAttribute('data-state', 'error')
  const retryButton = document.createElement('button')
  retryButton.id = 'retryContinueTasksBtn'
  retryButton.textContent = 'Retry chores'
  status.appendChild(retryButton)
}

async function reloadContinuationTasks () {
  continuationTasks = await refreshTaskCache()
  continuationTasksLoaded = true
}

function refreshContinuationTasksFromCache () {
  continuationTasks = getActiveTasks()
  continuationTasksLoaded = true
  if (!sessionAcceptsAdditions(state.currentSession)) return
  const draft = captureAddPanelDraft()
  return openContinuePicker({ draft })
}

async function handleDoingClick (event) {
  const button = event.target?.closest?.('button')
  if (!button) return

  if (button.id === 'retryCompletionBtn') return retryCompletion(button)
  if (button.id === 'retrySessionMutationBtn') return retrySessionMutation(button)
  if (sessionMutationInFlight) return
  if (button.id === 'retryContinueTasksBtn') return retryContinueTasks()

  if (button.dataset.continuationSearchId) {
    return attachSearchedTask(button.dataset.continuationSearchId)
  }
  if (button.dataset.taskId && button.dataset.outcome) {
    return completeTask(button.dataset.taskId, button.dataset.outcome)
  }
  if (button.dataset.reopenExecutionId) {
    return reopenExecution(button.dataset.reopenExecutionId)
  }
  if (button.id === 'pauseSessionBtn') {
    return state.currentSession?.status === 'active' ? pauseSession() : resumeSession()
  }
  if (button.id === 'concludeSessionBtn') return concludeSession()
  if (button.id === 'continueQuickAddBtn') return quickAddContinuation()
}

function handleDoingInput (event) {
  if (event.target?.id !== 'continueSearchInput' ||
    !sessionAcceptsAdditions(state.currentSession)) return
  renderContinuationQuery(event.target.value)
}

async function handleDoingChange (event) {
  const taskId = event.target?.dataset?.continuationSuggestionId
  if (sessionMutationInFlight || !taskId || !event.target.checked ||
    !sessionAcceptsAdditions(state.currentSession)) return
  const candidate = continuationTasks.find(task => task._id === taskId)
  if (!candidate || state.currentSession.taskBundle?.includes(taskId)) return
  await acceptSuggestedTask(candidate, event.target)
}

async function openContinuePicker ({ draft = null, reloadTasks = false } = {}) {
  if (!sessionAcceptsAdditions(state.currentSession)) return
  const panel = document.getElementById('doingContinuePanel')
  if (!panel) return

  const nowMs = Date.now()
  const remainingMs = remainingBudgetMs(state.currentSession, nowMs)
  panel.innerHTML = buildAddPanelHtml(remainingMs)
  panel.hidden = false

  let loadError = null
  if (reloadTasks) {
    try {
      await reloadContinuationTasks()
    } catch (error) {
      loadError = error
    }
  }
  updateAddPanelTiming(activeElapsedMs(state.currentSession, nowMs), nowMs)
  restoreAddPanelDraft(draft)
  if (loadError) renderContinuationTasksFailure(loadError)
}

async function retryContinueTasks () {
  const draft = captureAddPanelDraft()
  await openContinuePicker({ draft, reloadTasks: true })
}

async function reconcileAmbiguousSuggestionSelections (retry) {
  if (!ambiguousSuggestionIds.size) return true
  sessionMutationInFlight = true
  clearDoingStatus()
  setSessionMutationControlsDisabled(true)
  try {
    const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
    pendingSessionRetry = null
    await applyAggregate(aggregate)
    ambiguousSuggestionIds.clear()
    return true
  } catch (error) {
    renderSessionMutationFailure(
      'Could not verify previously selected suggestions: ' + error.message,
      retry
    )
    return false
  } finally {
    sessionMutationInFlight = false
    setSessionMutationControlsDisabled(false)
  }
}

async function acceptSuggestedTask (candidate, checkbox) {
  if (ambiguousSuggestionIds.size) {
    const reconciled = await reconcileAmbiguousSuggestionSelections(
      () => acceptSuggestedTask(candidate)
    )
    if (!reconciled) {
      if (checkbox) checkbox.checked = false
      return false
    }
    if (state.currentSession?.taskBundle?.includes(candidate._id)) return true
    if (!sessionAcceptsAdditions(state.currentSession)) return false
  }
  const attached = await runContinuationMutation(
    () => sessionStore.attachTasks(
      state.currentSession._id,
      [candidate._id]
    ),
    'Could not add the suggested task',
    () => acceptSuggestedTask(candidate),
    aggregate => (aggregate.session.taskBundle || []).includes(candidate._id)
  )
  if (attached === null) ambiguousSuggestionIds.add(candidate._id)
  else ambiguousSuggestionIds.delete(candidate._id)
  if (attached === false) {
    if (checkbox) checkbox.checked = false
  }
  return attached === true
}

function attachSearchedTask (taskId) {
  return runContinuationMutation(
    () => sessionStore.attachTasks(state.currentSession._id, [taskId]),
    'Could not add the searched task',
    () => attachSearchedTask(taskId),
    aggregate => (aggregate.session.taskBundle || []).includes(taskId)
  )
}

async function quickAddContinuation (retryIntent = null) {
  const search = document.getElementById('continueSearchInput')
  const title = retryIntent?.title || search?.value
  const result = await runContinuationMutation(
    () => sessionStore.quickAdd(state.currentSession._id, title, retryIntent),
    'Could not add the quick task',
    error => quickAddContinuation(error.quickAddIntent || retryIntent || { title }),
    (aggregate, error) => Boolean(
      error.quickAddTaskId &&
      (aggregate.session.taskBundle || []).includes(error.quickAddTaskId)
    )
  )
  if (result === true) {
    const currentSearch = document.getElementById('continueSearchInput')
    if (currentSearch) {
      currentSearch.value = ''
      renderContinuationQuery('')
    }
  }
  return result
}

function resumeSession () {
  return runSessionMutation(
    () => sessionStore.resume(state.currentSession._id, Date.now()),
    'Could not resume the session',
    resumeSession
  )
}

function validOutcome (outcome) {
  return outcome === 'done' || outcome === 'already_done' || outcome === 'cancelled'
}

function discardCompletionRetryState () {
  completionCoordinator.discardPendingExecution()
  completionCoordinator.discardPendingTaskUpdate()
  completionCoordinator.discardPendingSessionUpdate()
  pendingCompletion = null
  pendingCompletionStage = null
}

function samePersistedNumber (left, right) {
  if (left === null || left === undefined || left === '') {
    return right === null || right === undefined || right === ''
  }
  if (right === null || right === undefined || right === '') return false
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    ? Number(left) === Number(right)
    : left === right
}

function sameMutationBase (authoritative, attempted) {
  return authoritative.status === attempted.status &&
    samePersistedNumber(authoritative.accumulatedActiveMs, attempted.accumulatedActiveMs) &&
    samePersistedNumber(authoritative.activeStartedAt, attempted.activeStartedAt) &&
    samePersistedNumber(authoritative.checkpointElapsedMs, attempted.checkpointElapsedMs) &&
    samePersistedNumber(authoritative.pausedAt, attempted.pausedAt) &&
    JSON.stringify(authoritative.taskBundle || []) === JSON.stringify(attempted.taskBundle || [])
}

function executionMatchesPendingCompletion (execution, attempt) {
  return execution.taskId === attempt.taskId &&
    execution.sessionId === attempt.aggregate.session._id &&
    execution.outcome === attempt.outcome &&
    execution.completionAttemptId === completionAttemptIdFor(
      attempt.aggregate.session._id,
      attempt.taskId
    ) &&
    samePersistedNumber(execution.endTime, attempt.timing.endTime) &&
    samePersistedNumber(execution.rawDurationMs, attempt.timing.rawDurationMs) &&
    samePersistedNumber(execution.activeElapsedMs, attempt.timing.activeElapsedMs)
}

async function applyAuthoritativeCompletionState (aggregate) {
  discardCompletionRetryState()
  await applyAggregate(aggregate)
  releaseCompletionLockIfSettled()
}

async function completeTask (taskId, outcome) {
  if (sessionMutationInFlight || !validOutcome(outcome)) return
  sessionMutationInFlight = true
  pendingSessionRetry = null
  clearDoingStatus()
  setSessionMutationControlsDisabled(true)

  try {
    const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
    if (aggregate.session.status !== 'active') {
      await applyAuthoritativeCompletionState(aggregate)
      return
    }
    const existing = aggregate.executions.find(execution => execution.taskId === taskId)
    if (existing) {
      pendingCompletion = null
      pendingCompletionStage = null
      await applyAggregate(aggregate)
      releaseCompletionLockIfSettled()
      return
    }

    const task = aggregate.bundle.find(candidate => candidate._id === taskId)
    if (!task) throw new Error('The selected task is no longer attached to this session.')
    if (task.unavailable && outcome !== 'cancelled') {
      await applyAuthoritativeCompletionState(aggregate)
      return
    }
    const endTime = Date.now()
    const timing = outcomeTiming(aggregate.session, aggregate.executions, endTime)
    const resolved = resolvedTaskIds(aggregate.executions)
    resolved.add(taskId)
    const allResolved = aggregate.session.taskBundle.every(id => resolved.has(id))
    pendingCompletion = {
      aggregate,
      task,
      taskId,
      outcome,
      timing,
      completion: {
        completionDate: localDateFromDate(new Date(endTime)),
        completedAt: endTime
      },
      sessionUpdate: {
        checkpointElapsedMs: timing.activeElapsedMs,
        ...(allResolved ? pauseFields(aggregate.session, endTime) : {})
      }
    }

    const result = await prepareAndCompletePendingTask()
    await handleCompletionResult(result)
  } catch (error) {
    pendingCompletion = null
    pendingCompletionStage = null
    sessionMutationInFlight = false
    setSessionMutationControlsDisabled(false)
    renderSessionMutationFailure(
      'Could not record the outcome: ' + error.message,
      () => completeTask(taskId, outcome)
    )
  }
}

async function prepareAndCompletePendingTask () {
  const attempt = pendingCompletion
  if (!attempt) {
    return {
      ok: false,
      stage: 'task_read',
      message: 'Could not refresh task before completion: completion state is unavailable',
      canRetry: false
    }
  }

  let prepared
  try {
    prepared = await prepareCompletionAttempt({
      taskSnapshot: attempt.task,
      outcome: attempt.outcome,
      completion: attempt.completion,
      loadTask: async id => (await listTasksByIds([id]))[0] || null
    })
  } catch (error) {
    return {
      ok: false,
      stage: 'task_read',
      message: 'Could not refresh task before completion: ' + error.message,
      canRetry: true
    }
  }

  const taskUpdate = prepared.task.status === 'proposed' || prepared.taskUpdate == null
    ? null
    : { ...prepared.taskUpdate }
  pendingCompletion = {
    ...attempt,
    task: prepared.task,
    taskUpdate
  }
  return completionCoordinator.complete({
    execution: {
      taskId: attempt.taskId,
      sessionId: attempt.aggregate.session._id,
      ...attempt.timing,
      outcome: attempt.outcome,
      actualSeconds: attempt.timing.rawDurationMs / 1000,
      difficultyRating: null,
      notes: '',
      completionAttemptId: completionAttemptIdFor(attempt.aggregate.session._id, attempt.taskId),
      taskUpdateSnapshot: taskUpdate,
      taskFieldsBefore: taskFieldsBeforeUpdate(prepared.task, taskUpdate)
    },
    taskId: attempt.taskId,
    taskUpdate,
    sessionId: attempt.aggregate.session._id,
    sessionUpdate: attempt.sessionUpdate
  })
}

async function handleCompletionResult (result) {
  if (!result.ok) {
    renderCompletionFailure(result)
    return
  }

  pendingCompletion = null
  pendingCompletionStage = null
  try {
    const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
    await applyAggregate(aggregate)
  } catch (error) {
    sessionMutationInFlight = false
    setSessionMutationControlsDisabled(false)
    renderSessionMutationFailure(
      'Outcome saved, but the session could not be refreshed: ' + error.message,
      refreshDoing
    )
    return
  }
  releaseCompletionLockIfSettled()
}

function releaseCompletionLockIfSettled () {
  if (pendingCompletion || coordinatorHasPendingStage()) return
  sessionMutationInFlight = false
  setSessionMutationControlsDisabled(false)
}

async function retryCompletion (button) {
  if (!pendingCompletionStage || !pendingCompletion) return
  button.disabled = true
  const retryStage = pendingCompletionStage
  const attempt = pendingCompletion
  let aggregate
  try {
    aggregate = await sessionStore.refresh(attempt.aggregate.session._id, Date.now())
  } catch (error) {
    renderCompletionFailure({
      ok: false,
      stage: retryStage,
      message: 'Could not refresh the session before retrying: ' + error.message,
      canRetry: true
    })
    return
  }

  const persistedExecution = aggregate.executions.find(execution =>
    execution.taskId === attempt.taskId
  )
  if (persistedExecution) {
    if (!executionMatchesPendingCompletion(persistedExecution, attempt)) {
      await applyAuthoritativeCompletionState(aggregate)
      return
    }
    await applyAuthoritativeCompletionState(aggregate)
    return
  }

  if (retryStage === 'task_update' || retryStage === 'session_update' ||
    aggregate.session.status !== 'active' ||
    !sameMutationBase(aggregate.session, attempt.aggregate.session)) {
    await applyAuthoritativeCompletionState(aggregate)
    return
  }

  const task = aggregate.bundle.find(candidate => candidate._id === attempt.taskId)
  if (!task) {
    await applyAuthoritativeCompletionState(aggregate)
    return
  }
  pendingCompletion = { ...attempt, aggregate, task }
  const result = await retryCompletionForStage(retryStage, {
    actionsBlocked: () => false,
    retryPreparation: prepareAndCompletePendingTask,
    retryExecution: completionCoordinator.retryExecution,
    retryTaskUpdate: completionCoordinator.retryTaskUpdate,
    retrySessionUpdate: completionCoordinator.retrySessionUpdate
  })
  if (!result) return
  await handleCompletionResult(result)
}

async function runSessionMutation (operation, failureMessage, retry) {
  if (sessionMutationInFlight) return
  sessionMutationInFlight = true
  pendingSessionRetry = null
  clearDoingStatus()
  setSessionMutationControlsDisabled(true)

  try {
    let aggregate
    try {
      aggregate = await operation()
    } catch (error) {
      renderSessionMutationFailure(failureMessage + ': ' + error.message, retry)
      return
    }
    await applyMutationAggregate(aggregate)
  } finally {
    sessionMutationInFlight = false
    setSessionMutationControlsDisabled(false)
  }
}

async function applyMutationAggregate (aggregate) {
  try {
    await applyAggregate(aggregate)
  } catch (error) {
    renderSessionMutationFailure(
      'Could not display the updated session: ' + error.message,
      async () => {
        clearDoingStatus()
        await applyMutationAggregate(aggregate)
      }
    )
  }
}

async function runContinuationMutation (operation, failureMessage, retry, wasApplied) {
  if (sessionMutationInFlight) return null
  sessionMutationInFlight = true
  pendingSessionRetry = null
  clearDoingStatus()
  setSessionMutationControlsDisabled(true)

  let aggregate
  try {
    aggregate = await operation()
  } catch (error) {
    let reconciled = null
    try {
      reconciled = await sessionStore.refresh(state.currentSession._id, Date.now())
      await applyAggregate(reconciled)
    } catch {
      reconciled = null
    }
    sessionMutationInFlight = false
    setSessionMutationControlsDisabled(false)
    if (reconciled && wasApplied?.(reconciled, error)) return true
    renderSessionMutationFailure(failureMessage + ': ' + error.message, () => retry(error))
    return reconciled ? false : null
  }

  await applyAggregate(aggregate)
  sessionMutationInFlight = false
  setSessionMutationControlsDisabled(false)
  return true
}

function pauseSession () {
  return runSessionMutation(
    () => sessionStore.pause(state.currentSession._id, Date.now()),
    'Could not pause the session',
    pauseSession
  )
}

// Taking back an outcome is itself an undo, so it reports what happened and
// leaves the chore actionable again rather than stacking a second undo on top.
function reopenExecution (executionId) {
  return runSessionMutation(
    () => sessionStore.reopen(state.currentSession._id, executionId),
    'Could not reopen the chore',
    () => reopenExecution(executionId)
  )
}

function concludeSession () {
  return runSessionMutation(
    () => sessionStore.conclude(state.currentSession._id, Date.now()),
    'Could not conclude the session',
    concludeSession
  )
}

async function retrySessionMutation (button) {
  if (!pendingSessionRetry || sessionMutationInFlight) return
  const retry = pendingSessionRetry
  pendingSessionRetry = null
  button.disabled = true
  await retry()
}
