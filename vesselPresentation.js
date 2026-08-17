// ABOUTME: Markup for the Today vessel — the budget as a shape, and the pool you fill it from.
// ABOUTME: Blocks are sized by estimate and coloured by ripeness; nothing here can refuse a pick.

import { escapeHtml, formatDuration, formatFactHtml } from './helpers.js'
import { ripeness, ripenessColor } from './ripenessLogic.js'
import { buildChoreNoteHtml, resolveTaskCategoryName } from './taskPresentationLogic.js'
import { scheduleSummary } from './scheduleLogic.js'

const minutesOf = task => Number(task?.estimatedDuration) || 0

// Each block grows in proportion to its estimate, so the column reads as the
// shape of the session rather than a list with numbers attached.
export function buildVesselFillHtml (bundle, today) {
  return (bundle || []).map(task => {
    const shade = ripenessColor(ripeness(task, today))
    return '<button type="button" class="vessel-block" data-remove-id="' +
      escapeHtml(task._id) + '" style="flex:' + minutesOf(task) + ';background:' + shade + '"' +
      ' aria-label="Take ' + escapeHtml(String(task?.name ?? '')) + ' out of the session">' +
      '<span class="vessel-block-minutes">' +
      formatFactHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
      '<span class="vessel-block-name">' + escapeHtml(String(task?.name ?? '')) + '</span>' +
      '</button>'
  }).join('')
}

export function buildVesselListHtml (bundle, today) {
  return (bundle || []).map(task =>
    '<li class="vessel-entry rise">' +
    '<button type="button" class="vessel-entry-btn" data-remove-id="' + escapeHtml(task._id) + '">' +
    '<span class="vessel-entry-name display">' + escapeHtml(String(task?.name ?? '')) + '</span>' +
    '<span class="vessel-entry-note muted">' + buildChoreNoteHtml(task, today) + '</span>' +
    '</button></li>'
  ).join('')
}

// Two controls in one pill: the body picks the chore, the trailing button opens
// its detail. The design reaches detail by holding the chip, which pointer users
// still can — this keeps the same detail one Tab away for everyone else.
export function buildPoolChipsHtml (tasks, pickedIds, today) {
  const picked = new Set(pickedIds || [])
  return (tasks || []).map(task => {
    const isPicked = picked.has(task._id)
    const name = escapeHtml(String(task?.name ?? ''))
    return '<span class="pool-chip-wrap' + (isPicked ? ' is-on' : '') + '">' +
      '<button type="button" class="pool-chip" data-pick-id="' + escapeHtml(task._id) +
      '" aria-pressed="' + (isPicked ? 'true' : 'false') + '">' +
      '<span class="pool-chip-dot" style="background:' +
      ripenessColor(ripeness(task, today)) + '" aria-hidden="true"></span>' +
      '<span class="pool-chip-name">' + name + '</span>' +
      '<span class="pool-chip-minutes">' +
      formatFactHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
      '</button>' +
      '<button type="button" class="pool-chip-info" data-detail-id="' + escapeHtml(task._id) +
      '" aria-label="Details for ' + name + '">&hellip;</button>' +
      '</span>'
  }).join('')
}

export function buildCategoryTabsHtml (categories, selectedId) {
  const tabs = [{ _id: '', name: 'All' }].concat(categories || [])
  return tabs.map(category => {
    const isOn = (category._id || '') === (selectedId || '')
    return '<button type="button" class="cat-tab" data-category-id="' + escapeHtml(category._id) +
      '" aria-pressed="' + (isOn ? 'true' : 'false') + '">' +
      escapeHtml(String(category.name ?? '')) + '</button>'
  }).join('')
}

export function buildPoolEmptyHtml (categoryName) {
  const where = categoryName ? ' in ' + escapeHtml(categoryName) : ''
  return '<p class="pool-empty muted">Nothing waiting' + where +
    '. Anything you write down in Capture turns up here once you confirm it.</p>'
}

// The facts a chore can offer about itself. No figure here exists to say how
// far behind you are — each one is here to help you decide.
export function buildChoreDetailHtml (task, categories, today) {
  const rows = [
    ['Schedule', scheduleSummary(task?.schedule) || 'No schedule yet'],
    ['Estimate', formatDuration(task?.estimatedDuration)],
    ['History', null]
  ]

  return '<span class="detail-tags">' +
    '<span class="tag tag-sage">' + escapeHtml(resolveTaskCategoryName(task, categories)) + '</span>' +
    '<span class="tag tag-outline">' + formatFactHtml(formatDuration(task?.estimatedDuration)) + '</span>' +
    '</span>' +
    '<span class="detail-facts">' +
    rows.map(([label, value]) => '<span class="detail-fact">' +
      '<span class="detail-fact-label">' + escapeHtml(label) + '</span>' +
      '<span class="detail-fact-value">' +
      (value === null ? buildChoreNoteHtml(task, today) : formatFactHtml(value)) +
      '</span></span>').join('') +
    '</span>'
}
