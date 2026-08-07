// ABOUTME: Loads and repairs the one authoritative unfinished session aggregate.
// ABOUTME: Keeps freezr persistence outside pure timing and DOM rendering.

import { getSessionById, listUnfinishedSessions, updateSession } from './sessionData.js'
import { listExecutionsBySession } from './executionData.js'
import { listTasksByIds } from './taskData.js'
import {
  chooseCurrentSession,
  normalizationFields,
  pauseFields,
  resolvedTaskIds
} from './sessionLogic.js'

const unavailableTask = id => ({ _id: id, name: 'Unavailable task', unavailable: true })

export function createSessionStore ({
  listSessions = listUnfinishedSessions,
  getSession = getSessionById,
  listExecutions = listExecutionsBySession,
  listTasks = listTasksByIds,
  updateSessionRecord = updateSession
} = {}) {
  async function hydrate (session, nowMs) {
    const executions = await listExecutions(session._id)
    const normalize = normalizationFields(session, executions, nowMs)
    let repaired = { ...session, ...normalize }
    if (Object.keys(normalize).length) await updateSessionRecord(session._id, normalize)

    const resolved = resolvedTaskIds(executions)
    const allResolved = repaired.taskBundle?.length > 0 &&
      repaired.taskBundle.every(taskId => resolved.has(taskId))
    if (repaired.status === 'active' && allResolved) {
      const finalExecution = [...executions].sort((left, right) =>
        Number(right.endTime || 0) - Number(left.endTime || 0)
      )[0]
      const atMs = Number(finalExecution.endTime)
      const pause = {
        ...pauseFields(repaired, atMs),
        checkpointElapsedMs: Math.max(
          Number(repaired.checkpointElapsedMs || 0),
          Number(finalExecution.activeElapsedMs || 0)
        )
      }
      await updateSessionRecord(session._id, pause)
      repaired = { ...repaired, ...pause }
    }

    const tasks = await listTasks(repaired.taskBundle || [])
    const taskById = new Map(tasks.map(task => [task._id, task]))
    return {
      session: repaired,
      bundle: (repaired.taskBundle || []).map(id => taskById.get(id) || unavailableTask(id)),
      executions
    }
  }

  async function restoreCurrent (nowMs = Date.now()) {
    const sessions = await listSessions()
    const { current, interruptedIds } = chooseCurrentSession(sessions)
    for (const id of interruptedIds) {
      const old = sessions.find(session => session._id === id)
      await updateSessionRecord(id, {
        status: 'interrupted',
        endTime: Number(old?._date_modified || old?.startTime || nowMs)
      })
    }
    return current ? hydrate(current, nowMs) : null
  }

  async function refresh (sessionId, nowMs = Date.now()) {
    const session = await getSession(sessionId)
    if (!session) throw new Error('The current session is no longer available.')
    return hydrate(session, nowMs)
  }

  return { restoreCurrent, refresh }
}

export const sessionStore = createSessionStore()
