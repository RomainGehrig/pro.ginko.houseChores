// ABOUTME: Renders the Log — the range control, the active-time chart and the expandable session cards.
// ABOUTME: Every figure here is a measurement; none of them is a target, and none of them turns red.

import { escapeAttribute, escapeHtml, formatDateTime, formatFactHtml } from '../helpers.js'
import { difficultyLabel } from '../historyLogic.js'
import {
  budgetLine, driftFillPercent, driftLine, logRanges,
  relativeDay, sessionSummaryLine, tookLine
} from './logLogic.js'

export function logRangesHtml (activeKey) {
  return logRanges(activeKey).map(range =>
    '<button type="button" class="seg-opt" data-log-range="' + range.key +
      '" aria-pressed="' + (range.active ? 'true' : 'false') + '">' +
      formatFactHtml(range.label) + '</button>'
  ).join('')
}

// The chart scales to its own tallest bar and carries no baseline: there is
// nothing here to fall short of, only what each session actually ran.
export function logChartHtml (bars) {
  if (!bars.length) return '<p class="muted log-chart-empty">Nothing to chart yet.</p>'
  return bars.map(bar =>
    '<span class="log-bar-column" title="' + escapeAttribute(bar.title) + '">' +
      '<span class="log-bar" style="height: ' + bar.height + 'px;"></span>' +
      '<span class="log-bar-cap">' + escapeHtml(bar.label) + '</span>' +
    '</span>'
  ).join('')
}

function entryHtml (entry) {
  const drift = driftLine(entry)
  const aside = [
    entry.difficultyRating ? difficultyLabel(entry.difficultyRating) : '',
    entry.notes ? '“' + entry.notes + '”' : ''
  ].filter(Boolean).join(' · ')

  return '<li class="log-row">' +
    '<span class="log-row-main">' +
      '<span class="log-row-name">' + escapeHtml(String(entry.taskName ?? '')) + '</span>' +
      '<span class="log-row-fact">' + formatFactHtml(tookLine(entry)) +
        (drift ? ' · ' + formatFactHtml(drift) : '') + '</span>' +
      (aside ? '<span class="log-row-aside">' + formatFactHtml(aside) + '</span>' : '') +
    '</span>' +
    '<span class="log-row-bar" aria-hidden="true">' +
      '<span class="log-row-fill' + (drift ? '' : ' is-quiet') + '" style="width: ' +
        driftFillPercent(entry) + '%;"></span>' +
    '</span>' +
  '</li>'
}

export function logSessionCardHtml (session, { open = false, now = Date.now() } = {}) {
  return '<li class="card log-card" data-id="' + escapeAttribute(session.id) + '"' +
      (open ? ' data-open="true"' : '') + '>' +
    '<button type="button" class="log-card-head" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="log-card-lines">' +
        '<span class="display log-when">' + formatFactHtml(formatDateTime(session.startTime)) + '</span>' +
        '<span class="log-summary">' + formatFactHtml(sessionSummaryLine(session)) + '</span>' +
      '</span>' +
      (session.statusLabel
        ? '<span class="log-status">' + escapeHtml(session.statusLabel) + '</span>'
        : '') +
      '<span class="log-rel">' + escapeHtml(relativeDay(session.startTime, now)) + '</span>' +
    '</button>' +
    (open
      ? '<div class="log-card-body">' +
          '<ul class="log-rows">' + (session.entries || []).map(entryHtml).join('') + '</ul>' +
          '<p class="log-budget">' + formatFactHtml(budgetLine(session)) + '</p>' +
        '</div>'
      : '') +
  '</li>'
}

export function logSessionsHtml (sessions, { openId = null, now = Date.now() } = {}) {
  if (!sessions.length) {
    return '<div class="card ledger-empty"><p class="display ledger-empty-title">' +
      'No sessions in this stretch</p><p class="muted">Widen the range, or run a session — ' +
      'what it takes lands here on its own.</p></div>'
  }
  return '<ul class="log-cards">' + sessions.map(session =>
    logSessionCardHtml(session, { open: session.id === openId, now })).join('') + '</ul>'
}
