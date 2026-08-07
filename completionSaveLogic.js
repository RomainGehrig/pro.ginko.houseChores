// ABOUTME: Coordinates completion history and task schedule persistence.
// ABOUTME: Retains failed task updates so retries cannot duplicate executions.

const success = () => ({
  ok: true,
  stage: null,
  message: '',
  canRetry: false
})

const executionFailure = error => ({
  ok: false,
  stage: 'execution',
  message: 'Could not record completion: ' + error.message,
  canRetry: true
})

const taskFailure = error => ({
  ok: false,
  stage: 'task_update',
  message: 'Completion recorded, schedule not updated: ' + error.message,
  canRetry: true
})

const sessionFailure = error => ({
  ok: false,
  stage: 'session_update',
  message: 'Outcome recorded, session checkpoint not updated: ' + error.message,
  canRetry: true
})

function defaultAttemptId () {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'completion-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}

export function createCompletionCoordinator ({
  createExecution,
  updateTask,
  updateSession = async () => {},
  createAttemptId = defaultAttemptId
}) {
  let pendingExecution = null
  let pendingTaskUpdate = null
  let pendingSessionUpdate = null

  async function retrySessionUpdate () {
    if (!pendingSessionUpdate) return success()
    try {
      await updateSession(pendingSessionUpdate.sessionId, pendingSessionUpdate.fields)
      pendingSessionUpdate = null
      return success()
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async function retryTaskUpdate () {
    if (pendingTaskUpdate) {
      try {
        await updateTask(pendingTaskUpdate.taskId, pendingTaskUpdate.fields)
        pendingTaskUpdate = null
      } catch (error) {
        return taskFailure(error)
      }
    }
    return retrySessionUpdate()
  }

  async function persistExecution (attempt) {
    try {
      await createExecution(attempt.execution)
    } catch (error) {
      return executionFailure(error)
    }

    pendingExecution = null
    pendingTaskUpdate = attempt.taskUpdate
      ? { taskId: attempt.taskId, fields: attempt.taskUpdate }
      : null
    pendingSessionUpdate = attempt.sessionUpdate
      ? { sessionId: attempt.sessionId, fields: attempt.sessionUpdate }
      : null
    return retryTaskUpdate()
  }

  async function complete ({ execution, taskId, taskUpdate, sessionId, sessionUpdate }) {
    if (pendingSessionUpdate) return sessionFailure(new Error('session update already pending'))
    if (pendingTaskUpdate) return taskFailure(new Error('task update already pending'))
    if (pendingExecution) return executionFailure(new Error('execution retry already pending'))

    try {
      pendingExecution = {
        execution: {
          ...execution,
          completionAttemptId: execution.completionAttemptId || createAttemptId()
        },
        taskId,
        taskUpdate,
        sessionId,
        sessionUpdate
      }
    } catch (error) {
      return executionFailure(error)
    }
    return persistExecution(pendingExecution)
  }

  async function continueAfterPersistedExecution ({ taskId, taskUpdate }) {
    pendingExecution = null
    pendingTaskUpdate = taskUpdate ? { taskId, fields: taskUpdate } : null
    pendingSessionUpdate = null
    return retryTaskUpdate()
  }

  return {
    complete,
    continueAfterPersistedExecution,
    retryExecution: () => pendingExecution ? persistExecution(pendingExecution) : success(),
    retryTaskUpdate,
    retrySessionUpdate,
    hasPendingExecution: () => pendingExecution !== null,
    hasPendingTaskUpdate: () => pendingTaskUpdate !== null,
    hasPendingSessionUpdate: () => pendingSessionUpdate !== null,
    discardPendingExecution: () => { pendingExecution = null },
    discardPendingTaskUpdate: () => { pendingTaskUpdate = null },
    discardPendingSessionUpdate: () => { pendingSessionUpdate = null }
  }
}
