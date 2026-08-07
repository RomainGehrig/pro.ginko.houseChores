// ABOUTME: Pure candidate and selection rules for continuing a paused session.
// ABOUTME: Limits suggestions while leaving deliberate search unrestricted.

import { prioritizeTasks } from './bundleLogic.js'

const active = task => task.status === 'active' || task.status === 'approved_recurring'
const estimateMs = task => Math.max(0, Number(task?.estimatedDuration || 0)) * 60000

export function suggestContinuationTasks (tasks, excludedIds, remainingMs) {
  const excluded = new Set(excludedIds)
  return prioritizeTasks(tasks.filter(task =>
    active(task) && !excluded.has(task._id) &&
    estimateMs(task) > 0 && estimateMs(task) <= remainingMs
  ))
}

export function searchContinuationTasks (tasks, query, excludedIds) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  if (!needle) return []
  const excluded = new Set(excludedIds)
  return prioritizeTasks(tasks.filter(task =>
    active(task) && !excluded.has(task._id) &&
    String(task.name || '').toLocaleLowerCase().includes(needle)
  ))
}

export function suggestionSelectionFits (selectedTasks, candidate, remainingMs) {
  return selectedTasks.reduce((sum, task) => sum + estimateMs(task), 0) +
    estimateMs(candidate) <= remainingMs
}
