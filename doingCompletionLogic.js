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

export function retryCompletionForStage (stage, { retryExecution, retryTaskUpdate }) {
  return stage === 'execution' ? retryExecution() : retryTaskUpdate()
}

export async function endDoingSession ({
  hasPendingTaskUpdate,
  confirmDiscard,
  saveSession,
  discardPendingTaskUpdate,
  clearPendingContinuation,
  showReview
}) {
  const shouldDiscardPendingUpdate = hasPendingTaskUpdate()
  if (shouldDiscardPendingUpdate && !confirmDiscard()) return false

  await saveSession()
  if (shouldDiscardPendingUpdate) discardPendingTaskUpdate()
  clearPendingContinuation()
  await showReview()
  return true
}
