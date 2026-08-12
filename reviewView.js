import { state } from './state.js'
import { listExecutionsBySession, updateExecution, listExecutionsByTask } from './executionData.js'
import { updateTask, listTasksByIds } from './taskData.js'
import { getSessionById } from './sessionData.js'
import { suggestDuration } from './aiEnrich.js'
import { formatDuration, escapeHtml, formatFactHtml } from './helpers.js'
import {
  driftLine, measuredLine, estimateLine, difficultyLabel,
  receiptHeadline, receiptOffersLine, receiptSaveLabel, receiptDateLine
} from './receiptLogic.js'
import { showView, setNavVisible } from './router.js'
import { refreshTasksView } from './tasksView.js'

let executionsCache = []
let durationOffersCache = []
let reviewLoadGeneration = 0
let reviewSessionId = null
let readyReviewSessionId = null

function reviewLoadIsCurrent (generation, sessionId) {
  return generation === reviewLoadGeneration && reviewSessionId === sessionId
}

// What the session clock saw, kept beside the correction so the user can go back
// to it. A correction never erases the measurement.
function sessionMeasuredMinutes (execution) {
  const raw = Number(execution?.rawDurationMs)
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw / 60000))
  return Number(execution?.actualDuration) || null
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

// Keep is pressed by default and stays that way unless the user says otherwise:
// no estimate ever changes on its own.
export function durationOfferHtml (offer) {
  const updateSelected = offer.decision === 'update'
  return '<section class="duration-offer" data-task-id="' + escapeHtml(offer.taskId) + '">' +
    '<div class="task-name display">' + formatFactHtml(offer.taskName) + '</div>' +
    '<p class="task-meta">Current ' + formatFactHtml(formatDuration(offer.current)) +
      ' → suggested ' + formatFactHtml(formatDuration(offer.suggested)) + '</p>' +
    '<div class="duration-offer-actions">' +
      '<button type="button" class="pill pill-compact" data-offer-action="keep" aria-pressed="' +
        (!updateSelected) + '">Keep</button>' +
      '<button type="button" class="pill pill-compact" data-offer-action="update" aria-pressed="' +
        updateSelected + '">Update</button>' +
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

export async function startReview (options = {}) {
  const explicitSessionId = Object.hasOwn(options, 'sessionId')
  const onCurrentError = options.onCurrentError
  const sessionId = String(options.sessionId || state.currentSession?._id || '')
  if (!sessionId) {
    renderReviewLoadError('This session review is not available.')
    return false
  }
  if (!options.force && readyReviewSessionId === sessionId) {
    setNavVisible('review', true, sessionId)
    return true
  }
  const generation = ++reviewLoadGeneration
  reviewSessionId = sessionId
  readyReviewSessionId = null
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
    if (explicitSessionId) {
      const session = await getSessionById(sessionId)
      if (!reviewLoadIsCurrent(generation, sessionId)) return false
      if (!session || session.status !== 'completed') {
        setNavVisible('review', false)
        renderReviewLoadError('This session review is not available.')
        return false
      }
    }
    setNavVisible('review', true, sessionId)
    const executions = await listExecutionsBySession(sessionId)
    if (!reviewLoadIsCurrent(generation, sessionId)) return false
    const taskIds = [...new Set(executions.map(e => e.taskId))]
    const tasks = taskIds.length ? await listTasksByIds(taskIds) : []
    if (!reviewLoadIsCurrent(generation, sessionId)) return false
    const taskById = new Map(tasks.map(t => [t._id, t]))
    const loadedExecutions = executions.map(execution => ({
      ...execution,
      taskName: taskById.get(execution.taskId)?.name || 'Unknown task',
      taskEstimate: Number(taskById.get(execution.taskId)?.estimatedDuration) || null,
      measuredDuration: sessionMeasuredMinutes(execution)
    }))
    if (!reviewLoadIsCurrent(generation, sessionId)) return false
    executionsCache = loadedExecutions
    readyReviewSessionId = sessionId
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
    if (explicitSessionId) {
      renderReviewLoadError(
        'Could not load this session review.',
        () => startReview({ sessionId, force: true })
      )
      return false
    }
    throw error
  }
}

