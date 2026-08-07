// ABOUTME: Loads and repairs the one authoritative unfinished session aggregate.
// ABOUTME: Keeps freezr persistence outside pure timing and DOM rendering.

import { createSession, getSessionById, listUnfinishedSessions, updateSession } from './sessionData.js'
import { listExecutionsBySession } from './executionData.js'
import { createTaskWithId, listTasksByIds } from './taskData.js'
import { buildSessionDraft } from './bundleLogic.js'
import {
  chooseCurrentSession,
  conclusionFields,
  normalizationFields,
  pauseFields,
  resumeFields,
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
  createTaskRecord = createTaskWithId,
  createId = () => crypto.randomUUID(),
  now = Date.now
} = {}) {
  const pendingQuickAdds = new Map()

  async function hydrate (session, nowMs) {
    let repaired = { ...session }
    if (!terminal(repaired) && repaired.pendingAddition) {
      const pending = repaired.pendingAddition
      await createTaskRecord(pending.title, pending.taskId)
      const recovery = {
        taskBundle: [...new Set([...(repaired.taskBundle || []), pending.taskId])],
        pendingAddition: null
      }
      await updateSessionRecord(repaired._id, recovery)
      repaired = { ...repaired, ...recovery }
    }

    const executions = await listExecutions(session._id)
    if (!terminal(repaired)) {
      const normalize = normalizationFields(repaired, executions, nowMs)
      repaired = { ...repaired, ...normalize }
      if (Object.keys(normalize).length) await updateSessionRecord(repaired._id, normalize)

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
        await updateSessionRecord(repaired._id, pause)
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

  async function restoreCurrent (nowMs = now()) {
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

  async function refresh (sessionId, nowMs = now()) {
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

  async function attachTasks (sessionId, taskIds) {
    const aggregate = await refresh(sessionId, now())
    if (aggregate.session.status !== 'paused') return aggregate
    const taskBundle = [...new Set([
      ...(aggregate.session.taskBundle || []),
      ...(taskIds || [])
    ])]
    await updateSessionRecord(sessionId, { taskBundle })
    return refresh(sessionId, now())
  }

  async function resume (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    if (aggregate.session.status === 'active' || terminal(aggregate.session)) return aggregate
    const resolved = resolvedTaskIds(aggregate.executions)
    if (!(aggregate.session.taskBundle || []).some(id => !resolved.has(id))) {
      throw new Error('Add at least one task before continuing.')
    }
    await updateSessionRecord(sessionId, resumeFields(atMs))
    return refresh(sessionId, atMs)
  }

  async function quickAdd (sessionId, title) {
    const name = String(title || '').trim()
    if (!name) throw new Error('Enter a task title.')
    const session = await getSession(sessionId)
    if (!session) throw new Error('The current session is no longer available.')
    const recoveringPendingAddition = !terminal(session) && Boolean(session.pendingAddition)
    const aggregate = await hydrate(session, now())
    if (aggregate.session.status !== 'paused') {
      pendingQuickAdds.delete(sessionId)
      return aggregate
    }
    if (recoveringPendingAddition) {
      pendingQuickAdds.delete(sessionId)
      return aggregate
    }
    const pending = aggregate.session.pendingAddition || pendingQuickAdds.get(sessionId) || {
      taskId: 'quick-' + sessionId + '-' + createId(),
      title: name,
      createdAt: now()
    }
    pendingQuickAdds.set(sessionId, pending)
    if (!aggregate.session.pendingAddition) {
      await updateSessionRecord(sessionId, { pendingAddition: pending })
    }
    await createTaskRecord(pending.title, pending.taskId)
    const taskBundle = [...new Set([
      ...(aggregate.session.taskBundle || []),
      pending.taskId
    ])]
    await updateSessionRecord(sessionId, { taskBundle, pendingAddition: null })
    const refreshed = await refresh(sessionId, now())
    pendingQuickAdds.delete(sessionId)
    return refreshed
  }

  return { restoreCurrent, refresh, start, pause, conclude, attachTasks, quickAdd, resume }
}

export const sessionStore = createSessionStore()
