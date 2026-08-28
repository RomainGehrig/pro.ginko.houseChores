import { normalizeTaskSchedule } from './scheduleLogic.js'
import { upgradeLegacyTasks } from './taskMigration.js'
import { normalizeTaskAvailability } from './taskModeLogic.js'

export function buildNewTaskRecord (name) {
  return {
    name,
    category: null,
    categoryId: null,
    locationIds: [],
    estimatedDuration: null,
    scheduledDate: null,
    schedule: { type: 'one_off' },
    lastCompletedDate: null,
    taskMode: 'scheduled',
    readiness: null,
    readySince: null,
    status: 'proposed',
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null
  }
}

// Records carrying the old field names are rewritten as they are read, so the
// upgrade needs no query of its own and stops happening once nothing is left to
// upgrade. Everything downstream may then assume the current shape.
export const listAllTasks = async () => {
  const tasks = await freezr.query('tasks', {}, { sort: { _date_modified: -1 } })
  const upgraded = await upgradeLegacyTasks(tasks, (id, fields) =>
    freezr.update('tasks', id, fields))
  return upgraded.map(task =>
    normalizeTaskAvailability(normalizeTaskSchedule(task)))
}

export const createTask = name => freezr.create('tasks', buildNewTaskRecord(name))
export const createTaskWithId = (name, id) => freezr.create(
  'tasks',
  buildNewTaskRecord(name),
  { data_object_id: id, upsert: true }
)
export const updateTask = (id, fields) => freezr.updateFields('tasks', id, fields)
export const deleteTask = id => freezr.delete('tasks', id)

export const listTasksByIds = async ids => {
  const all = await listAllTasks()
  return all.filter(task => ids.includes(task._id))
}
