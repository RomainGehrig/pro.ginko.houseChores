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

function defaultAttemptId () {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'completion-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}

export function createCompletionCoordinator ({
  createExecution,
  updateTask,
  createAttemptId = defaultAttemptId
}) {
  let pendingExecution = null
  let pendingTaskUpdate = null

  async function retryTaskUpdate () {
    if (!pendingTaskUpdate) return success()

    try {
      await updateTask(pendingTaskUpdate.taskId, pendingTaskUpdate.fields)
      pendingTaskUpdate = null
      return success()
    } catch (error) {
      return taskFailure(error)
    }
  }

  async function persistExecution (attempt) {
    try {
      await createExecution(attempt.execution)
    } catch (error) {
      return executionFailure(error)
    }

    pendingExecution = null
    if (!attempt.taskUpdate) return success()
    pendingTaskUpdate = { taskId: attempt.taskId, fields: attempt.taskUpdate }
    return retryTaskUpdate()
  }

  async function complete ({ execution, taskId, taskUpdate }) {
    if (pendingTaskUpdate) return taskFailure(new Error('task update already pending'))
    if (pendingExecution) return executionFailure(new Error('execution retry already pending'))

    try {
      pendingExecution = {
        execution: {
          ...execution,
          completionAttemptId: execution.completionAttemptId || createAttemptId()
        },
        taskId,
        taskUpdate
      }
    } catch (error) {
      return executionFailure(error)
    }
    return persistExecution(pendingExecution)
  }

  return {
    complete,
    retryExecution: () => pendingExecution ? persistExecution(pendingExecution) : success(),
    retryTaskUpdate,
    hasPendingExecution: () => pendingExecution !== null,
    hasPendingTaskUpdate: () => pendingTaskUpdate !== null,
    discardPendingExecution: () => { pendingExecution = null },
    discardPendingTaskUpdate: () => { pendingTaskUpdate = null }
  }
}
