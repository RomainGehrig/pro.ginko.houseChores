import { parseLocalDate } from './scheduleLogic.js'

export const taskModeOf = task => task?.taskMode === 'as_needed'
  ? 'as_needed'
  : 'scheduled'

export const isAsNeededTask = task => taskModeOf(task) === 'as_needed'

export function taskReadinessOf (task) {
  if (!isAsNeededTask(task)) return null
  return task?.readiness === 'ready' ? 'ready' : 'waiting'
}

export const isReadyAsNeededTask = task =>
  isAsNeededTask(task) && taskReadinessOf(task) === 'ready'

export const isTaskEligible = task =>
  !isAsNeededTask(task) || taskReadinessOf(task) === 'ready'

export const taskReadySinceOf = task =>
  isReadyAsNeededTask(task) && parseLocalDate(task?.readySince)
    ? task.readySince
    : null

export function normalizeTaskAvailability (task = {}) {
  return {
    ...task,
    taskMode: taskModeOf(task),
    readiness: taskReadinessOf(task),
    readySince: taskReadySinceOf(task)
  }
}

export function taskModeFields (task, nextMode) {
  if (nextMode !== 'as_needed') {
    return { taskMode: 'scheduled', readiness: null, readySince: null }
  }
  const readiness = isAsNeededTask(task) ? taskReadinessOf(task) : 'waiting'
  return {
    taskMode: 'as_needed',
    readiness,
    readySince: readiness === 'ready' ? taskReadySinceOf(task) : null
  }
}
