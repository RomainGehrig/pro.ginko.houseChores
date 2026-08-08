import { state } from './state.js'
import { listExecutionsBySession, updateExecution, listExecutionsByTask } from './executionData.js'
import { updateTask, listTasksByIds } from './taskData.js'
import { suggestDuration } from './aiEnrich.js'
import { formatDuration, escapeHtml, formatFactHtml } from './helpers.js'
import { showView, setNavVisible } from './router.js'
import { refreshTasksView } from './tasksView.js'

let executionsCache = []
let durationOffersCache = []
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

export function createDurationOffer (task, suggested) {
  return {
    taskId: task._id,
    taskName: String(task.name ?? 'Unknown task'),
    current: Number(task.estimatedDuration),
    suggested: Number(suggested),
    decision: 'keep'
  }
}

export function durationOfferHtml (offer) {
  const updateSelected = offer.decision === 'update'
  return '<section class="duration-offer" data-task-id="' + escapeHtml(offer.taskId) + '">' +
    '<div class="task-name">' + formatFactHtml(offer.taskName) + '</div>' +
    '<p class="task-meta">Current ' + formatFactHtml(formatDuration(offer.current)) +
      ' → suggested ' + formatFactHtml(formatDuration(offer.suggested)) + '</p>' +
    '<div class="duration-offer-actions">' +
      '<button type="button" data-offer-action="update" aria-pressed="' + updateSelected + '">Update</button>' +
      '<button type="button" data-offer-action="keep" aria-pressed="' + (!updateSelected) + '">Keep</button>' +
    '</div>' +
  '</section>'
}

export function setDurationOfferDecision (offers, taskId, decision) {
  return offers.map(offer => offer.taskId === taskId
    ? { ...offer, decision: decision === 'update' ? 'update' : 'keep' }
    : offer
  )
}

export async function applyDurationOfferUpdates (offers, saveTask = updateTask) {
  for (const offer of offers) {
    if (offer.decision === 'update') {
      await saveTask(offer.taskId, { estimatedDuration: offer.suggested })
    }
  }
}

export async function buildDurationOffers ({
  executions,
  tasks,
  loadHistory = listExecutionsByTask,
  suggest = suggestDuration,
  isCurrent = () => true
}) {
  const taskIds = [...new Set(executions
    .filter(execution => execution.outcome !== 'cancelled')
    .map(execution => execution.taskId))]
  const taskById = new Map(tasks.map(task => [task._id, task]))
  const offers = []

  for (const taskId of taskIds) {
    const task = taskById.get(taskId)
    if (!task) continue
    const history = await loadHistory(taskId)
    if (!isCurrent()) return null
    if (history.length < 3) continue
    const suggested = await suggest(history.slice(0, 5))
    if (!isCurrent()) return null
    if (Number(suggested) > 0) offers.push(createDurationOffer(task, suggested))
  }
  return offers
}

export function initReviewView() {
  document.getElementById('finishReviewBtn').addEventListener('click', handleFinish)
  document.getElementById('durationOffers').addEventListener('click', event => {
    const button = event.target.closest('[data-offer-action]')
    const offer = button?.closest('[data-task-id]')
    if (!button || !offer) return
    durationOffersCache = setDurationOfferDecision(
      durationOffersCache,
      offer.dataset.taskId,
      button.dataset.offerAction
    )
    renderDurationOffers()
  })
}

export async function startReview({ onCurrentError } = {}) {
  const sessionId = state.currentSession._id
  const generation = ++reviewLoadGeneration
  executionsCache = []
  durationOffersCache = []
  const list = document.getElementById('reviewList')
  const finish = document.getElementById('finishReviewBtn')
  finish.disabled = true
  list.replaceChildren()
  renderDurationOffers()
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
    setTimeout(() => loadDurationOffers(generation, sessionId, loadedExecutions, tasks), 0)
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
  durationOffersCache = []
  renderDurationOffers()
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

function renderDurationOffers () {
  const container = document.getElementById('durationOffers')
  if (!container) return
  container.innerHTML = durationOffersCache.map(durationOfferHtml).join('')
}

async function loadDurationOffers (generation, sessionId, executions, tasks) {
  if (!reviewLoadIsCurrent(generation, sessionId)) return false
  try {
    const offers = await buildDurationOffers({
      executions,
      tasks,
      isCurrent: () => reviewLoadIsCurrent(generation, sessionId)
    })
    if (!offers || !reviewLoadIsCurrent(generation, sessionId)) return false
    durationOffersCache = offers
    renderDurationOffers()
    return true
  } catch {
    return false
  }
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
  reviewLoadGeneration++
  await saveExecutionReviews(executionsCache)
  await applyDurationOfferUpdates(durationOffersCache)
  await refreshTasksView()
  setNavVisible('review', false)
  showView('tasks')
}
