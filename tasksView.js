import { listAllTasks, createTask, updateTask } from './taskData.js'
import { enrichTasks } from './aiEnrich.js'
import { CATEGORIES, formatDate, formatDuration, escapeHtml } from './helpers.js'

let tasksCache = []

export async function initTasksView() {
  document.getElementById('addTasksBtn').addEventListener('click', handleAddTasks)
  document.getElementById('enrichBtn').addEventListener('click', handleEnrich)
  document.getElementById('proposedCards').addEventListener('click', handleProposedClick)
  document.getElementById('activeCards').addEventListener('click', handleActiveClick)
  await refreshTasksView()
}

export async function refreshTasksView() {
  tasksCache = await listAllTasks()
  renderProposed()
  renderActive()
  renderArchived()
}

export function getActiveTasks() {
  return tasksCache.filter(t => t.status === 'active' || t.status === 'approved_recurring')
}

async function handleAddTasks() {
  const input = document.getElementById('newTaskInput')
  const names = input.value.split('\n').map(n => n.trim()).filter(Boolean)
  if (!names.length) return
  for (const name of names) {
    await createTask(name)
  }
  input.value = ''
  await refreshTasksView()
}

async function handleEnrich() {
  const statusEl = document.getElementById('enrichStatus')
  const proposed = tasksCache.filter(t => t.status === 'proposed' && !t.suggestedCategory)
  if (!proposed.length) {
    statusEl.textContent = 'Nothing to enrich'
    return
  }
  statusEl.innerHTML = '<span class="freezr-spinner"></span>'
  try {
    const suggestions = await enrichTasks(proposed)
    for (let i = 0; i < proposed.length; i++) {
      const s = suggestions[i]
      if (!s) continue
      await updateTask(proposed[i]._id, {
        suggestedCategory: s.category || null,
        suggestedDuration: s.estimatedDuration || null,
        suggestedRecurrenceDays: s.recurrenceDays ?? null
      })
    }
    statusEl.textContent = 'Suggestions ready - review below'
    await refreshTasksView()
  } catch (err) {
    statusEl.textContent = 'AI enrichment unavailable: ' + err.message
  }
}

function renderProposed() {
  const container = document.getElementById('proposedCards')
  const proposed = tasksCache.filter(t => t.status === 'proposed')
  container.innerHTML = proposed.length
    ? proposed.map(proposedCardHtml).join('')
    : '<p class="empty">No tasks awaiting review.</p>'
}

function proposedCardHtml(task) {
  const category = task.suggestedCategory || task.category || ''
  const duration = task.suggestedDuration || task.estimatedDuration || ''
  const recurrence = task.suggestedRecurrenceDays ?? task.recurrence ?? ''
  const categoryOptions = CATEGORIES.map(c =>
    '<option value="' + c + '"' + (c === category ? ' selected' : '') + '>' + c + '</option>'
  ).join('')
  return (
    '<div class="task-card" data-id="' + task._id + '">' +
      '<div class="task-name">' + escapeHtml(task.name) + '</div>' +
      '<label>Category <select class="f-category"><option value="">-</option>' + categoryOptions + '</select></label>' +
      '<label>Duration (min) <input class="f-duration" type="number" min="1" value="' + escapeHtml(String(duration)) + '"></label>' +
      '<label>Recurrence (days, blank = one-off) <input class="f-recurrence" type="number" min="1" value="' + escapeHtml(String(recurrence)) + '"></label>' +
      '<button class="approve-btn">Approve</button>' +
    '</div>'
  )
}

function renderActive() {
  const container = document.getElementById('activeCards')
  const active = getActiveTasks()
  container.innerHTML = active.length
    ? active.map(t => (
        '<div class="task-card" data-id="' + t._id + '">' +
          '<div class="task-name">' + escapeHtml(t.name) + '</div>' +
          '<div class="task-meta">' + (t.category || 'Uncategorized') + ' \u00b7 ' + formatDuration(t.estimatedDuration) +
            (t.recurrence ? ' \u00b7 every ' + t.recurrence + 'd' : '') + '</div>' +
          '<div class="task-meta">Next due: ' + formatDate(t.nextDueDate) + '</div>' +
          '<button class="archive-btn">Archive</button>' +
        '</div>'
      )).join('')
    : '<p class="empty">No active tasks.</p>'
}

function renderArchived() {
  const container = document.getElementById('archivedCards')
  const archived = tasksCache.filter(t => t.status === 'archived')
  container.innerHTML = archived.length
    ? archived.map(t => '<div class="task-card archived"><div class="task-name">' + escapeHtml(t.name) + '</div></div>').join('')
    : '<p class="empty">No archived tasks.</p>'
}

async function handleProposedClick(evt) {
  if (!evt.target.classList.contains('approve-btn')) return
  const card = evt.target.closest('.task-card')
  const id = card.dataset.id
  const category = card.querySelector('.f-category').value || null
  const duration = Number(card.querySelector('.f-duration').value) || null
  const recurrenceVal = card.querySelector('.f-recurrence').value
  const recurrence = recurrenceVal ? Number(recurrenceVal) : null

  await updateTask(id, {
    category,
    estimatedDuration: duration,
    recurrence,
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedRecurrenceDays: null,
    status: recurrence ? 'approved_recurring' : 'active',
    nextDueDate: Date.now()
  })
  await refreshTasksView()
}

async function handleActiveClick(evt) {
  if (!evt.target.classList.contains('archive-btn')) return
  const card = evt.target.closest('.task-card')
  await updateTask(card.dataset.id, { status: 'archived' })
  await refreshTasksView()
}