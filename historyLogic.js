// ABOUTME: Pure functions that join sessions, executions and tasks into
// ABOUTME: read-only history view models, newest session first.

import { activeElapsedMs } from './sessionLogic.js'

const DIFFICULTY_WORDS = ['Easy', 'Light', 'Middling', 'Hard', 'A slog']
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
  const taskById = new Map(tasks.map(t => [t._id, t]))
  const execsBySession = new Map()
  executions.forEach(e => {
    if (!execsBySession.has(e.sessionId)) execsBySession.set(e.sessionId, [])
    execsBySession.get(e.sessionId).push(e)
  })

  return sessions
    .map(s => summariseSession(s, execsBySession.get(s._id) || [], taskById))
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
}

// A session's own clock is the one its budget was measured against, so the Log
// reads the same figure the session did. The oldest records were written before
// the app kept that clock; for those, what the chores recorded is all there is.
function sessionActiveMinutes (session, recordedMinutes) {
  const clock = session?.accumulatedActiveMs
  if (clock == null || !Number.isFinite(Number(clock))) return recordedMinutes
  return activeElapsedMs(session, session?.endTime || 0) / 60000
}

function summariseSession (session, executions, taskById) {
  const entries = [...executions]
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
    .map(e => {
      const task = taskById.get(e.taskId)
      return {
        taskName: task?.name || 'Unknown task',
        // An execution never stored the guess it was working against, so the
        // comparison is against the estimate the chore carries now — which is
        // the one the next session will use.
        estimatedDuration: Number(task?.estimatedDuration) || null,
        outcome: e.outcome,
        actualDuration: executionMinutes(e),
        difficultyRating: e.difficultyRating || null,
        notes: e.notes || ''
      }
    })

  const outcomeCounts = { done: 0, already_done: 0, cancelled: 0 }
  entries.forEach(e => {
    if (outcomeCounts[e.outcome] !== undefined) outcomeCounts[e.outcome] += 1
  })

  const totalActualMinutes = entries.reduce((sum, e) => sum + (e.actualDuration || 0), 0)

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
    totalActualMinutes,
    activeMinutes: sessionActiveMinutes(session, totalActualMinutes),
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
