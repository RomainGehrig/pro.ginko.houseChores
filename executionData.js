export const createExecution = data => {
  const completionAttemptId = String(data?.completionAttemptId || '').trim()
  return completionAttemptId
    ? freezr.create('taskExecutions', data, {
        data_object_id: completionAttemptId,
        upsert: true
      })
    : freezr.create('taskExecutions', data)
}

export const updateExecution = (id, fields) => freezr.updateFields('taskExecutions', id, fields)

export const listExecutionsBySession = async (sessionId) => {
  const all = await freezr.query('taskExecutions', {}, { sort: { _date_modified: -1 } })
  return all.filter(e => e.sessionId === sessionId)
}

export const listExecutionsByTask = async (taskId) => {
  const all = await freezr.query('taskExecutions', {}, { sort: { _date_modified: -1 } })
  return all.filter(e => e.taskId === taskId && e.outcome !== 'cancelled')
}

export const listAllExecutions = () => freezr.query('taskExecutions', {}, { sort: { _date_modified: -1 } })

export const completionAttemptIdFor = (sessionId, taskId) =>
  'session-task-' + encodeURIComponent(String(sessionId)) + '-' +
  encodeURIComponent(String(taskId))

export const findExecutionForTask = async (sessionId, taskId) =>
  (await listExecutionsBySession(sessionId))
    .find(execution => execution.taskId === taskId) || null
