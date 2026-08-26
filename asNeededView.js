// ABOUTME: Pure markup for the condition-gated As needed ledger and direct readiness actions.
// ABOUTME: Reuses neutral Chores row facts without attaching listeners or writing task data.

import { escapeAttribute, escapeHtml } from './helpers.js'
import { buildAsNeededGroups } from './asNeededLogic.js'
import { ledgerCategoryPillsHtml, rowSummaryHtml } from './chores/listView.js'
import { doneLabel } from './chores/ledgerLogic.js'

const selectedCategoryId = (categories, filter) =>
  (categories || []).find(category => category.name === filter?.category)?._id || ''

export function asNeededCategoryPillsHtml (categories, state = {}) {
  return ledgerCategoryPillsHtml(categories, selectedCategoryId(categories, state.filter))
}

function dateContinuationHtml (task, action, value = '') {
  const id = String(task?._id || '')
  const inputId = 'as-needed-date-' + id

  return '<div class="as-needed-date-prompt">' +
    '<label for="' + escapeAttribute(inputId) + '">Choose a new check date for ' +
      escapeHtml(String(task?.name ?? '')) +
      '<input id="' + escapeAttribute(inputId) + '" type="date" class="as-needed-date" data-id="' +
      escapeAttribute(id) + '" data-action="' + escapeAttribute(action) + '" value="' +
      escapeAttribute(value) + '"></label>' +
    '<button type="button" class="as-needed-date-save" data-id="' +
      escapeAttribute(id) + '" data-action="' + escapeAttribute(action) + '">Save date</button>' +
    '<button type="button" class="as-needed-date-cancel" data-id="' +
      escapeAttribute(id) + '">Cancel</button>' +
  '</div>'
}

function actionHtml (task, state) {
  const id = String(task?._id || '')
  if (task?.readiness === 'ready') {
    const confirming = state.confirmingDoneId === task._id
    const prompt = state.datePrompt?.taskId === task._id &&
      state.datePrompt?.action === 'not-ready' && task?.schedule?.type === 'one_off'
      ? dateContinuationHtml(task, 'not-ready', state.datePrompt?.value)
      : ''
    return '<div class="as-needed-actions">' +
      '<button type="button" class="as-needed-not-ready" data-id="' +
        escapeAttribute(id) + '">Not ready</button>' +
      '<button type="button" class="as-needed-done" data-id="' +
        escapeAttribute(id) + '" aria-pressed="' + (confirming ? 'true' : 'false') + '">' +
        doneLabel(confirming) + '</button>' +
      prompt +
    '</div>'
  }

  const prompt = state.datePrompt?.taskId === task._id &&
    state.datePrompt?.action === 'later' && task?.schedule?.type === 'one_off'
    ? dateContinuationHtml(task, 'later', state.datePrompt?.value)
    : ''
  return '<div class="as-needed-actions">' +
    '<button type="button" class="as-needed-ready" data-id="' +
      escapeAttribute(id) + '">Mark ready</button>' +
    '<button type="button" class="as-needed-later" data-id="' +
      escapeAttribute(id) + '">Check again later</button>' +
    prompt +
  '</div>'
}

function rowHtml (task, snapshot, today, state, group) {
  return '<li class="task-card ledger-row as-needed-row" data-id="' +
    escapeAttribute(task?._id || '') + '">' +
    '<button type="button" class="as-needed-edit" aria-haspopup="dialog">' +
      rowSummaryHtml(task, snapshot, today, { band: group.label }) +
    '</button>' +
    actionHtml(task, state) +
  '</li>'
}

export function asNeededScreenHtml (tasks, snapshot, today, state = {}) {
  const groups = buildAsNeededGroups(
    tasks, today, state.filter || {}, snapshot?.categories || []
  )
  if (!groups.length) {
    return '<div class="card ledger-empty"><p class="display ledger-empty-title">Nothing to check</p>' +
      '<p class="muted">' + ((tasks || []).length
        ? 'No as-needed chore matches this filter.'
        : 'No as-needed chores yet.') + '</p></div>'
  }

  return groups.map(group =>
    '<section class="ledger-group as-needed-group" aria-labelledby="as-needed-' + group.key + '">' +
      '<h3 id="as-needed-' + group.key + '" class="ledger-eyebrow"><span>' +
        escapeHtml(group.label) + '</span><span class="ledger-count fig">' + group.count + '</span></h3>' +
      '<ul class="ledger">' +
        group.tasks.map(task => rowHtml(task, snapshot, today, state, group)).join('') +
      '</ul>' +
    '</section>'
  ).join('')
}
