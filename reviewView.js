// ABOUTME: The Receipt — one two-track gauge per chore, actual above and estimate below.
// ABOUTME: Corrects what the session measured and offers, never imposes, a revised estimate.

import { state } from './state.js'
import { listExecutionsBySession, updateExecution, listExecutionsByTask } from './executionData.js'
import { updateTask, listTasksByIds } from './taskData.js'
import { getSessionById } from './sessionData.js'
import { suggestDuration } from './aiEnrich.js'
import { formatDuration, escapeHtml, formatFactHtml } from './helpers.js'
import {
  receiptHeadline, receiptSubline, receiptOffersLine, receiptSaveLabel, receiptDateLine,
  filedMessage, rowTimeLabel, driftChipLabel, actualCaption, estimateCaption, measuredNote,
  pastActualsLine, suggestionChipLabel, suggestionFlagText, resetEstimateLabel, offerLine
} from './receiptLogic.js'
import { gaugeSpan, gaugePercent, gaugeTicks, pinPlacement, handleOffset } from './receiptGauge.js'
import { setNavVisible } from './router.js'
import { refreshTasksView } from './tasksView.js'

const MAX_MINUTES = 600
const PAST_ACTUALS_SHOWN = 3

let rows = []
let reviewLoadGeneration = 0
let reviewSessionId = null
let readyReviewSessionId = null
let openRowId = null
let filed = false
let drag = null

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

export function buildRow (execution, task) {
  const measured = sessionMeasuredMinutes(execution)
  const omitted = execution.timeOmitted === true || execution.timeOmitted === 'true'
  const estimate = Number(task?.estimatedDuration) || null
  return {
    id: execution._id,
    taskId: execution.taskId,
    taskName: task?.name || 'Unknown task',
    outcome: execution.outcome,
    measured,
    actual: omitted ? null : (Number(execution.actualDuration) || measured || 0),
    omitted,
    notes: execution.notes || '',
    baseEstimate: estimate,
    estimate,
    suggestion: null,
    past: [],
    editingEstimate: false,
    corrected: false
  }
}

// The suggestion and the previous actuals come from the same history read: the
// dots on the track and the figure behind the chip are the same three sessions.
export async function loadRowHistory ({
  rows: list,
  loadHistory = listExecutionsByTask,
  suggest = suggestDuration,
  isCurrent = () => true
}) {
  const byTask = new Map()
  for (const row of list) {
    if (row.outcome === 'cancelled') continue
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, [])
    byTask.get(row.taskId).push(row)
  }

  for (const [taskId, taskRows] of byTask) {
    const history = await loadHistory(taskId)
    if (!isCurrent()) return null
    const past = history
      .filter(entry => entry._id !== taskRows[0].id)
      .map(entry => Number(entry.actualDuration))
      .filter(value => Number.isFinite(value) && value > 0)
      .slice(0, PAST_ACTUALS_SHOWN)
    const suggestion = history.length >= 3
      ? Number(await suggest(history.slice(0, PAST_ACTUALS_SHOWN))) || null
      : null
    if (!isCurrent()) return null
    for (const row of taskRows) {
      row.past = past
      row.suggestion = suggestion && suggestion !== row.baseEstimate ? suggestion : null
    }
  }
  return list
}

export function acceptedEstimateCount (list) {
  return list.filter(row => row.estimate !== row.baseEstimate).length
}

export function offeredRows (list) {
  return list.filter(row => row.suggestion !== null)
}

/* ── Geometry for one row ─────────────────────────────────────────────────── */

