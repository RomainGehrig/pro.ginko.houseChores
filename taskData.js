import { localDateFromDate, normalizeTaskSchedule } from './scheduleLogic.js'

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
    status: 'proposed',
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null
  }
}

export const listAllTasks = async () => {
  const tasks = await freezr.query('tasks', {}, { sort: { _date_modified: -1 } })
  const today = localDateFromDate(new Date())
  return tasks.map(task => normalizeTaskSchedule(task, today))
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
