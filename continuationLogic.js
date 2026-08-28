// ABOUTME: Pure candidate and selection rules for adding to an unfinished session.
// ABOUTME: Limits suggestions while leaving deliberate search unrestricted.

import { prioritizeTasks } from './bundleLogic.js'
import { isTaskEligible } from './taskModeLogic.js'

const active = task =>
  (task.status === 'active' || task.status === 'approved_recurring') &&
  isTaskEligible(task)
const estimateMs = task => Math.max(0, Number(task?.estimatedDuration || 0)) * 60000

export function normalizeContinuationSuggestionEntries (value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.flatMap(entry => {
    const taskId = typeof entry?.taskId === 'string' ? entry.taskId.trim() : ''
    const estimatedDurationMinutes = Number(entry?.estimatedDurationMinutes)
    if (!taskId || seen.has(taskId) || !Number.isFinite(estimatedDurationMinutes) ||
      estimatedDurationMinutes <= 0) return []
    seen.add(taskId)
    return [{ taskId, estimatedDurationMinutes }]
  })
}

export function suggestContinuationTasks (tasks, excludedIds, remainingMs, today) {
  const excluded = new Set(excludedIds)
  const eligible = prioritizeTasks(tasks.filter(task =>
    active(task) && !excluded.has(task._id) && estimateMs(task) > 0
  ), today)
  if ((Number(remainingMs) || 0) > 0) {
    return eligible.filter(task => estimateMs(task) <= remainingMs)
  }
  return eligible.sort((left, right) => estimateMs(left) - estimateMs(right)).slice(0, 3)
}

export function searchContinuationTasks (tasks, query, excludedIds, today) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  if (!needle) return []
  const excluded = new Set(excludedIds)
  return prioritizeTasks(tasks.filter(task =>
    active(task) && !excluded.has(task._id) &&
    String(task.name || '').toLocaleLowerCase().includes(needle)
  ), today)
}

export function suggestionSelectionFits (selectedTasks, candidate, remainingMs) {
  return selectedTasks.reduce((sum, task) => sum + estimateMs(task), 0) +
    estimateMs(candidate) <= remainingMs
}

// The add field does two jobs at once. A name the chores already carry is a
// search hit; anything else is offered as a new chore rather than a dead end.
export function canQuickAdd (typed, tasks) {
  const title = String(typed ?? '').trim().toLowerCase()
  if (!title) return false
  return !(tasks || []).some(task =>
    String(task?.name ?? '').trim().toLowerCase() === title)
}
