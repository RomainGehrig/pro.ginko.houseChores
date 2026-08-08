// ABOUTME: Renders the read-only session history accordion and wires
// ABOUTME: expand/collapse for each past session row.

import { listAllSessions } from './sessionData.js'
import { listAllExecutions } from './executionData.js'
import { listAllTasks } from './taskData.js'
import { buildHistory, describeOutcomes } from './historyLogic.js'
import { formatDateTime, formatDuration, escapeHtml } from './helpers.js'

const OUTCOME_TEXT = { done: 'done', already_done: 'already done', cancelled: 'cancelled' }

export function initHistoryView() {
  // content is rendered on demand by refreshHistoryView
}

export async function refreshHistoryView() {
  const container = document.getElementById('historyList')
  container.innerHTML = '<div class="freezr-spinner"></div>'
  try {
    const [sessions, executions, tasks] = await Promise.all([
      listAllSessions(),
      listAllExecutions(),
      listAllTasks()
    ])
    render(buildHistory(sessions, executions, tasks), container)
  } catch (err) {
    container.innerHTML = '<p class="empty">Could not load history: ' + escapeHtml(err.message || String(err)) + '</p>'
  }
}

function render(history, container) {
  if (!history.length) {
    container.innerHTML = '<p class="empty">No sessions yet.</p>'
    return
  }
  container.innerHTML = history.map(rowHtml).join('')
  container.querySelectorAll('.history-head').forEach(head => {
    head.addEventListener('click', () => {
      const row = head.closest('.history-row')
      const expanded = row.classList.toggle('expanded')
      head.querySelector('.history-caret').textContent = expanded ? '▾' : '▸'
    })
  })
}

function rowHtml(session) {
  const budget = formatDuration(session.timeBudgetMinutes)
  const filter = session.categoryFilter || 'All'
  const summary = session.taskCount
    ? session.taskCount + (session.taskCount === 1 ? ' task' : ' tasks') +
      ' · ' + describeOutcomes(session.outcomeCounts) +
      ' · ' + formatDuration(session.totalActualMinutes)
    : 'no tasks recorded'

  return (
    '<div class="history-row">' +
      '<div class="history-head">' +
        '<div class="history-title">' +
          '<span class="history-caret">▸</span>' +
          '<span class="history-when">' + escapeHtml(formatDateTime(session.startTime)) + '</span>' +
          '<span class="task-meta">' + escapeHtml(budget + ' · ' + filter) + '</span>' +
          (session.statusLabel !== null
            ? '<span class="history-tag">' + escapeHtml(session.statusLabel) + '</span>'
            : '') +
        '</div>' +
        '<div class="task-meta history-summary">' + escapeHtml(summary) + '</div>' +
      '</div>' +
      '<div class="history-detail">' + session.entries.map(entryHtml).join('') + '</div>' +
    '</div>'
  )
}

function entryHtml(entry) {
  const extras = []
  if (entry.difficultyRating) extras.push(stars(entry.difficultyRating))
  if (entry.notes) extras.push('“' + escapeHtml(entry.notes) + '”')

  return (
    '<div class="history-entry">' +
      '<div class="history-entry-line">' +
        '<span class="history-entry-name">' + escapeHtml(entry.taskName) + '</span>' +
        '<span class="history-entry-outcome">' + escapeHtml(OUTCOME_TEXT[entry.outcome] || entry.outcome) + '</span>' +
        '<span class="history-entry-time">' + escapeHtml(formatDuration(entry.actualDuration)) + '</span>' +
      '</div>' +
      (extras.length ? '<div class="task-meta">' + extras.join('&nbsp;&nbsp;') + '</div>' : '') +
    '</div>'
  )
}

function stars(rating) {
  const filled = Math.max(0, Math.min(5, rating))
  return '★'.repeat(filled) + '☆'.repeat(5 - filled)
}
