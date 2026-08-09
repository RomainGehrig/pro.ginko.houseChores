// ABOUTME: Renders and mutates the one authoritative whole-session Doing aggregate.
// ABOUTME: Derives one durable clock from persisted timing and retries staged outcome writes.

import { state, setCurrentSessionAggregate } from './state.js'
import { completionAttemptIdFor, createExecution } from './executionData.js'
import { listTasksByIds, updateTask } from './taskData.js'
import { updateSession } from './sessionData.js'
import { formatTimer } from './helpers.js'
import {
  buildContinuationRemainingHtml,
  buildContinuationSearchResultsHtml,
  buildContinuationSuggestionsHtml,
  buildDoingSessionHtml
} from './taskPresentationLogic.js'
import { createCompletionCoordinator } from './completionSaveLogic.js'
import { prepareCompletionAttempt, retryCompletionForStage } from './doingCompletionLogic.js'
import { localDateFromDate } from './scheduleLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { getActiveTasks, refreshTasksView } from './tasksView.js'
import { showView, setNavVisible } from './router.js'
import { renderReviewLoadError, startReview } from './reviewView.js'
import { sessionStore } from './sessionStore.js'
import {
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
let continuationTasks = []
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

export function initDoingView () {
  bindDoingContent()
  if (typeof window !== 'undefined' && boundWindow !== window) {
    boundWindow = window
    window.addEventListener('focus', () => refreshDoing({
      allowNavigation: document.getElementById('view-doing')?.style.display === 'block'
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
  })
}

export async function refreshDoing ({ allowNavigation = true } = {}) {
  if (!state.currentSession?._id ||
    !['active', 'paused'].includes(state.currentSession.status) ||
    sessionMutationInFlight) return null
  try {
    const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
    pendingSessionRetry = null
    await applyAggregate(aggregate, { allowNavigation })
    return aggregate
  } catch (error) {
    renderSessionMutationFailure(
      'Could not refresh the session: ' + error.message,
      refreshDoing
    )
    return null
  }
}

async function applyAggregate (aggregate, { allowNavigation = true } = {}) {
  setCurrentSessionAggregate(aggregate)
  if (aggregate.session.status !== 'paused') {
    continuationTasks = []
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
  timerDisplay.textContent = formatTimer(
    Math.floor(activeElapsedMs(state.currentSession, Date.now()) / 1000)
  )
}

function setSessionMutationControlsDisabled (disabled) {
  const content = document.getElementById('doingContent')
  if (!content) return
  content.querySelectorAll('button, input').forEach(control => {
    if (control.id === 'retryCompletionBtn' || control.id === 'retrySessionMutationBtn') return
    control.disabled = disabled
  })
  if (!disabled) updateResumeAvailability()
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

async function handleDoingClick (event) {
  const button = event.target?.closest?.('button')
  if (!button) return

  if (button.id === 'retryCompletionBtn') return retryCompletion(button)
  if (button.id === 'retrySessionMutationBtn') return retrySessionMutation(button)
  if (sessionMutationInFlight) return

  if (button.dataset.continuationSearchId) {
    return attachSearchedTask(button.dataset.continuationSearchId)
  }
  if (button.dataset.taskId && button.dataset.outcome) {
    return completeTask(button.dataset.taskId, button.dataset.outcome)
  }
  if (button.id === 'pauseSessionBtn') return pauseSession()
  if (button.id === 'concludeSessionBtn') return concludeSession()
  if (button.id === 'openContinueBtn') return openContinuePicker()
  if (button.id === 'continueQuickAddBtn') return quickAddContinuation()
  if (button.id === 'resumeSessionBtn') return resumeSession()
  if (button.id === 'closeContinueBtn') return closeContinuePicker()
}

function handleDoingInput (event) {
  if (event.target?.id !== 'continueSearchInput' || state.currentSession?.status !== 'paused') return
  const results = searchContinuationTasks(
    continuationTasks,
    event.target.value,
    state.currentSession.taskBundle || []
  )
  const container = document.getElementById('continueSearchResults')
  if (container) container.innerHTML = buildContinuationSearchResultsHtml(results)
}

async function handleDoingChange (event) {
  const taskId = event.target?.dataset?.continuationSuggestionId
  if (sessionMutationInFlight || !taskId || !event.target.checked ||
    state.currentSession?.status !== 'paused') return
  const candidate = continuationTasks.find(task => task._id === taskId)
  if (!candidate || state.currentSession.taskBundle?.includes(taskId)) return
  await acceptSuggestedTask(candidate, event.target)
}

async function openContinuePicker () {
  if (state.currentSession?.status !== 'paused') return
  const panel = document.getElementById('doingContinuePanel')
  if (!panel) return

  try {
    await refreshTasksView()
    continuationTasks = getActiveTasks()
  } catch (error) {
    renderSessionMutationFailure(
      'Could not load tasks for continuing: ' + error.message,
      openContinuePicker
    )
    return
  }

  const remainingMs = remainingBudgetMs(state.currentSession, Date.now())
  const suggestions = suggestContinuationTasks(
    continuationTasks,
    state.currentSession.taskBundle || [],
    remainingMs
  )
  panel.innerHTML =
    '<h2>Add more tasks</h2>' +
    '<p id="continueRemaining"></p>' +
    '<div id="continueSuggestions"></div>' +
    '<label>Search active tasks <input id="continueSearchInput" type="search"></label>' +
    '<div id="continueSearchResults"></div>' +
    '<label>Quick task title <input id="continueQuickTitle"></label>' +
    '<button id="continueQuickAddBtn">Add task</button>' +
    '<button id="resumeSessionBtn">Resume session</button>' +
    '<button id="closeContinueBtn">Back</button>'
  panel.hidden = false

  const remaining = document.getElementById('continueRemaining')
  if (remaining) {
    remaining.innerHTML = buildContinuationRemainingHtml(Math.floor(remainingMs / 60000))
  }
  const suggestionsContainer = document.getElementById('continueSuggestions')
  if (suggestionsContainer) {
    suggestionsContainer.innerHTML = buildContinuationSuggestionsHtml(suggestions)
  }
  updateResumeAvailability()
}

function updateResumeAvailability () {
  const button = document.getElementById('resumeSessionBtn')
  if (!button || !state.currentSession) return
  const resolved = resolvedTaskIds(state.currentExecutions)
  button.disabled = (state.currentSession.taskBundle || []).every(id => resolved.has(id))
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
    if (aggregate.session.status === 'paused') await openContinuePicker()
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
    if (state.currentSession?.status !== 'paused') return false
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

function quickAddContinuation (retryIntent = null) {
  const title = retryIntent?.title || document.getElementById('continueQuickTitle')?.value
  return runContinuationMutation(
    () => sessionStore.quickAdd(state.currentSession._id, title, retryIntent),
    'Could not add the quick task',
    error => quickAddContinuation(error.quickAddIntent || retryIntent || { title }),
    (aggregate, error) => Boolean(
      error.quickAddTaskId &&
      (aggregate.session.taskBundle || []).includes(error.quickAddTaskId)
    )
  )
}

function resumeSession () {
  return runSessionMutation(
    () => sessionStore.resume(state.currentSession._id, Date.now()),
    'Could not resume the session',
    resumeSession
  )
}

function closeContinuePicker () {
  const panel = document.getElementById('doingContinuePanel')
  if (panel) panel.hidden = true
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
      taskUpdateSnapshot: taskUpdate
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
      if (reconciled.session.status === 'paused') await openContinuePicker()
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
  if (aggregate.session.status === 'paused') await openContinuePicker()
  return true
}

function pauseSession () {
  return runSessionMutation(
    () => sessionStore.pause(state.currentSession._id, Date.now()),
    'Could not pause the session',
    pauseSession
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
