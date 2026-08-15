// ABOUTME: The category and location pill groups shared by the Inbox card and the Chores ledger.
// ABOUTME: Pills are what you touch; the hidden field and the checkboxes stay the values the app reads.

import { escapeAttribute, escapeHtml } from '../helpers.js'

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
