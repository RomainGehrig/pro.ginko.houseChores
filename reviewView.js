import { state } from './state.js'
import { listExecutionsBySession, updateExecution, listExecutionsByTask } from './executionData.js'
import { updateTask, listTasksByIds } from './taskData.js'
import { suggestDuration } from './aiEnrich.js'
import { formatDuration, escapeHtml, formatFactHtml } from './helpers.js'
import { showView, setNavVisible } from './router.js'
import { refreshTasksView } from './tasksView.js'

let executionsCache = []
let reviewLoadGeneration = 0

function reviewLoadIsCurrent (generation, sessionId) {
  return generation === reviewLoadGeneration && state.currentSession?._id === sessionId
}

export function applyDurationCorrection (execution, value) {
  const actualDuration = Number(value)
  if (!Number.isFinite(actualDuration) || actualDuration < 1) return false
  execution.actualDuration = actualDuration
  execution.durationCorrected = true
  return true
}

export function initReviewView() {
  document.getElementById('finishReviewBtn').addEventListener('click', handleFinish)
}

export async function startReview({ onCurrentError } = {}) {
  const sessionId = state.currentSession._id
  const generation = ++reviewLoadGeneration
  executionsCache = []
  const list = document.getElementById('reviewList')
  const finish = document.getElementById('finishReviewBtn')
  finish.disabled = true
  list.replaceChildren()
  const loading = document.createElement('p')
  loading.className = 'inline-status'
  loading.textContent = 'Loading review…'
  loading.setAttribute('role', 'status')
  list.appendChild(loading)

  try {
    const executions = await listExecutionsBySession(sessionId)
    if (!reviewLoadIsCurrent(generation, sessionId)) return false
    const taskIds = [...new Set(executions.map(e => e.taskId))]
    const tasks = taskIds.length ? await listTasksByIds(taskIds) : []
    if (!reviewLoadIsCurrent(generation, sessionId)) return false
    const nameById = new Map(tasks.map(t => [t._id, t.name]))
    const loadedExecutions = executions.map(execution => ({
      ...execution,
      taskName: nameById.get(execution.taskId) || 'Unknown task'
    }))
    if (!reviewLoadIsCurrent(generation, sessionId)) return false
    executionsCache = loadedExecutions
    renderReviewList()
    finish.disabled = false
    return true
  } catch (error) {
    if (!reviewLoadIsCurrent(generation, sessionId)) return false
    if (onCurrentError) {
      onCurrentError(error)
      return false
    }
    throw error
  }
}

export function renderReviewLoadError(message, retry) {
  reviewLoadGeneration++
  executionsCache = []
  const list = document.getElementById('reviewList')
  const finish = document.getElementById('finishReviewBtn')
  finish.disabled = true
  list.replaceChildren()
  const error = document.createElement('p')
  error.className = 'inline-status'
  error.textContent = message
  error.setAttribute('role', 'alert')
  list.appendChild(error)
  const button = document.createElement('button')
  button.id = 'retryReviewLoadBtn'
  button.textContent = 'Retry review loading'
  button.addEventListener('click', async () => {
    if (button.disabled) return
    button.disabled = true
    await retry()
  })
  list.appendChild(button)
}

function renderReviewList() {
  const container = document.getElementById('reviewList')
  if (!executionsCache.length) {
    container.innerHTML = '<p class="empty">No tasks were completed this session.</p>'
    return
  }
  container.innerHTML = executionsCache.map(reviewExecutionCardHtml).join('')
  container.querySelectorAll('.exec-card').forEach(card => {
    const id = card.dataset.id
    card.querySelector('.f-actual').addEventListener('change', (e) => {
      const exec = executionsCache.find(x => x._id === id)
      applyDurationCorrection(exec, e.target.value)
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

export function reviewExecutionCardHtml(exec) {
  const outcomeLabel = { done: 'Done', cancelled: 'Cancelled', already_done: 'Already done' }[exec.outcome] || exec.outcome
  return (
    '<div class="exec-card" data-id="' + exec._id + '">' +
      '<div class="task-name">' + formatFactHtml(exec.taskName) + '</div>' +
      '<div class="task-meta">' + formatFactHtml(outcomeLabel) + '</div>' +
      '<label>Actual duration (min) <input class="f-actual" type="number" min="1" value="' + exec.actualDuration + '"></label>' +
      '<label>Difficulty (<span class="fig">1</span>-<span class="fig">5</span>) ' +
        '<input class="f-difficulty" type="number" min="1" max="5" value="' +
        (exec.difficultyRating || '') + '"></label>' +
      '<label>Notes <input class="f-notes" type="text" value="' + escapeHtml(exec.notes || '') + '"></label>' +
    '</div>'
  )
}

export async function saveExecutionReviews (executions, saveExecution = updateExecution) {
  for (const exec of executions) {
    const fields = {
      actualDuration: exec.actualDuration,
      difficultyRating: exec.difficultyRating,
      notes: exec.notes
    }
    if (exec.durationCorrected) {
      fields.rawDurationMs = Number(exec.actualDuration) * 60000
      fields.actualSeconds = Number(exec.actualDuration) * 60
    }
    await saveExecution(exec._id, fields)
  }
}

async function handleFinish() {
  await saveExecutionReviews(executionsCache)

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
