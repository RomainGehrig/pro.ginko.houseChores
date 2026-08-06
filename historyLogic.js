// ABOUTME: Pure functions that join sessions, executions and tasks into
// ABOUTME: read-only history view models, newest session first.

const OUTCOME_KEYS = ['done', 'already_done', 'cancelled']
const OUTCOME_LABELS = { done: 'done', already_done: 'already done', cancelled: 'cancelled' }

export function buildHistory (sessions, executions, tasks) {
  const taskNameById = new Map(tasks.map(t => [t._id, t.name]))
  const execsBySession = new Map()
  executions.forEach(e => {
    if (!execsBySession.has(e.sessionId)) execsBySession.set(e.sessionId, [])
    execsBySession.get(e.sessionId).push(e)
  })

  return sessions
    .map(s => summariseSession(s, execsBySession.get(s._id) || [], taskNameById))
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
}

export function describeOutcomes (outcomeCounts) {
  return OUTCOME_KEYS
    .filter(key => outcomeCounts[key] > 0)
    .map(key => outcomeCounts[key] + ' ' + OUTCOME_LABELS[key])
    .join(', ')
}

function summariseSession (session, executions, taskNameById) {
  const entries = [...executions]
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
    .map(e => ({
      taskName: taskNameById.get(e.taskId) || 'Unknown task',
      outcome: e.outcome,
      actualDuration: e.actualDuration,
      difficultyRating: e.difficultyRating || null,
      notes: e.notes || ''
    }))

  const outcomeCounts = { done: 0, already_done: 0, cancelled: 0 }
  entries.forEach(e => {
    if (outcomeCounts[e.outcome] !== undefined) outcomeCounts[e.outcome] += 1
  })

  return {
    id: session._id,
    startTime: session.startTime || null,
    endTime: session.endTime || null,
    timeBudgetMinutes: session.timeBudgetMinutes,
    categoryFilter: session.categoryFilter || null,
    abandoned: session.status !== 'completed',
    taskCount: entries.length,
    outcomeCounts,
    totalActualMinutes: entries.reduce((sum, e) => sum + (e.actualDuration || 0), 0),
    entries
  }
}
