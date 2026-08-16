// ABOUTME: The estimate, category and location field controls shared by the Inbox card and the chore editor.
// ABOUTME: Pills are what you touch; the hidden field and the checkboxes stay the values the app reads.

import { escapeAttribute, escapeHtml } from '../helpers.js'

export const ESTIMATE_PRESETS = [5, 10, 15, 20, 30, 45, 60]

// A typed number and a row of common ones. Neither is a limit: the presets are
// the estimates that come up, not the estimates allowed.
export const estimateStepperHtml = task => {
  const minutes = Number(task?.estimatedDuration) || ''
  return '<div class="field-group"><span class="eyebrow eyebrow-quiet">Estimate</span>' +
    '<div class="estimate-stepper">' +
      '<button type="button" class="pill-icon est-minus" aria-label="Less time">−</button>' +
      '<input class="input fig est-input" type="number" name="estimatedDuration" min="1" step="1" ' +
        'inputmode="numeric" aria-label="Estimate in minutes" value="' +
        escapeAttribute(minutes) + '">' +
      '<span class="est-unit muted">min</span>' +
      '<button type="button" class="pill-icon est-plus" aria-label="More time">+</button>' +
    '</div>' +
    '<div class="pill-set" role="group" aria-label="Common estimates">' +
      ESTIMATE_PRESETS.map(preset =>
        '<button type="button" class="pill pill-compact" data-estimate="' + preset +
          '" aria-pressed="' + (minutes === preset ? 'true' : 'false') + '">' +
          preset + ' min</button>').join('') +
    '</div></div>'
}

export function referenceStateSuffix (reference) {
  if (reference.status === 'archived') return ' (Archived)'
  if (reference.unresolved) return ' (Unavailable)'
  return ''
}

// Category is a pill group over a hidden input: the pills are what you touch,
// the input stays the single value everything else already reads.
export const categoryPillsHtml = model =>
  '<input type="hidden" class="f-category" name="categoryId" value="' +
    escapeAttribute(model.categoryId || '') + '">' +
  '<div class="pill-set" role="group" aria-label="Category">' +
  model.categoryOptions.map(category =>
    '<button type="button" class="pill pill-compact" data-field="category" data-value="' +
      escapeAttribute(category._id) + '" aria-pressed="' +
      (category._id === model.categoryId ? 'true' : 'false') + '">' +
      escapeHtml(String(category.name)) + referenceStateSuffix(category) + '</button>'
  ).join('') + '</div>'

export const locationPillsHtml = (model, selectedLocationIds) => model.locationOptions.length
  ? model.locationOptions.map(location =>
      '<label class="pill pill-compact pill-check"><input class="f-location" name="locationIds" ' +
        'type="checkbox" value="' + escapeAttribute(location._id) + '"' +
        (selectedLocationIds.has(location._id) ? ' checked' : '') + '><span>' +
        escapeHtml(String(location.name)) + referenceStateSuffix(location) + '</span></label>'
    ).join('')
  : '<span class="empty">No locations available.</span>'
