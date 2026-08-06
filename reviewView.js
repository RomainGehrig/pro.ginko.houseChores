import { state } from './state.js'
import { listExecutionsBySession, updateExecution, listExecutionsByTask } from './executionData.js'
import { updateTask, listTasksByIds } from './taskData.js'
import { suggestDuration } from './aiEnrich.js'
import { formatDuration, escapeHtml } from './helpers.js'
import { showView, setNavVisible } from './viewRouter.js'
import { refreshTasksView } from './tasksView.js'

let executionsCache = []

export function initReviewView() {
  document.getElementById('finishReviewBtn').addEventListener('click', handleFinish)
}

export async function startReview() {
  executionsCache = await listExecutionsBySession(state.currentSession._id)
  const taskIds = [...new Set(executionsCache.map(e => e.taskId))]
  const tasks = taskIds.length ? await listTasksByIds(taskIds) : []
  const nameById = new Map(tasks.map(t => [t._id, t.name]))
  executionsCache.forEach(e => { e.taskName = nameById.get(e.taskId) || 'Unknown task' })
  renderReviewList()
}

function renderReviewList() {
  const container = document.getElementById('reviewList')
  if (!executionsCache.length) {
    container.innerHTML = '<p class="empty">No tasks were completed this session.</p>'
    return
  }
  container.innerHTML = executionsCache.map(execCardHtml).join('')
  container.querySelectorAll('.exec-card').forEach(card => {
    const id = card.dataset.id
    card.querySelector('.f-actual').addEventListener('change', (e) => {
      const exec = executionsCache.find(x => x._id === id)
      exec.actualDuration = Number(e.target.value) || exec.actualDuration
    })
    card.querySelector('.f-difficulty').addEventListener('change', (e) => {
      const exec = executionsCache.find(x => x._id === id)
      exec.difficultyRating = Number(e.target.value) || null
    })
    card.querySelector('.f-notes').addEventListener('change', (e) => {
      const exec = executionsCache.find(x => x._id === id)
      exec.notes = e.target.value
    })
  })
}

function execCardHtml(exec) {
  const outcomeLabel = { done: 'Done', cancelled: 'Cancelled', already_done: 'Already done' }[exec.outcome] || exec.outcome
  return (
    '<div class="exec-card" data-id="' + exec._id + '">' +
      '<div class="task-name">' + escapeHtml(exec.taskName) + '</div>' +
      '<div class="task-meta">' + escapeHtml(outcomeLabel) + '</div>' +
      '<label>Actual duration (min) <input class="f-actual" type="number" min="1" value="' + exec.actualDuration + '"></label>' +
      '<label>Difficulty (1-5) <input class="f-difficulty" type="number" min="1" max="5" value="' + (exec.difficultyRating || '') + '"></label>' +
      '<label>Notes <input class="f-notes" type="text" value="' + escapeHtml(exec.notes || '') + '"></label>' +
    '</div>'
  )
}

async function handleFinish() {
  for (const exec of executionsCache) {
    await updateExecution(exec._id, {
      actualDuration: exec.actualDuration,
      difficultyRating: exec.difficultyRating,
      notes: exec.notes
    })
  }

  await suggestDurationUpdates()
  await refreshTasksView()
  setNavVisible('review', false)
  showView('tasks')
}

async function suggestDurationUpdates() {
  const taskIds = [...new Set(executionsCache.filter(e => e.outcome !== 'cancelled').map(e => e.taskId))]
  for (const taskId of taskIds) {
    const history = await listExecutionsByTask(taskId)
    if (history.length < 3) continue
    const suggested = await suggestDuration(history.slice(0, 5))
    if (suggested) {
      const accept = confirm('Update this task\'s estimated duration to ' + formatDuration(suggested) + ' based on recent executions?')
      if (accept) await updateTask(taskId, { estimatedDuration: suggested })
    }
  }
}