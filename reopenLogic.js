// ABOUTME: Pure rules for taking back an outcome recorded by accident during a session.
// ABOUTME: Restores exactly the task fields the completion changed and the time it claimed.

const numberOrNull = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// Only the keys the completion is about to write, so reopening puts back
// precisely what it took and nothing else.
export function taskFieldsBeforeUpdate (task, taskUpdate) {
  if (!taskUpdate || typeof taskUpdate !== 'object') return null
  const before = {}
  for (const key of Object.keys(taskUpdate)) before[key] = task?.[key] ?? null
  return before
}

export function reopenPlan (execution, executions = []) {
  const claimed = numberOrNull(execution?.rawDurationMs) ?? 0
  const checkpoint = numberOrNull(execution?.activeElapsedMs)
  const latestCheckpoint = executions.reduce(
    (latest, item) => Math.max(latest, numberOrNull(item?.activeElapsedMs) ?? 0), 0)
  const isLatest = checkpoint !== null && checkpoint >= latestCheckpoint
  const taskUpdate = execution?.taskFieldsBefore && typeof execution.taskFieldsBefore === 'object'
    ? { ...execution.taskFieldsBefore }
    : null

  return {
    taskUpdate,
    restoresSchedule: Boolean(taskUpdate),
    // Only the most recent outcome holds the checkpoint; reopening an earlier
    // one cannot un-claim time a later outcome has already counted.
    sessionUpdate: isLatest ? { checkpointElapsedMs: Math.max(0, checkpoint - claimed) } : null
  }
}
