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

export function createCompletionCoordinator ({ createExecution, updateTask }) {
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

  async function complete ({ execution, taskId, taskUpdate }) {
    if (pendingTaskUpdate) return taskFailure(new Error('task update already pending'))

    try {
      await createExecution(execution)
    } catch (error) {
      return executionFailure(error)
    }

    if (!taskUpdate) return success()
    pendingTaskUpdate = { taskId, fields: taskUpdate }
    return retryTaskUpdate()
  }

  return {
    complete,
    retryTaskUpdate,
    hasPendingTaskUpdate: () => pendingTaskUpdate !== null,
    discardPendingTaskUpdate: () => { pendingTaskUpdate = null }
  }
}
