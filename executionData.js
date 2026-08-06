export const createExecution = (data) => freezr.create('taskExecutions', data)

export const updateExecution = (id, fields) => freezr.updateFields('taskExecutions', id, fields)

export const listExecutionsBySession = async (sessionId) => {
  const all = await freezr.query('taskExecutions', {}, { sort: { _date_modified: -1 } })
  return all.filter(e => e.sessionId === sessionId)
}

export const listExecutionsByTask = async (taskId) => {
  const all = await freezr.query('taskExecutions', {}, { sort: { _date_modified: -1 } })
  return all.filter(e => e.taskId === taskId && e.outcome !== 'cancelled')
}