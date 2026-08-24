export const taskModeOf = task => task?.taskMode === 'as_needed'
  ? 'as_needed'
  : 'scheduled'

export const isAsNeededTask = task => taskModeOf(task) === 'as_needed'

export function taskReadinessOf (task) {
  if (!isAsNeededTask(task)) return null
  return task?.readiness === 'ready' ? 'ready' : 'waiting'
}

export const isTaskEligible = task =>
  !isAsNeededTask(task) || taskReadinessOf(task) === 'ready'

export function normalizeTaskAvailability (task = {}) {
  return {
    ...task,
    taskMode: taskModeOf(task),
    readiness: taskReadinessOf(task)
  }
}

export function taskModeFields (task, nextMode) {
  if (nextMode !== 'as_needed') {
    return { taskMode: 'scheduled', readiness: null }
  }
  return {
    taskMode: 'as_needed',
    readiness: isAsNeededTask(task) ? taskReadinessOf(task) : 'waiting'
  }
}
