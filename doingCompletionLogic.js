// ABOUTME: Pure orchestration for doing-mode completion and session transitions.
// ABOUTME: Keeps optional filler failures and session-save failures from losing progress.

import { taskUpdateForOutcome } from './scheduleLogic.js'

export async function prepareCompletionAttempt ({
  taskSnapshot,
  outcome,
  completion,
  loadTask
}) {
  if (outcome === 'cancelled') {
    return { task: taskSnapshot, taskUpdate: null }
  }
  const task = await loadTask(taskSnapshot._id)
  if (!task) throw new Error('Task is no longer available.')
  return {
    task,
    taskUpdate: taskUpdateForOutcome(task, outcome, completion)
  }
}

export async function continueAfterCompletion ({
  offerFiller,
  reportFillerFailure,
  advanceBundle,
  renderNextTask
}) {
  try {
    await offerFiller()
  } catch (error) {
    reportFillerFailure(error)
  }

  advanceBundle()
  renderNextTask()
}

export function retryCompletionForStage (stage, {
  actionsBlocked = () => false,
  retryPreparation,
  retryExecution,
  retryTaskUpdate,
  retrySessionUpdate
}) {
  if (actionsBlocked()) return null
  if (stage === 'task_read') return retryPreparation()
  if (stage === 'execution') return retryExecution()
  if (stage === 'task_update') return retryTaskUpdate()
  return retrySessionUpdate()
}

export async function endDoingSession ({
  actionsBlocked = () => false,
  hasPendingTaskUpdate,
  confirmDiscard,
  saveSession,
  setCompletionControlsDisabled = () => {},
  discardPendingTaskUpdate,
  clearPendingContinuation,
  showReview
}) {
  if (actionsBlocked()) return false
  const shouldDiscardPendingUpdate = hasPendingTaskUpdate()
  if (shouldDiscardPendingUpdate && !confirmDiscard()) return false

  setCompletionControlsDisabled(true)
  try {
    await saveSession()
  } catch (error) {
    setCompletionControlsDisabled(false)
    throw error
  }
  try {
    if (shouldDiscardPendingUpdate) discardPendingTaskUpdate()
    clearPendingContinuation()
    await showReview()
  } finally {
    setCompletionControlsDisabled(false)
  }
  return true
}
