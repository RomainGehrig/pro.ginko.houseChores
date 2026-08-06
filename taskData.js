export const listAllTasks = () => freezr.query('tasks', {}, { sort: { _date_modified: -1 } })

export const createTask = (name) => freezr.create('tasks', {
  name,
  category: null,
  estimatedDuration: null,
  recurrence: null,
  lastCompletedDate: null,
  nextDueDate: Date.now(),
  status: 'proposed',
  suggestedCategory: null,
  suggestedDuration: null,
  suggestedRecurrenceDays: null
})

export const updateTask = (id, fields) => freezr.updateFields('tasks', id, fields)

export const listTasksByIds = async (ids) => {
  const all = await freezr.query('tasks', {}, { sort: { _date_modified: -1 } })
  return all.filter(t => ids.includes(t._id))
}