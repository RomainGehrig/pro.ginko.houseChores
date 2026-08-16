// ABOUTME: Builds the chore edit modal's body and reads the edited values back.
// ABOUTME: Unlike the old inline row, nothing here is written until Save is pressed.

import { buildTaskEditorModel } from '../categoryLocationLogic.js'
import { escapeAttribute, escapeHtml } from '../helpers.js'
import { buildScheduleEditorModel, scheduleEditorHtml, readScheduleEditor } from '../scheduleEditor.js'
import { categoryPillsHtml, estimateStepperHtml, locationPillsHtml } from './fieldPills.js'
import { doneLabel } from './ledgerLogic.js'

export function editModalHtml (task, snapshot, state = {}) {
  const model = buildTaskEditorModel(task, snapshot)
  const selectedLocationIds = new Set(model.locationIds)
  const confirmDone = Boolean(state.confirmDone)

  return '<div class="edit-modal" data-id="' + escapeAttribute(task?._id ?? '') + '">' +
    // Recording a completion is what you most often open a chore to do, so it
    // leads — a button in its own right, not a scrap floating beside the title.
    // It still asks a second time in its own label, being awkward to take back.
    '<div class="edit-done">' +
      '<button type="button" class="btn done-btn" aria-pressed="' +
        (confirmDone ? 'true' : 'false') + '">' + doneLabel(confirmDone) + '</button>' +
    '</div>' +
    '<label class="field-group"><span class="eyebrow eyebrow-quiet">Name</span>' +
      '<input type="text" class="input edit-name" name="name" aria-label="Chore name" ' +
      'autocomplete="off" value="' +
      escapeAttribute(String(task?.name ?? '')) + '"></label>' +
    estimateStepperHtml(task) +
    '<div class="field-group"><span class="eyebrow eyebrow-quiet">Schedule</span>' +
      scheduleEditorHtml(buildScheduleEditorModel(task)) + '</div>' +
    '<div class="field-group"><span class="eyebrow eyebrow-quiet">Category</span>' +
      categoryPillsHtml(model) + '</div>' +
    '<div class="field-group"><span class="eyebrow eyebrow-quiet">Where</span>' +
      '<fieldset class="f-locations pill-set"><legend class="visually-hidden">Locations</legend>' +
      locationPillsHtml(model, selectedLocationIds) + '</fieldset></div>' +
    '<p class="task-card-error" role="alert">' + escapeHtml(state.error || '') + '</p>' +
    // Archiving is not an edit and is rarely what you came for, so it waits at
    // the end, past everything that is.
    '<div class="edit-archive">' +
      '<button type="button" class="btn btn-ghost archive-btn">Archive</button>' +
    '</div>' +
  '</div>'
}

// Nothing here refuses a save. An emptied name is someone part-way through
// retyping, so it reads as the name the chore already had — the same reading
// the cadence field gets, and one that cannot cost the edits made beside it.
// Everything else may genuinely be left blank: no estimate, no category, no day.
export function readEditModal (root, previousName = '') {
  const typed = String(root.querySelector('.edit-name')?.value ?? '').trim()
  const name = typed || String(previousName ?? '').trim()

  const schedule = readScheduleEditor(root)
  if (!schedule.ok) return { ok: false, message: schedule.message }

  return {
    ok: true,
    name,
    estimatedDuration: Number(root.querySelector('.est-input')?.value) || null,
    categoryId: root.querySelector('.f-category')?.value || null,
    locationIds: [...root.querySelectorAll('.f-location:checked')].map(input => input.value),
    schedule
  }
}
