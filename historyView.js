// ABOUTME: Drives the Log screen — loads the record, filters it by range and opens one session at a time.
// ABOUTME: Holds no view markup of its own; log/logScreen.js renders, log/logLogic.js decides what is said.

import { listAllSessions } from './sessionData.js'
import { listAllExecutions } from './executionData.js'
import { listAllTasks } from './taskData.js'
import { buildHistory } from './historyLogic.js'
import { escapeHtml } from './helpers.js'
import { activeBars, logHeadline, sessionsInRange } from './log/logLogic.js'
import { logChartHtml, logRangesHtml, logSessionsHtml } from './log/logScreen.js'

const state = { range: '7', openId: null, history: [] }

export function initHistoryView () {
  const ranges = document.getElementById('logRanges')
  const list = document.getElementById('historyList')
  if (ranges) ranges.addEventListener('click', handleRangeClick)
  if (list) list.addEventListener('click', handleCardClick)
}

export async function refreshHistoryView () {
  const list = document.getElementById('historyList')
  if (!list) return
  list.innerHTML = '<div class="freezr-spinner"></div>'
  try {
    const [sessions, executions, tasks] = await Promise.all([
      listAllSessions(),
      listAllExecutions(),
      listAllTasks()
    ])
    state.history = buildHistory(sessions, executions, tasks)
    render()
  } catch (err) {
    list.innerHTML = '<p class="empty">Could not load the log: ' +
      escapeHtml(err.message || String(err)) + '</p>'
  }
}

function render () {
  const now = Date.now()
  const shown = sessionsInRange(state.history, state.range, now)

  const headline = document.getElementById('logHeadline')
  if (headline) headline.textContent = logHeadline(shown)

  const ranges = document.getElementById('logRanges')
  if (ranges) ranges.innerHTML = logRangesHtml(state.range)

  const chart = document.getElementById('logChart')
  if (chart) chart.innerHTML = logChartHtml(activeBars(shown, now))

  const list = document.getElementById('historyList')
  if (list) list.innerHTML = logSessionsHtml(shown, { openId: state.openId, now })
}

function handleRangeClick (event) {
  const option = event.target.closest('[data-log-range]')
  if (!option) return
  state.range = option.dataset.logRange
  render()
}

// One session open at a time: the point of opening one is to read it.
function handleCardClick (event) {
  const head = event.target.closest('.log-card-head')
  if (!head) return
  const id = head.closest('.log-card')?.dataset.id
  state.openId = state.openId === id ? null : id
  render()
}
