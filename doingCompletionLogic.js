// ABOUTME: Pure orchestration for doing-mode completion and session transitions.
// ABOUTME: Keeps optional filler failures and session-save failures from losing progress.

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
  retryExecution,
  retryTaskUpdate
}) {
  if (actionsBlocked()) return null
  return stage === 'execution' ? retryExecution() : retryTaskUpdate()
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
  if (shouldDiscardPendingUpdate) discardPendingTaskUpdate()
  clearPendingContinuation()
  await showReview()
  setCompletionControlsDisabled(false)
  return true
}
