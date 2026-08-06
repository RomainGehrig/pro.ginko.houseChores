import { listAllTasks, createTask, updateTask } from './taskData.js'
import { enrichTasks } from './aiEnrich.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import {
  resolveSuggestedCategoryId,
  sanitizeLocationIds,
  selectableReferences,
  validateCategoryId
} from './categoryLocationLogic.js'
import { escapeAttribute } from './categoryLocationView.js'
import { formatDate, formatDuration, escapeHtml } from './helpers.js'

let tasksCache = []
const noActiveCategoryMessage = 'Add an active category before using AI enrichment.'

export async function initTasksView() {
  document.getElementById('addTasksBtn').addEventListener('click', handleAddTasks)
  document.getElementById('enrichBtn').addEventListener('click', handleEnrich)
  document.getElementById('proposedCards').addEventListener('click', handleProposedClick)
  document.getElementById('activeCards').addEventListener('click', handleActiveClick)
  categoryLocationStore.subscribe(renderTasks)
  await refreshTasksView()
}

export async function refreshTasksView() {
  tasksCache = await listAllTasks()
  renderTasks()
}

function renderTasks() {
  renderProposed()
  renderActive()
  renderArchived()
  syncEnrichmentAvailability()
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
  const categories = selectableReferences(categoryLocationStore.getSnapshot().categories)
  if (!categories.length) {
    statusEl.textContent = noActiveCategoryMessage
    return
  }
  const proposed = tasksCache.filter(t => t.status === 'proposed' && !t.suggestedCategory)
  if (!proposed.length) {
    statusEl.textContent = 'Nothing to enrich'
    return
  }
  statusEl.innerHTML = '<span class="freezr-spinner"></span>'
  try {
    const suggestions = await enrichTasks(proposed, categories.map(category => category.name))
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
  const snapshot = categoryLocationStore.getSnapshot()
  const categories = selectableReferences(snapshot.categories)
  const locations = selectableReferences(snapshot.locations)
  const proposed = tasksCache.filter(t => t.status === 'proposed')
  container.innerHTML = proposed.length
    ? proposed.map(task => proposedCardHtml(task, categories, locations)).join('')
    : '<p class="empty">No tasks awaiting review.</p>'
}

function proposedCardHtml(task, categories, locations) {
  const categoryId = task.categoryId ||
    resolveSuggestedCategoryId(task.suggestedCategory, categories) ||
    resolveSuggestedCategoryId(task.category, categories)
  const duration = task.suggestedDuration || task.estimatedDuration || ''
  const recurrence = task.suggestedRecurrenceDays ?? task.recurrence ?? ''
  const categoryOptions = categories.map(category =>
    '<option value="' + escapeAttribute(category._id) + '"' +
      (category._id === categoryId ? ' selected' : '') + '>' +
      escapeHtml(String(category.name)) + '</option>'
  ).join('')
  const selectedLocationIds = new Set(task.locationIds || [])
  const locationOptions = locations.length
    ? locations.map(location =>
        '<label class="task-location"><input class="f-location" name="locationIds" type="checkbox" value="' +
          escapeAttribute(location._id) + '"' + (selectedLocationIds.has(location._id) ? ' checked' : '') + '> ' +
          escapeHtml(String(location.name)) + '</label>'
      ).join('')
    : '<span class="empty">No active locations available.</span>'
  return (
    '<div class="task-card" data-id="' + escapeAttribute(task._id) + '">' +
      '<div class="task-name">' + escapeHtml(task.name) + '</div>' +
      '<label>Category <select class="f-category" name="categoryId"><option value="">-</option>' + categoryOptions + '</select></label>' +
      '<fieldset class="f-locations"><legend>Locations</legend>' + locationOptions + '</fieldset>' +
      '<label>Duration (min) <input class="f-duration" name="estimatedDuration" type="number" min="1" value="' + escapeAttribute(duration) + '"></label>' +
      '<label>Recurrence (days, blank = one-off) <input class="f-recurrence" name="recurrence" type="number" min="1" value="' + escapeAttribute(recurrence) + '"></label>' +
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
          '<div class="task-meta">' + escapeHtml(t.category || 'Uncategorized') + ' \u00b7 ' + formatDuration(t.estimatedDuration) +
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
  const task = tasksCache.find(item => item._id === id)
  if (!task) return
  const { categories, locations } = categoryLocationStore.getSnapshot()
  const selectedCategoryId = card.querySelector('.f-category').value || null
  const selectedLocationIds = [...card.querySelectorAll('.f-location:checked')].map(input => input.value)
  const categoryId = validateCategoryId(selectedCategoryId, categories, task.categoryId)
  const locationIds = sanitizeLocationIds(selectedLocationIds, locations, task.locationIds || [])
  const category = categories.find(item => item._id === categoryId) || null
  const duration = Number(card.querySelector('.f-duration').value) || null
  const recurrenceVal = card.querySelector('.f-recurrence').value
  const recurrence = recurrenceVal ? Number(recurrenceVal) : null

  await updateTask(id, {
    categoryId,
    category: category?.name || null,
    locationIds,
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

function syncEnrichmentAvailability() {
  const hasActiveCategories = selectableReferences(categoryLocationStore.getSnapshot().categories).length > 0
  const button = document.getElementById('enrichBtn')
  const status = document.getElementById('enrichStatus')
  button.disabled = !hasActiveCategories
  if (!hasActiveCategories) status.textContent = noActiveCategoryMessage
  else if (status.textContent === noActiveCategoryMessage) status.textContent = ''
}

async function handleActiveClick(evt) {
  if (!evt.target.classList.contains('archive-btn')) return
  const card = evt.target.closest('.task-card')
  await updateTask(card.dataset.id, { status: 'archived' })
  await refreshTasksView()
}
