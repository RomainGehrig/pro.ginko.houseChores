// ABOUTME: Loads and repairs the one authoritative unfinished session aggregate.
// ABOUTME: Keeps freezr persistence outside pure timing and DOM rendering.

import { createSession, getSessionById, listUnfinishedSessions, updateSession } from './sessionData.js'
import { deleteExecution, listExecutionsBySession } from './executionData.js'
import { createTaskWithId, listTasksByIds, updateTask } from './taskData.js'
import { buildSessionDraft } from './bundleLogic.js'
import { normalizeContinuationSuggestionEntries } from './continuationLogic.js'
import { reopenPlan } from './reopenLogic.js'
import { isTaskEligible } from './taskModeLogic.js'
import {
  chooseCurrentSession,
  conclusionFields,
  normalizationFields,
  pauseFields,
  remainingBudgetMs,
  resumeFields,
  resolvedTaskIds
} from './sessionLogic.js'

const unavailableTask = id => ({ _id: id, name: 'Unavailable task', unavailable: true })
const terminal = session => session.status === 'completed' || session.status === 'interrupted'
const attachableTask = task =>
  (task?.status === 'active' || task?.status === 'approved_recurring') &&
  isTaskEligible(task)
const usableBundledTask = task => attachableTask(task) ||
  task?.status === 'proposed' || task?.status === 'draft'

function finiteNumericMarker (value) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function validTaskUpdateSnapshot (execution) {
  const source = execution?.taskUpdateSnapshot
  const completedAt = finiteNumericMarker(execution?.endTime)
  const snapshotCompletedAt = finiteNumericMarker(source?.lastCompletedDate)
  if (!source || typeof source !== 'object' || completedAt === null ||
    snapshotCompletedAt === null || snapshotCompletedAt !== completedAt) return null
  const snapshot = { lastCompletedDate: completedAt }
  if (typeof source.scheduledDate === 'string') snapshot.scheduledDate = source.scheduledDate
  if (source.status === 'archived') snapshot.status = 'archived'
  return snapshot
}

const greatestExecutionCheckpoint = executions => executions.reduce((greatest, execution) => {
  if (execution.activeElapsedMs === null || execution.activeElapsedMs === '') return greatest
  const checkpoint = Number(execution.activeElapsedMs)
  return Number.isFinite(checkpoint) && checkpoint >= 0
    ? Math.max(greatest, checkpoint)
    : greatest
}, 0)