function rowSpan (row) {
  return gaugeSpan({
    actual: row.actual,
    estimate: row.estimate,
    suggestion: row.suggestion,
    past: row.past,
    frozen: drag && drag.id === row.id ? drag.span : 0
  })
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

const stepButton = (attribute, value, label) =>
  '<button type="button" class="pill-icon" ' + attribute + '="' + value + '" aria-label="' +
    escapeHtml(label) + '">' + (value < 0 ? '−' : '+') + '</button>'

export function reviewCardHtml (row) {
  const skipped = row.outcome === 'cancelled'
  return (
    '<div class="receipt-card" data-id="' + escapeHtml(row.id) + '"' +
        (skipped ? ' data-skipped="true"' : '') + '>' +
      '<button type="button" class="receipt-card-head" aria-expanded="false">' +
        '<span class="receipt-card-title">' +
          '<span class="task-name display">' + formatFactHtml(row.taskName) + '</span>' +
          '<span class="task-meta receipt-card-line"></span>' +
        '</span>' +
        '<span class="drift-chip" title="Actual against the estimate" hidden>' +
          '<span class="drift-mini">' +
            '<span class="drift-mini-bar drift-mini-actual"></span>' +
            '<span class="drift-mini-bar drift-mini-estimate"></span>' +
          '</span>' +
          '<span class="drift-chip-label fig"></span>' +
        '</span>' +
      '</button>' +
      (skipped ? '' : '<div class="receipt-card-body" hidden>' +
        '<div class="gauge-block">' +
          '<div class="gauge-head">' +
            '<span class="eyebrow eyebrow-quiet">Time</span>' +
            '<span class="muted past-line"></span>' +
          '</div>' +
          '<div class="gauge">' +
            '<div class="gauge-legend"><span>Took</span><span>Estimate</span></div>' +
            '<div class="gauge-tracks">' +
              '<div class="gauge-track" data-track="actual">' +
                '<div class="gauge-fill gauge-fill-actual"></div>' +
                '<span class="gauge-dots"></span>' +
                '<span class="gauge-pin gauge-pin-actual fig"></span>' +
                '<button type="button" class="gauge-handle" data-handle="actual" role="slider" ' +
                  'aria-label="Actual minutes" aria-valuemin="0" aria-valuemax="' + MAX_MINUTES + '">' +
                  '<span class="gauge-grip"></span></button>' +
              '</div>' +
              '<div class="gauge-track gauge-track-estimate" data-track="estimate">' +
                '<div class="gauge-fill gauge-fill-estimate"></div>' +
                '<span class="gauge-pin gauge-pin-estimate fig"></span>' +
                '<button type="button" class="gauge-handle" data-handle="estimate" role="slider" ' +
                  'aria-label="Estimated minutes" aria-valuemin="1" aria-valuemax="' + MAX_MINUTES +
                  '" hidden><span class="gauge-grip"></span></button>' +
              '</div>' +
              '<span class="gauge-suggestion" hidden></span>' +
            '</div>' +
          '</div>' +
          '<div class="gauge-axis"></div>' +
          '<div class="track-row">' +
            '<span class="track-cap track-cap-actual"></span>' +
            '<div class="track-controls">' +
              '<button type="button" class="pill omit-btn" aria-pressed="false">Don’t record</button>' +
              stepButton('data-step', -1, 'One minute less') +
              '<input class="f-actual input fig" type="number" min="0" max="' + MAX_MINUTES + '" ' +
                'inputmode="numeric" aria-label="Actual duration in minutes">' +
              stepButton('data-step', 1, 'One minute more') +
            '</div>' +
          '</div>' +
          '<div class="track-row">' +
            '<span class="track-cap track-cap-estimate"></span>' +
            '<div class="track-controls">' +
              '<button type="button" class="btn btn-ghost reset-estimate" hidden></button>' +
              '<button type="button" class="btn btn-ghost toggle-estimate">Edit estimate</button>' +
              stepButton('data-estimate-step', -1, 'Estimate one minute less') +
              '<input class="f-estimate input fig" type="number" min="1" max="' + MAX_MINUTES + '" ' +
                'inputmode="numeric" aria-label="Estimate in minutes">' +
              stepButton('data-estimate-step', 1, 'Estimate one minute more') +
              '<button type="button" class="pill suggestion-chip" aria-pressed="false"></button>' +
            '</div>' +
          '</div>' +
          '<p class="muted measured-line"></p>' +
        '</div>' +
        '<div class="field-group">' +
          '<span class="eyebrow eyebrow-quiet">Notes</span>' +
          '<textarea class="f-notes input" rows="2" placeholder="Anything worth remembering"></textarea>' +
        '</div>' +
      '</div>') +
    '</div>'
  )
}

function paintGauge (card, row, span) {
  const actualPercent = gaugePercent(row.actual, span)
  const estimatePercent = gaugePercent(row.estimate, span)

  const fillActual = card.querySelector('.gauge-fill-actual')
  fillActual.style.width = actualPercent + '%'
  fillActual.classList.toggle('is-omitted', row.omitted)

  card.querySelector('.gauge-fill-estimate').style.width = estimatePercent + '%'
  card.querySelector('.gauge-track-estimate').classList.toggle('is-editing', row.editingEstimate)

  card.querySelector('.gauge-dots').innerHTML = row.past.map(value =>
    '<span class="gauge-dot" style="left:' + gaugePercent(value, span) + '%" title="' +
      escapeHtml(formatDuration(value) + ' last time') + '"></span>').join('')

  const paintPin = (selector, value, text) => {
    const pin = card.querySelector(selector)
    pin.style.left = gaugePercent(value, span) + '%'
    pin.dataset.place = pinPlacement(value, span)
    pin.textContent = text
  }
  paintPin('.gauge-pin-actual', row.actual, row.omitted ? '—' : String(row.actual))
  paintPin('.gauge-pin-estimate', row.estimate, String(row.estimate ?? ''))

  const paintHandle = (selector, value, min) => {
    const handle = card.querySelector(selector)
    handle.style.left = gaugePercent(value, span) + '%'
    handle.style.marginLeft = handleOffset(value, span) + 'px'
    handle.setAttribute('aria-valuenow', String(value ?? min))
    handle.setAttribute('aria-valuetext', formatDuration(value))
  }
  paintHandle('[data-handle="actual"]', row.actual, 0)
  paintHandle('[data-handle="estimate"]', row.estimate, 1)
  card.querySelector('[data-handle="estimate"]').hidden = !row.editingEstimate

  const marker = card.querySelector('.gauge-suggestion')
  marker.hidden = row.suggestion === null
  if (row.suggestion !== null) {
    marker.style.left = gaugePercent(row.suggestion, span) + '%'
    marker.classList.toggle('is-taken', row.estimate === row.suggestion)
    marker.title = 'Suggested ' + formatDuration(row.suggestion)
  }

  const flag = row.suggestion === null
    ? ''
    : '<span class="gauge-flag' + (row.estimate === row.suggestion ? ' is-taken' : '') +
        '" style="left:' + gaugePercent(row.suggestion, span) + '%">' +
        '<span class="gauge-flag-mark"></span><span class="gauge-flag-text">' +
        escapeHtml(suggestionFlagText(row.estimate, row.suggestion)) + '</span></span>'
  card.querySelector('.gauge-axis').innerHTML = flag + gaugeTicks(span).map(tick =>
    '<span class="gauge-tick" style="left:' + tick.percent + '%">' +
      '<span class="gauge-tick-mark"></span>' +
      '<span class="gauge-tick-label fig">' + escapeHtml(tick.label) + '</span></span>').join('')
}

export function paintCard (card, row) {
  if (!card) return
  const open = openRowId === row.id
  card.dataset.open = String(open)
  const head = card.querySelector('.receipt-card-head')
  head.setAttribute('aria-expanded', String(open))
  card.querySelector('.receipt-card-line').textContent =
    rowTimeLabel({ outcome: row.outcome, actual: row.actual, omitted: row.omitted })

  const chip = card.querySelector('.drift-chip')
  const driftLabel = row.omitted || row.outcome === 'cancelled'
    ? ''
    : driftChipLabel(row.actual, row.estimate)
  chip.hidden = !driftLabel
  if (driftLabel) {
    const span = rowSpan(row)
    chip.querySelector('.drift-chip-label').textContent = driftLabel
    chip.querySelector('.drift-mini-actual').style.width = gaugePercent(row.actual, span) + '%'
    chip.querySelector('.drift-mini-estimate').style.width = gaugePercent(row.estimate, span) + '%'
  }

  const body = card.querySelector('.receipt-card-body')
  if (!body) return
  body.hidden = !open
  if (!open) return

  const span = rowSpan(row)
  paintGauge(card, row, span)

  card.querySelector('.past-line').textContent = pastActualsLine(row.past)
  card.querySelector('.track-cap-actual').textContent = actualCaption(row.actual, row.omitted)
  card.querySelector('.track-cap-estimate').textContent = estimateCaption(row.estimate)

  const omit = card.querySelector('.omit-btn')
  omit.setAttribute('aria-pressed', String(row.omitted))
  for (const control of card.querySelectorAll('[data-step], .f-actual')) control.hidden = row.omitted
  const actualField = card.querySelector('.f-actual')
  if (document.activeElement !== actualField) actualField.value = row.omitted ? '' : String(row.actual)

  const reset = card.querySelector('.reset-estimate')
  reset.hidden = row.estimate === row.baseEstimate || row.baseEstimate === null
  if (!reset.hidden) reset.textContent = resetEstimateLabel(row.baseEstimate)
  card.querySelector('.toggle-estimate').textContent = row.editingEstimate ? 'Done' : 'Edit estimate'
  for (const control of card.querySelectorAll('[data-estimate-step], .f-estimate')) {
    control.hidden = !row.editingEstimate
  }
  const estimateField = card.querySelector('.f-estimate')
  if (document.activeElement !== estimateField) estimateField.value = String(row.estimate ?? '')

  const suggestion = card.querySelector('.suggestion-chip')
  suggestion.hidden = row.suggestion === null || !row.editingEstimate
  if (!suggestion.hidden) {
    suggestion.textContent = suggestionChipLabel(row.estimate, row.suggestion)
    suggestion.setAttribute('aria-pressed', String(row.estimate === row.suggestion))
  }

  card.querySelector('.measured-line').textContent =
    measuredNote({ actual: row.actual, measured: row.measured, omitted: row.omitted }) +
    ' · the estimate is what future sessions plan with.'

  const notes = card.querySelector('.f-notes')
  if (document.activeElement !== notes) notes.value = row.notes
}

// The receipt is driven from a plain document in tests, so every DOM reach is
// allowed to come back empty rather than assumed.
function cardFor (id) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null
  const escape = globalThis.CSS?.escape || (value => value.replace(/"/g, '\\"'))
  return document.querySelector('.receipt-card[data-id="' + escape(id) + '"]')
}

function allCards () {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return []
  return [...document.querySelectorAll('.receipt-card')]
}

function repaint (row) {
  const card = cardFor(row.id)
  if (card) paintCard(card, row)
  renderHeader()
  renderOffers()
}

function renderHeader () {
  if (typeof document === 'undefined') return
  const endedAt = rows.reduce((latest, row) => Math.max(latest, Number(row.endTime) || 0), 0)
  const accepted = acceptedEstimateCount(rows)
  const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text }
  set('receiptEyebrow', receiptDateLine(endedAt))
  set('receiptHeadline', receiptHeadline(rows.map(row =>
    ({ outcome: row.outcome, actualDuration: row.actual, timeOmitted: row.omitted }))))
  set('receiptSubline', receiptSubline())
  set('receiptOffersLine', receiptOffersLine(offeredRows(rows).length))

  const finish = document.getElementById('finishReviewBtn')
  const filedLine = document.getElementById('receiptFiledLine')
  const reopen = document.getElementById('reopenReviewBtn')
  if (finish) { finish.textContent = receiptSaveLabel(accepted); finish.hidden = filed }
  if (filedLine) filedLine.hidden = !filed
  if (reopen) reopen.hidden = !filed
}

export function durationOfferHtml (row) {
  return '<section class="duration-offer" data-task-id="' + escapeHtml(row.taskId) + '">' +
    '<div class="task-name">' + formatFactHtml(row.taskName) + '</div>' +
    '<p class="task-meta">' + formatFactHtml(
      offerLine({ estimate: row.estimate, base: row.baseEstimate, suggestion: row.suggestion })) +
      '</p>' +
    '<button type="button" class="pill suggestion-chip" data-row-id="' + escapeHtml(row.id) +
      '" aria-pressed="' + (row.estimate === row.suggestion) + '">' +
      escapeHtml(suggestionChipLabel(row.estimate, row.suggestion)) + '</button>' +
  '</section>'
}

function renderOffers () {
  if (typeof document === 'undefined') return
  const container = document.getElementById('durationOffers')
  if (!container) return
  container.innerHTML = offeredRows(rows).map(durationOfferHtml).join('')
}

function renderList () {
  const container = document.getElementById('reviewList')
  renderHeader()
  renderOffers()
  if (!rows.length) {
    container.innerHTML = '<p class="empty">No chores were resolved this session.</p>'
    return
  }
  container.innerHTML = rows.map(reviewCardHtml).join('')
  for (const row of rows) paintCard(cardFor(row.id), row)
  for (const card of allCards()) wireCard(card)
}

/* ── Editing ──────────────────────────────────────────────────────────────── */

const clampActual = value => Math.max(0, Math.min(MAX_MINUTES, Math.round(value)))
const clampEstimate = value => Math.max(1, Math.min(MAX_MINUTES, Math.round(value)))

function setActual (row, value) {
  row.actual = clampActual(value)
  row.omitted = false
  row.corrected = row.actual !== row.measured
  repaint(row)
}

function setEstimate (row, value) {
  row.estimate = clampEstimate(value)
  repaint(row)
}

function startDrag (row, field, event) {
  const track = event.target.closest('[data-track]')
  if (!track) return
  drag = { id: row.id, field, span: rowSpan(row), track }
  const move = pointer => {
    if (!drag) return
    const box = drag.track.getBoundingClientRect()
    const value = ((pointer.clientX - box.left) / box.width) * drag.span
    if (drag.field === 'actual') setActual(row, value)
    else setEstimate(row, value)
  }
  const up = () => {
    drag = null
    repaint(row)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  move(event)
}

const ARROW_STEPS = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }

function wireCard (card) {
  const id = card.dataset.id
  const rowFor = () => rows.find(row => row.id === id)

  card.querySelector('.receipt-card-head').addEventListener('click', () => {
    openRowId = openRowId === id ? null : id
    for (const other of rows) paintCard(cardFor(other.id), other)
  })

  const body = card.querySelector('.receipt-card-body')
  if (!body) return

  for (const track of card.querySelectorAll('[data-track]')) {
    track.addEventListener('pointerdown', event => {
      const row = rowFor()
      if (track.dataset.track === 'estimate' && !row.editingEstimate) return
      event.preventDefault()
      startDrag(row, track.dataset.track, event)
    })
  }

  for (const handle of card.querySelectorAll('.gauge-handle')) {
    handle.addEventListener('keydown', event => {
      const step = ARROW_STEPS[event.key]
      if (!step) return
      event.preventDefault()
      const row = rowFor()
      if (handle.dataset.handle === 'actual') setActual(row, (row.actual || 0) + step)
      else setEstimate(row, (row.estimate || 1) + step)
      cardFor(id).querySelector('[data-handle="' + handle.dataset.handle + '"]').focus()
    })
  }

  body.addEventListener('click', event => {
    const row = rowFor()
    const step = event.target.closest('[data-step]')
    if (step) return setActual(row, (row.actual || 0) + Number(step.dataset.step))

    const estimateStep = event.target.closest('[data-estimate-step]')
    if (estimateStep) return setEstimate(row, (row.estimate || 1) + Number(estimateStep.dataset.estimateStep))

    if (event.target.closest('.omit-btn')) {
      row.omitted = !row.omitted
      if (!row.omitted && !row.actual) row.actual = row.measured || 0
      return repaint(row)
    }
    if (event.target.closest('.toggle-estimate')) {
      row.editingEstimate = !row.editingEstimate
      return repaint(row)
    }
    if (event.target.closest('.reset-estimate')) {
      row.estimate = row.baseEstimate
      return repaint(row)
    }
    if (event.target.closest('.suggestion-chip')) return toggleSuggestion(row)
  })

  card.querySelector('.f-actual').addEventListener('change', event => {
    const value = Number(event.target.value)
    if (!Number.isFinite(value)) return paintCard(card, rowFor())
    setActual(rowFor(), value)
  })
  card.querySelector('.f-estimate').addEventListener('change', event => {
    const value = Number(event.target.value)
    if (!Number.isFinite(value) || value < 1) return paintCard(card, rowFor())
    setEstimate(rowFor(), value)
  })
  card.querySelector('.f-notes').addEventListener('change', event => {
    rowFor().notes = event.target.value
  })
}

// One control, both ways: pressing it again puts the estimate back where the
// user found it, so taking a suggestion is never a one-way door.
export function toggleSuggestion (row) {
  row.estimate = row.estimate === row.suggestion ? row.baseEstimate : row.suggestion
  row.editingEstimate = true
  repaint(row)
}

/* ── Loading ──────────────────────────────────────────────────────────────── */

export function initReviewView () {
  document.getElementById('finishReviewBtn').addEventListener('click', handleFinish)
  document.getElementById('reopenReviewBtn').addEventListener('click', () => {
    filed = false
    renderHeader()
  })
  document.getElementById('durationOffers').addEventListener('click', event => {
    const chip = event.target.closest('.suggestion-chip')
    if (!chip) return
    const row = rows.find(item => item.id === chip.dataset.rowId)
    if (row) toggleSuggestion(row)
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
  rows = []
  openRowId = null
  filed = false
  const list = document.getElementById('reviewList')
  const finish = document.getElementById('finishReviewBtn')
  finish.disabled = true
  list.replaceChildren()
  renderOffers()
  const loading = document.createElement('p')
  loading.className = 'inline-status'
  loading.textContent = 'Loading receipt…'
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
    rows = executions.map(execution =>
      Object.assign(buildRow(execution, taskById.get(execution.taskId)),
        { endTime: Number(execution.endTime) || 0 }))
    readyReviewSessionId = sessionId
    renderList()
    finish.disabled = false
    setTimeout(() => loadHistoryForRows(generation, sessionId), 0)
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

export function renderReviewLoadError (message, retry = null) {
  reviewLoadGeneration++
  readyReviewSessionId = null
  rows = []
  renderOffers()
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

// The dots and the suggestion arrive after the cards are on screen, so each card
// is repainted in place rather than rebuilt under a user already correcting it.
async function loadHistoryForRows (generation, sessionId) {
  if (!reviewLoadIsCurrent(generation, sessionId)) return false
  try {
    const loaded = await loadRowHistory({
      rows,
      isCurrent: () => reviewLoadIsCurrent(generation, sessionId)
    })
    if (!loaded || !reviewLoadIsCurrent(generation, sessionId)) return false
    for (const row of rows) {
      const card = cardFor(row.id)
      if (card) paintCard(card, row)
    }
    renderHeader()
    renderOffers()
    return true
  } catch {
    return false
  }
}

/* ── Saving ───────────────────────────────────────────────────────────────── */

export async function saveExecutionReviews (list, saveExecution = updateExecution) {
  for (const row of list) {
    const fields = {
      actualDuration: row.omitted ? null : row.actual,
      timeOmitted: row.omitted,
      notes: row.notes
    }
    if (row.corrected && !row.omitted) {
      fields.rawDurationMs = Number(row.actual) * 60000
      fields.actualSeconds = Number(row.actual) * 60
    }
    await saveExecution(row.id, fields)
  }
}

export async function applyEstimateChanges (list, saveTask = updateTask) {
  for (const row of list) {
    if (row.estimate !== row.baseEstimate) {
      await saveTask(row.taskId, { estimatedDuration: row.estimate })
    }
  }
}

// Filing does not sweep the receipt away: the user stays where they are, told
// what happened, with the way back into it left open.
async function handleFinish () {
  const accepted = acceptedEstimateCount(rows)
  await saveExecutionReviews(rows)
  await applyEstimateChanges(rows)
  for (const row of rows) row.baseEstimate = row.estimate
  await refreshTasksView()
  filed = true
  const filedLine = document.getElementById('receiptFiledLine')
  if (filedLine) filedLine.textContent = filedMessage(accepted) + '.'
  setNavVisible('review', false)
  renderHeader()
}
