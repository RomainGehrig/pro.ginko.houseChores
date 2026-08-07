import { state } from './state.js'
import { createExecution } from './executionData.js'
import { updateTask } from './taskData.js'
import { updateSession } from './sessionData.js'
import { getActiveTasks, refreshTasksView } from './tasksView.js'
import { findFillerTask } from './bundleLogic.js'
import { formatTimer, formatDuration } from './helpers.js'
import { buildDoingTaskHtml } from './taskPresentationLogic.js'
import { createCompletionCoordinator } from './completionSaveLogic.js'
import {
  continueAfterCompletion,
  endDoingSession,
  retryCompletionForStage
} from './doingCompletionLogic.js'
import { localDateFromDate, taskUpdateForOutcome } from './scheduleLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { showView, setNavVisible } from './viewRouter.js'
import { startReview } from './reviewView.js'

let timerInterval = null
let taskStartTime = null
let usedTaskIds = []
let pendingContinuation = null

const completionCoordinator = createCompletionCoordinator({ createExecution, updateTask })

export function initDoingView() {
  // content is rendered dynamically by startDoing/renderCurrentTask
}

export function startDoing() {
  usedTaskIds = []
  renderCurrentTask()
}

function currentTask() {
  return state.currentBundle[state.currentBundleIndex]
}

function renderCurrentTask() {
  clearInterval(timerInterval)
  const task = currentTask()
  const content = document.getElementById('doingContent')

  if (!task) {
    endSession()
    return
  }

  taskStartTime = Date.now()
  content.innerHTML = buildDoingTaskHtml(
    task,
    state.currentBundleIndex,
    state.currentBundle.length,
    categoryLocationStore.getSnapshot().categories
  )

  document.getElementById('doneBtn').addEventListener('click', () => finishTask('done'))
  document.getElementById('alreadyDoneBtn').addEventListener('click', () => finishTask('already_done'))
  document.getElementById('cancelBtn').addEventListener('click', () => finishTask('cancelled'))
  document.getElementById('endSessionBtn').addEventListener('click', endSession)

  const timerDisplay = document.getElementById('timerDisplay')
  timerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - taskStartTime) / 1000)
    timerDisplay.textContent = formatTimer(seconds)
  }, 1000)
}

async function finishTask(outcome) {
  if (pendingContinuation) return

  clearInterval(timerInterval)
  const task = currentTask()
  const endTime = Date.now()
  const actualDuration = Math.round((endTime - taskStartTime) / 60000) || 1
  const execution = {
    taskId: task._id,
    sessionId: state.currentSession._id,
    startTime: taskStartTime,
    endTime,
    actualDuration,
    outcome,
    difficultyRating: null,
    notes: ''
  }
  const taskUpdate = taskUpdateForOutcome(task, outcome, {
    completionDate: localDateFromDate(new Date(endTime)),
    completedAt: endTime
  })

  pendingContinuation = { outcome, execution, actualDuration, task, taskUpdate }
  setCompletionControlsDisabled(true)
  const result = await completionCoordinator.complete({
    execution,
    taskId: task._id,
    taskUpdate
  })
  await handleCompletionResult(result)
}

function setCompletionControlsDisabled(disabled) {
  for (const id of ['doneBtn', 'alreadyDoneBtn', 'cancelBtn', 'endSessionBtn']) {
    const control = document.getElementById(id)
    if (control) control.disabled = disabled
  }
}

async function handleCompletionResult(result) {
  if (!result.ok) {
    renderCompletionFailure(result)
    return
  }

  const continuation = pendingContinuation
  if (!continuation) return
  usedTaskIds.push(continuation.task._id)

  await continueAfterCompletion({
    offerFiller: () => maybeAddFillerTask(continuation.actualDuration, continuation.task.estimatedDuration),
    reportFillerFailure: error => console.error('Could not offer a filler task after completion.', error),
    advanceBundle: () => { state.currentBundleIndex += 1 },
    renderNextTask: renderCurrentTask
  })
  pendingContinuation = null
}

function renderCompletionFailure(result) {
  const status = document.getElementById('doingStatus')
  status.textContent = result.message
  status.setAttribute('role', 'alert')

  const retryButton = document.createElement('button')
  retryButton.id = 'retryCompletionBtn'
  retryButton.textContent = 'Retry completion'
  retryButton.addEventListener('click', async () => {
    retryButton.disabled = true
    const endSessionButton = document.getElementById('endSessionBtn')
    if (endSessionButton) endSessionButton.disabled = true

    const retryResult = await retryCompletionForStage(result.stage, {
      retryExecution: () => completionCoordinator.complete({
        execution: pendingContinuation.execution,
        taskId: pendingContinuation.task._id,
        taskUpdate: pendingContinuation.taskUpdate
      }),
      retryTaskUpdate: completionCoordinator.retryTaskUpdate
    })
    await handleCompletionResult(retryResult)
  })
  status.appendChild(retryButton)

  const endSessionButton = document.getElementById('endSessionBtn')
  if (endSessionButton) endSessionButton.disabled = false
}

async function maybeAddFillerTask(actualDuration, estimatedDuration) {
  const savedMinutes = (estimatedDuration || 0) - actualDuration
  if (savedMinutes < 3) return
  await refreshTasksView()
  const excludeIds = usedTaskIds.concat(state.currentBundle.map(t => t._id))
  const filler = findFillerTask(getActiveTasks(), excludeIds, savedMinutes, state.currentSession.categoryFilterId)
  if (filler && confirm('You finished early - add "' + filler.name + '" (' + formatDuration(filler.estimatedDuration) + ')?')) {
    state.currentBundle.push(filler)
  }
}

async function endSession() {
  clearInterval(timerInterval)
  await endDoingSession({
    hasPendingTaskUpdate: completionCoordinator.hasPendingTaskUpdate,
    confirmDiscard: () => confirm('The completion is recorded, but the schedule was not updated and will need manual correction. End session anyway?'),
    saveSession: () => updateSession(state.currentSession._id, { endTime: Date.now(), status: 'completed' }),
    discardPendingTaskUpdate: completionCoordinator.discardPendingTaskUpdate,
    clearPendingContinuation: () => { pendingContinuation = null },
    showReview: async () => {
      setNavVisible('doing', false)
      setNavVisible('review', true)
      showView('review')
      await startReview()
    }
  })
}
