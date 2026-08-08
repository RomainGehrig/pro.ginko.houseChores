// ABOUTME: Renders archived chores and coordinates restore and permanent-delete actions.
// ABOUTME: Keeps datastore writes behind explicit controls and reports failures inline.

import { deleteTask, updateTask } from './taskData.js'
import { buildActiveTaskDetailsHtml } from './taskPresentationLogic.js'
import { escapeHtml, formatFactHtml } from './helpers.js'
import { commitPending, undoPending } from './undoToast.js'
import { openSheet } from './sheet.js'

let refreshTasksView = async () => {}
let archivedTasks = new Map()

export function archivedTaskCardHtml (task, snapshot) {
  return '<article class="task-card archived" data-id="' + escapeHtml(task._id) + '" aria-busy="false">' +
    '<div class="task-name">' + formatFactHtml(String(task.name ?? '')) +
      ' <span class="state-badge stamp">Archived</span></div>' +
    buildActiveTaskDetailsHtml(task, snapshot) +
    '<div class="archive-actions">' +
      '<button type="button" data-action="restore">Restore</button>' +
      '<button type="button" class="btn-danger" data-action="delete">Delete permanently</button>' +
    '</div>' +
  '</article>'
}

export function restoredTaskStatus (task) {
  return task?.schedule?.type === 'one_off' ? 'active' : 'approved_recurring'
}

export function renderArchiveView (tasks, snapshot) {
  const archived = tasks.filter(task => task.status === 'archived')
  archivedTasks = new Map(archived.map(task => [String(task._id), task]))
  const container = document.getElementById('archivedCards')
  const count = document.getElementById('archiveNavCount')
  if (count) count.textContent = archived.length
  if (container) {
    container.innerHTML = archived.length
      ? archived.map(task => archivedTaskCardHtml(task, snapshot)).join('')
      : '<p class="empty">No archived tasks.</p>'
  }
}

export async function runArchiveAction ({
  action,
  task,
  undo = undoPending,
  commit = commitPending,
  update = updateTask,
  remove = deleteTask,
  confirmDelete = openSheet,
  refresh = refreshTasksView
}) {
  if (action === 'restore') {
    try {
      const settlement = await undo(`task:${task._id}`)
      if (settlement) return { ok: true, pendingArchiveRestored: true }
      await update(task._id, { status: restoredTaskStatus(task) })
      await refresh()
      return { ok: true, pendingArchiveRestored: false }
    } catch {
      return { ok: false, message: "Couldn't restore that. The chore is unchanged." }
    }
  }

  if (action === 'delete') {
    try {
      const choice = await confirmDelete({
        title: 'Delete chore permanently?',
        message: String(task.name ?? 'This chore') + ' will be removed permanently.',
        actions: [
          { value: 'keep', label: 'Keep', className: 'btn-quiet' },
          { value: 'delete', label: 'Delete permanently', className: 'btn-danger' }
        ]
      })
      if (choice !== 'delete') return { ok: true, deleted: false }
      await commit(`task:${task._id}`)
      await remove(task._id)
      await refresh()
      return { ok: true, deleted: true }
    } catch {
      return { ok: false, message: "Couldn't delete that. The chore is still in Archive." }
    }
  }

  return { ok: true }
}

export function initArchiveView ({ refreshTasks }) {
  refreshTasksView = refreshTasks
  const container = document.getElementById('archivedCards')
  if (!container) return false

  container.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]')
    if (!button || !container.contains(button)) return
    const card = button.closest('[data-id]')
    if (!card || card.getAttribute('aria-busy') === 'true') return
    const task = archivedTasks.get(String(card.dataset.id))
    if (!task) return

    const status = document.getElementById('archiveStatus')
    status.textContent = ''
    status.removeAttribute('data-state')
    status.setAttribute('role', 'status')
    card.setAttribute('aria-busy', 'true')
    const result = await runArchiveAction({
      action: button.dataset.action,
      task,
      refresh: refreshTasksView
    })
    if (card.isConnected) card.setAttribute('aria-busy', 'false')
    if (!result.ok) {
      status.textContent = result.message
      status.dataset.state = 'error'
      status.setAttribute('role', 'alert')
    }
  })
  return true
}