export function createSessionStore ({
  listSessions = listUnfinishedSessions,
  getSession = getSessionById,
  listExecutions = listExecutionsBySession,
  deleteExecutionRecord = deleteExecution,
  listTasks = listTasksByIds,
  createSessionRecord = createSession,
  updateSessionRecord = updateSession,
  createTaskRecord = createTaskWithId,
  updateTaskRecord = updateTask,
  createId = () => crypto.randomUUID(),
  now = Date.now
} = {}) {
  async function recoverPendingAddition (session) {
    const pending = session.pendingAddition
    let repaired = { ...session }
    const alreadyAttached = (repaired.taskBundle || []).includes(pending.taskId)

    if (pending.stage !== 'attached' || !alreadyAttached) {
      const [existingTask] = await listTasks([pending.taskId])
      if (!existingTask) await createTaskRecord(pending.title, pending.taskId)
      const attachedPending = { ...pending, stage: 'attached' }
      const attachment = {
        taskBundle: [...new Set([...(repaired.taskBundle || []), pending.taskId])],
        pendingAddition: attachedPending
      }
      await updateSessionRecord(repaired._id, attachment)
      repaired = { ...repaired, ...attachment }
    }

    try {
      await updateSessionRecord(repaired._id, { pendingAddition: null })
    } catch {
      // Attachment is already durable. A retained attached marker is safe to clear on refresh.
    }
    return { ...repaired, pendingAddition: null }
  }

  async function hydrate (session, nowMs) {
    let repaired = { ...session }
    if (repaired.status === 'paused' && repaired.pendingAddition) {
      repaired = await recoverPendingAddition(repaired)
    }

    const executions = await listExecutions(session._id)
    const tasks = await listTasks(repaired.taskBundle || [])
    const taskById = new Map(tasks.map(task => [task._id, task]))
    for (const execution of executions) {
      const snapshot = validTaskUpdateSnapshot(execution)
      const task = taskById.get(execution.taskId)
      const taskCompletedAt = finiteNumericMarker(task?.lastCompletedDate)
      if (!snapshot || !task ||
        (taskCompletedAt !== null && taskCompletedAt >= snapshot.lastCompletedDate)) continue
      await updateTaskRecord(execution.taskId, snapshot)
      taskById.set(execution.taskId, { ...task, ...snapshot })
    }
    if (!terminal(repaired)) {
      const normalize = normalizationFields(repaired, executions, nowMs)
      const normalized = { ...repaired, ...normalize }
      const persistedCheckpoint = greatestExecutionCheckpoint(executions)
      const currentCheckpoint = Number(normalized.checkpointElapsedMs)
      const checkpointElapsedMs = Number.isFinite(currentCheckpoint) && currentCheckpoint >= 0
        ? Math.max(currentCheckpoint, persistedCheckpoint)
        : persistedCheckpoint
      const repair = {
        ...normalize,
        ...(checkpointElapsedMs > (Number(normalized.checkpointElapsedMs) || 0)
          ? { checkpointElapsedMs }
          : {})
      }
      repaired = { ...repaired, ...repair }
      if (Object.keys(repair).length) await updateSessionRecord(repaired._id, repair)

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

    return {
      session: repaired,
      bundle: (repaired.taskBundle || []).map(id => {
        const task = taskById.get(id)
        if (!task) return unavailableTask(id)
        return usableBundledTask(task) ? task : { ...task, unavailable: true }
      }),
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
    const persisted = created?._id ? await getSession(created._id) : null
    if (!persisted) throw new Error('The new session could not be read after creation.')
    return { aggregate: await hydrate(persisted, nowMs), restored: false }
  }

  async function pause (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    if (aggregate.session.status === 'paused' || terminal(aggregate.session)) return aggregate
    await updateSessionRecord(sessionId, pauseFields(aggregate.session, atMs))
    return refresh(sessionId, atMs)
  }

  // The chore is put back before its outcome is removed: if the write fails the
  // outcome still stands, and hydrate's repair pass re-applies it.
  async function reopen (sessionId, executionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    if (terminal(aggregate.session)) return aggregate
    const execution = aggregate.executions.find(item => item._id === executionId)
    if (!execution) return aggregate

    const plan = reopenPlan(execution, aggregate.executions)
    if (plan.taskUpdate) await updateTaskRecord(execution.taskId, plan.taskUpdate)
    await deleteExecutionRecord(executionId)
    if (plan.sessionUpdate) await updateSessionRecord(sessionId, plan.sessionUpdate)
    return refresh(sessionId, atMs)
  }

  async function conclude (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    if (aggregate.session.status !== 'paused') return aggregate
    const fields = conclusionFields(aggregate.session, aggregate.executions, atMs)
    await updateSessionRecord(sessionId, fields)
    return { ...aggregate, session: { ...aggregate.session, ...fields } }
  }

  // whileRunning is for a chore handed over from outside the session — from the
  // ledger — where the user's intent is the whole of the request and the session
  // under way is plainly what they meant. The continuation panel does not pass
  // it: that panel only exists at a pause, so an active session there means the
  // client's view is stale and the add must not be written.
  async function attachTasks (
    sessionId, taskIds, { suggestionTaskIds = null, whileRunning = false } = {}
  ) {
    const atMs = now()
    const aggregate = await refresh(sessionId, atMs)
    const openToAdditions = whileRunning && suggestionTaskIds === null
      ? !terminal(aggregate.session)
      : aggregate.session.status === 'paused'
    if (!openToAdditions) return aggregate
    const requestedIds = [...new Set(taskIds || [])]
    const requestedTasks = await listTasks(requestedIds)
    const requestedById = new Map(requestedTasks.map(task => [task._id, task]))
    if (requestedTasks.length !== requestedIds.length ||
      requestedTasks.some(task => !attachableTask(task) && isTaskEligible(task))) {
      throw new Error(suggestionTaskIds
        ? 'That task is no longer available as a suggestion.'
        : 'That task is no longer available.')
    }
    const attachableIds = requestedIds.filter(id => attachableTask(requestedById.get(id)))
    const attachableTasks = attachableIds.map(id => requestedById.get(id))
    if (!attachableIds.length) return aggregate
    const taskBundle = [...new Set([
      ...(aggregate.session.taskBundle || []),
      ...attachableIds
    ])]
    if (suggestionTaskIds !== null) {
      const existingEntries = normalizeContinuationSuggestionEntries(
        aggregate.session.continuationSuggestionEntries
      )
      const entryIds = new Set(existingEntries.map(entry => entry.taskId))
      const candidateTasks = attachableTasks.filter(task => !entryIds.has(task._id))
      const requestedSuggestionIds = new Set(suggestionTaskIds || [])
      if (attachableIds.some(id => !requestedSuggestionIds.has(id)) ||
        candidateTasks.some(task => !(Number(task.estimatedDuration) > 0))) {
        throw new Error('That task is no longer available as a suggestion.')
      }
      const continuationSuggestionEntries = [...existingEntries, ...candidateTasks.map(task => ({
        taskId: task._id,
        estimatedDurationMinutes: Number(task.estimatedDuration)
      }))]
      const consumedMs = continuationSuggestionEntries.reduce((sum, entry) =>
        sum + entry.estimatedDurationMinutes * 60000, 0
      )
      if (consumedMs > remainingBudgetMs(aggregate.session, atMs)) {
        throw new Error('That suggestion would exceed the remaining session budget.')
      }
      await updateSessionRecord(sessionId, { taskBundle, continuationSuggestionEntries })
    } else {
      await updateSessionRecord(sessionId, { taskBundle })
    }
    return refresh(sessionId, atMs)
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

  async function quickAdd (sessionId, title, retryIntent = null) {
    const name = String(title || '').trim()
    if (!name) throw new Error('Enter a task title.')
    const session = await getSession(sessionId)
    if (!session) throw new Error('The current session is no longer available.')
    const recoveringPendingAddition = session.status === 'paused'
      ? session.pendingAddition
      : null
    const suppliedIntent = retryIntent?.taskId &&
      String(retryIntent.title || '').trim() === name
      ? {
          taskId: String(retryIntent.taskId),
          title: name,
          createdAt: Number(retryIntent.createdAt) || now(),
          stage: 'creating'
        }
      : null
    const recoveringRetry = Boolean(
      suppliedIntent?.taskId && suppliedIntent.taskId === recoveringPendingAddition?.taskId
    )
    const requestedIntent = recoveringRetry
      ? null
      : suppliedIntent || {
          taskId: 'quick-' + sessionId + '-' + createId(),
          title: name,
          createdAt: now(),
          stage: 'creating'
        }

    let aggregate
    try {
      aggregate = await hydrate(session, now())
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (requestedIntent) failure.quickAddIntent = requestedIntent
      else if (recoveringPendingAddition?.taskId) {
        failure.quickAddTaskId = recoveringPendingAddition.taskId
      }
      throw failure
    }
    if (aggregate.session.status !== 'paused') return aggregate
    if (recoveringRetry) return aggregate

    const pending = requestedIntent
    try {
      await updateSessionRecord(sessionId, { pendingAddition: pending })
      return await refresh(sessionId, now())
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      failure.quickAddTaskId = pending.taskId
      failure.quickAddIntent = pending
      throw failure
    }
  }

  return {
    restoreCurrent, refresh, start, pause, conclude, reopen, attachTasks, quickAdd, resume
  }
}

export const sessionStore = createSessionStore()
