// ABOUTME: Pure compact timing and transitions for one durable session.
// ABOUTME: Derives elapsed time from persisted timestamps, never interval ticks.

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const unfinished = session => session?.status === 'active' || session?.status === 'paused'

export function chooseCurrentSession (sessions) {
  const candidates = sessions.filter(unfinished).sort((left, right) =>
    number(right._date_modified || right.startTime) -
    number(left._date_modified || left.startTime)
  )
  return {
    current: candidates[0] || null,
    interruptedIds: candidates.slice(1).map(session => session._id)
  }
}

export function activeElapsedMs (session, nowMs) {
  const accumulated = Math.max(0, number(session?.accumulatedActiveMs))
  if (session?.status !== 'active' || !number(session?.activeStartedAt)) return accumulated
  return accumulated + Math.max(0, number(nowMs) - number(session.activeStartedAt))
}

export function outcomeTiming (session, executions, nowMs) {
  const elapsed = activeElapsedMs(session, nowMs)
  const rawDurationMs = Math.max(0, elapsed - number(session?.checkpointElapsedMs))
  const latestEnd = executions.reduce((latest, execution) =>
    Math.max(latest, number(execution.endTime)), 0
  )
  return {
    startTime: latestEnd || number(session?.startTime),
    endTime: number(nowMs),
    rawDurationMs,
    activeElapsedMs: elapsed,
    actualDuration: Math.round(rawDurationMs / 60000) || 1
  }
}

export function pauseFields (session, atMs) {
  return {
    status: 'paused',
    accumulatedActiveMs: activeElapsedMs(session, atMs),
    activeStartedAt: null,
    pausedAt: number(atMs)
  }
}

export function resumeFields (atMs) {
  return { status: 'active', activeStartedAt: number(atMs), pausedAt: null }
}

export function resolvedTaskIds (executions) {
  return new Set(executions.map(execution => execution.taskId).filter(Boolean))
}

const allocatedMs = execution => Math.max(0,
  Number.isFinite(Number(execution.rawDurationMs))
    ? Number(execution.rawDurationMs)
    : number(execution.actualDuration) * 60000
)

export function normalizationFields (session, executions, nowMs) {
  const hasAccumulator = Number.isFinite(Number(session?.accumulatedActiveMs))
  const hasOpenStart = session?.status !== 'active' ||
    Number.isFinite(Number(session?.activeStartedAt))
  if (hasAccumulator && hasOpenStart) return {}
  const elapsed = Math.max(0, number(nowMs) - number(session?.startTime))
  const allocated = [...executions]
    .sort((left, right) => number(left.endTime) - number(right.endTime))
    .reduce((sum, execution) => sum + allocatedMs(execution), 0)
  return {
    accumulatedActiveMs: session?.status === 'paused' ? elapsed : 0,
    activeStartedAt: session?.status === 'active' ? number(session.startTime) : null,
    checkpointElapsedMs: Math.min(elapsed, allocated)
  }
}

export function conclusionFields (session, executions, atMs) {
  const total = activeElapsedMs(session, atMs)
  const allocated = executions.reduce((sum, execution) => sum + allocatedMs(execution), 0)
  return {
    status: 'completed', endTime: number(atMs), activeStartedAt: null,
    pausedAt: null, unassignedDurationMs: Math.max(0, total - allocated)
  }
}

export function remainingBudgetMs (session, nowMs) {
  return Math.max(0,
    number(session?.timeBudgetMinutes) * 60000 - activeElapsedMs(session, nowMs)
  )
}
