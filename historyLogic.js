// ABOUTME: Pure functions that join sessions, executions and tasks into
// ABOUTME: read-only history view models, newest session first.

const DIFFICULTY_WORDS = ['Easy', 'Light', 'Middling', 'Hard', 'A slog']
const OUTCOME_KEYS = ['done', 'already_done', 'cancelled']
const OUTCOME_LABELS = { done: 'done', already_done: 'already done', cancelled: 'skipped' }
const STATUS_LABELS = {
  active: 'in progress',
  paused: 'paused',
  interrupted: 'interrupted',
  completed: null
}

const hasRawDuration = value => (typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))

const executionMinutes = execution => hasRawDuration(execution.rawDurationMs)
  ? Number(execution.rawDurationMs) / 60000
  : Number(execution.actualDuration || 0)

// Older records carry a difficulty the Receipt no longer asks for. The Log
// still reads what was written rather than dropping it on the floor.
export function difficultyLabel (rating) {
  const level = Number(rating)
  return DIFFICULTY_WORDS[level - 1] || 'Not rated'
}

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
      actualDuration: executionMinutes(e),
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
    status: session.status,
    statusLabel: STATUS_LABELS[session.status] ?? null,
    taskCount: entries.length,
    outcomeCounts,
    totalActualMinutes: entries.reduce((sum, e) => sum + (e.actualDuration || 0), 0),
    entries
  }
}

// The model keeps precise minutes; the log reads them whole. Any measured time
// at all counts as a minute rather than rounding a real chore down to nothing.
export function displayMinutes (minutes) {
  const value = Number(minutes)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(1, Math.round(value))
}

export function buildLogCountLine (sessionCount) {
  const count = Number(sessionCount) || 0
  if (!count) return 'Log · nothing yet'
  return 'Log · ' + count + ' session' + (count === 1 ? '' : 's')
}
