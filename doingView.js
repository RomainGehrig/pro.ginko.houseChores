// ABOUTME: Renders and mutates the one authoritative whole-session Doing aggregate.
// ABOUTME: Derives one durable clock from persisted timing and retries staged outcome writes.

import { state, setCurrentSessionAggregate } from './state.js'
import { completionAttemptIdFor, createExecution } from './executionData.js'
import { listTasksByIds, updateTask } from './taskData.js'
import { updateSession } from './sessionData.js'
import { formatTimer } from './helpers.js'
import { buildDoingSessionHtml } from './taskPresentationLogic.js'
import { createCompletionCoordinator } from './completionSaveLogic.js'
import { prepareCompletionAttempt, retryCompletionForStage } from './doingCompletionLogic.js'
import { localDateFromDate } from './scheduleLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { showView, setNavVisible } from './viewRouter.js'
import { startReview } from './reviewView.js'
import { sessionStore } from './sessionStore.js'
import {
  activeElapsedMs,
  outcomeTiming,
  pauseFields,
  resolvedTaskIds
} from './sessionLogic.js'

let timerInterval = null
let sessionMutationInFlight = false
let pendingCompletion = null
let pendingCompletionStage = null
let pendingSessionRetry = null
let boundDoingContent = null
let boundWindow = null

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
    window.addEventListener('focus', () => refreshDoing())
  }
}

function bindDoingContent () {
  const content = document.getElementById('doingContent')
  if (!content || boundDoingContent === content) return
  boundDoingContent = content
  content.addEventListener('click', handleDoingClick)
}

export function startDoing (aggregate) {
  initDoingView()
  return applyAggregate(aggregate || {
    session: state.currentSession,
    bundle: state.currentBundle,
    executions: state.currentExecutions
  })
}

export async function refreshDoing () {
  if (!state.currentSession?._id ||
    !['active', 'paused'].includes(state.currentSession.status) ||
    sessionMutationInFlight) return null
  try {
    const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
    pendingSessionRetry = null
    await applyAggregate(aggregate)
    return aggregate
  } catch (error) {
    renderSessionMutationFailure(
      'Could not refresh the session: ' + error.message,
      refreshDoing
    )
    return null
  }
}

async function applyAggregate (aggregate) {
  setCurrentSessionAggregate(aggregate)
  if (aggregate.session.status === 'completed') {
    clearInterval(timerInterval)
    setNavVisible('doing', false)
    setNavVisible('review', true)
    showView('review')
    await startReview()
    return
  }
  if (aggregate.session.status === 'interrupted') {
    clearInterval(timerInterval)
    renderDoingError('This session was superseded by newer unfinished work.')
    return
  }
  renderDoing()
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
  content.querySelectorAll('button').forEach(control => {
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

async function handleDoingClick (event) {
  const button = event.target?.closest?.('button')
  if (!button) return

  if (button.id === 'retryCompletionBtn') return retryCompletion(button)
  if (button.id === 'retrySessionMutationBtn') return retrySessionMutation(button)
  if (sessionMutationInFlight) return

  if (button.dataset.taskId && button.dataset.outcome) {
    return completeTask(button.dataset.taskId, button.dataset.outcome)
  }
  if (button.id === 'pauseSessionBtn') return pauseSession()
  if (button.id === 'concludeSessionBtn') return concludeSession()
  if (button.id === 'openContinueBtn') {
    const panel = document.getElementById('doingContinuePanel')
    if (panel) panel.hidden = false
  }
}

function validOutcome (outcome) {
  return outcome === 'done' || outcome === 'already_done' || outcome === 'cancelled'
}

function terminalSession (session) {
  return session.status === 'completed' || session.status === 'interrupted'
}

async function completeTask (taskId, outcome) {
  if (sessionMutationInFlight || !validOutcome(outcome)) return
  sessionMutationInFlight = true
  pendingSessionRetry = null
  clearDoingStatus()
  setSessionMutationControlsDisabled(true)

  try {
    const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
    if (terminalSession(aggregate.session)) {
      pendingCompletion = null
      pendingCompletionStage = null
      await applyAggregate(aggregate)
      releaseCompletionLockIfSettled()
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

  pendingCompletion = { ...attempt, task: prepared.task, taskUpdate: prepared.taskUpdate }
  return completionCoordinator.complete({
    execution: {
      taskId: attempt.taskId,
      sessionId: attempt.aggregate.session._id,
      ...attempt.timing,
      outcome: attempt.outcome,
      actualSeconds: attempt.timing.rawDurationMs / 1000,
      difficultyRating: null,
      notes: '',
      completionAttemptId: completionAttemptIdFor(attempt.aggregate.session._id, attempt.taskId)
    },
    taskId: attempt.taskId,
    taskUpdate: prepared.taskUpdate,
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
  if (!pendingCompletionStage) return
  button.disabled = true
  const result = await retryCompletionForStage(pendingCompletionStage, {
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

  let aggregate
  try {
    aggregate = await operation()
  } catch (error) {
    sessionMutationInFlight = false
    setSessionMutationControlsDisabled(false)
    renderSessionMutationFailure(failureMessage + ': ' + error.message, retry)
    return
  }

  await applyAggregate(aggregate)
  sessionMutationInFlight = false
  setSessionMutationControlsDisabled(false)
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
