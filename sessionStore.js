// ABOUTME: Loads and repairs the one authoritative unfinished session aggregate.
// ABOUTME: Keeps freezr persistence outside pure timing and DOM rendering.

import { createSession, getSessionById, listUnfinishedSessions, updateSession } from './sessionData.js'
import { listExecutionsBySession } from './executionData.js'
import { listTasksByIds } from './taskData.js'
import { buildSessionDraft } from './bundleLogic.js'
import {
  chooseCurrentSession,
  conclusionFields,
  normalizationFields,
  pauseFields,
  resolvedTaskIds
} from './sessionLogic.js'

const unavailableTask = id => ({ _id: id, name: 'Unavailable task', unavailable: true })
const terminal = session => session.status === 'completed' || session.status === 'interrupted'

export function createSessionStore ({
  listSessions = listUnfinishedSessions,
  getSession = getSessionById,
  listExecutions = listExecutionsBySession,
  listTasks = listTasksByIds,
  createSessionRecord = createSession,
  updateSessionRecord = updateSession,
  now = Date.now
} = {}) {
  async function hydrate (session, nowMs) {
    const executions = await listExecutions(session._id)
    let repaired = { ...session }
    if (!terminal(session)) {
      const normalize = normalizationFields(session, executions, nowMs)
      repaired = { ...repaired, ...normalize }
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

  async function start (proposal, nowMs = Date.now()) {
    const existing = await restoreCurrent(nowMs)
    if (existing) return { aggregate: existing, restored: true }
    const created = await createSessionRecord(buildSessionDraft(proposal, nowMs))
    return { aggregate: await hydrate(created, nowMs), restored: false }
  }

  async function pause (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    if (aggregate.session.status === 'paused' || terminal(aggregate.session)) return aggregate
    await updateSessionRecord(sessionId, pauseFields(aggregate.session, atMs))
    return refresh(sessionId, atMs)
  }

  async function conclude (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    if (terminal(aggregate.session)) return aggregate
    const fields = conclusionFields(aggregate.session, aggregate.executions, atMs)
    await updateSessionRecord(sessionId, fields)
    return { ...aggregate, session: { ...aggregate.session, ...fields } }
  }

  return { restoreCurrent, refresh, start, pause, conclude }
}

export const sessionStore = createSessionStore()