export function renderReviewLoadError(message, retry = null) {
  reviewLoadGeneration++
  readyReviewSessionId = null
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
  if (!retry) return
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
  markCardsWithOffers()
  renderReceiptHeader()
}

// Offers arrive after the cards are on screen, so the flag is added in place
// rather than by re-rendering a card the user may already be typing into.
function markCardsWithOffers () {
  const list = document.getElementById('reviewList')
  if (!list) return
  const offered = new Set(durationOffersCache.map(offer => offer.taskId))
  for (const card of list.querySelectorAll('.exec-card')) {
    const execution = executionsCache.find(item => item._id === card.dataset.id)
    const head = card.querySelector('.exec-card-head')
    const existing = head.querySelector('.offer-flag')
    if (!offered.has(execution?.taskId)) { existing?.remove(); continue }
    if (existing) continue
    const flag = document.createElement('span')
    flag.className = 'tag tag-accent offer-flag'
    flag.textContent = 'new estimate?'
    head.appendChild(flag)
  }
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

// The card restates its own facts as the user corrects them, so the drift line
// never contradicts the figure in the field beside it.
function refreshCardFacts (card, exec) {
  card.querySelector('.card-facts').innerHTML = formatFactHtml(cardFacts(exec))
  card.querySelector('.difficulty-word').textContent = difficultyLabel(exec.difficultyRating)
  const reset = card.querySelector('.reset-actual')
  reset.hidden = exec.measuredDuration == null ||
    Number(exec.actualDuration) === Number(exec.measuredDuration)
}

function wireExecutionCard (card) {
  const id = card.dataset.id
  const exec = () => executionsCache.find(x => x._id === id)
  const actual = card.querySelector('.f-actual')
  const difficulty = card.querySelector('.f-difficulty')

  const setActual = value => {
    actual.value = String(value)
    actual.dispatchEvent(new Event('change', { bubbles: true }))
  }

  actual.addEventListener('change', event => {
    const execution = exec()
    applyDurationCorrection(execution, event.target.value)
    refreshCardFacts(card, execution)
  })
  difficulty.addEventListener('change', event => {
    const execution = exec()
    execution.difficultyRating = Number(event.target.value) || null
    refreshCardFacts(card, execution)
  })
  card.querySelector('.f-notes').addEventListener('change', event => {
    exec().notes = event.target.value
  })

  card.addEventListener('click', event => {
    const step = event.target.closest('[data-step]')
    if (step) return setActual(Math.max(1, Number(actual.value || 0) + Number(step.dataset.step)))

    if (event.target.closest('.reset-actual')) return setActual(exec().measuredDuration)

    const level = event.target.closest('[data-difficulty]')
    if (!level) return
    const alreadyOn = level.getAttribute('aria-pressed') === 'true'
    const chosen = alreadyOn ? 0 : Number(level.dataset.difficulty)
    difficulty.value = chosen ? String(chosen) : ''
    for (const pill of card.querySelectorAll('[data-difficulty]')) {
      pill.setAttribute('aria-pressed', Number(pill.dataset.difficulty) === chosen ? 'true' : 'false')
      pill.classList.toggle('is-filled', Number(pill.dataset.difficulty) <= chosen)
    }
    difficulty.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function renderReceiptHeader () {
  const eyebrow = document.getElementById('receiptEyebrow')
  const headline = document.getElementById('receiptHeadline')
  const offersLine = document.getElementById('receiptOffersLine')
  const finish = document.getElementById('finishReviewBtn')
  const endedAt = executionsCache.reduce(
    (latest, execution) => Math.max(latest, Number(execution.endTime) || 0), 0)

  if (eyebrow) eyebrow.textContent = receiptDateLine(endedAt)
  if (headline) headline.textContent = receiptHeadline(executionsCache)
  if (offersLine) offersLine.textContent = receiptOffersLine(durationOffersCache.length)
  if (finish) {
    finish.textContent = receiptSaveLabel(
      durationOffersCache.filter(offer => offer.decision === 'update').length)
  }
}

function renderReviewList() {
  const container = document.getElementById('reviewList')
  renderReceiptHeader()
  if (!executionsCache.length) {
    container.innerHTML = '<p class="empty">No tasks were completed this session.</p>'
    return
  }
  container.innerHTML = executionsCache.map(reviewExecutionCardHtml).join('')
  container.querySelectorAll('.exec-card').forEach(wireExecutionCard)
}

const DIFFICULTY_CHOICES = [1, 2, 3, 4, 5]

const OUTCOME_LABELS = { done: 'Done', cancelled: 'Skipped', already_done: 'Already done' }

const difficultyPillsHtml = rating =>
  '<input type="hidden" class="f-difficulty" name="difficultyRating" value="' + escapeHtml(String(rating || '')) + '">' +
  '<div class="pill-set difficulty-set" role="group" aria-label="Difficulty (1-5)">' +
  DIFFICULTY_CHOICES.map(level =>
    '<button type="button" class="pill pill-compact' +
      (Number(rating) >= level ? ' is-filled' : '') + '" data-difficulty="' + level +
      '" aria-pressed="' + (Number(rating) === level ? 'true' : 'false') + '">' +
      '<span class="fig">' + level + '</span></button>'
  ).join('') +
  '<span class="difficulty-word muted">' + escapeHtml(difficultyLabel(rating)) + '</span>' +
  '</div>'

// Drift only means something for a chore the session actually did: a skipped
// chore claims no work time, so comparing its clock to the estimate would lie.
function cardFacts (exec) {
  const drift = exec.outcome === 'done' ? driftLine(exec.actualDuration, exec.taskEstimate) : ''
  return [OUTCOME_LABELS[exec.outcome] || exec.outcome, drift, estimateLine(exec.taskEstimate)]
    .filter(Boolean).join(' · ')
}

export function reviewExecutionCardHtml(exec) {
  const skipped = exec.outcome === 'cancelled'
  const measured = measuredLine(exec.measuredDuration)
  const corrected = exec.measuredDuration != null &&
    Number(exec.actualDuration) !== Number(exec.measuredDuration)

  return (
    '<div class="exec-card" data-id="' + exec._id + '">' +
      '<div class="exec-card-head">' +
        '<div class="task-name display">' + formatFactHtml(exec.taskName) + '</div>' +
        '<span class="tag ' + (skipped ? 'tag-neutral' : 'tag-sage') + '">' +
          formatFactHtml(OUTCOME_LABELS[exec.outcome] || exec.outcome) + '</span>' +
      '</div>' +
      '<p class="task-meta card-facts">' + formatFactHtml(cardFacts(exec)) + '</p>' +
      '<div class="field-group">' +
        '<span class="eyebrow eyebrow-quiet">Actual duration</span>' +
        '<div class="stepper">' +
          '<button type="button" class="pill-icon" data-step="-1" aria-label="One minute less">\u2212</button>' +
          '<input class="f-actual input fig" type="number" name="actualDuration" min="1" inputmode="numeric" ' +
            'aria-label="Actual duration in minutes" value="' + escapeHtml(String(exec.actualDuration)) + '">' +
          '<span class="stepper-unit muted">min</span>' +
          '<button type="button" class="pill-icon" data-step="1" aria-label="One minute more">+</button>' +
          '<button type="button" class="btn btn-ghost reset-actual"' + (corrected ? '' : ' hidden') +
            '>Reset</button>' +
        '</div>' +
        (measured ? '<span class="measured-line muted">' + formatFactHtml(measured) + '</span>' : '') +
      '</div>' +
      '<div class="field-group">' +
        '<span class="eyebrow eyebrow-quiet">' +
          'Difficulty (<span class="fig">1</span>-<span class="fig">5</span>)</span>' +
        difficultyPillsHtml(exec.difficultyRating) +
      '</div>' +
      '<div class="field-group">' +
        '<span class="eyebrow eyebrow-quiet">Notes</span>' +
        '<textarea class="f-notes input" name="notes" rows="2" placeholder="Anything worth remembering">' +
          escapeHtml(exec.notes || '') + '</textarea>' +
      '</div>' +
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
  reviewSessionId = null
  readyReviewSessionId = null
  await saveExecutionReviews(executionsCache)
  await applyDurationOfferUpdates(durationOffersCache)
  await refreshTasksView()
  setNavVisible('review', false)
  showView('tasks')
}
