// ABOUTME: Builds the chore edit modal's body and reads the edited values back.
// ABOUTME: Unlike the old inline row, nothing here is written until Save is pressed.

import { buildTaskEditorModel } from '../categoryLocationLogic.js'
import { escapeAttribute, escapeHtml } from '../helpers.js'
import { buildScheduleEditorModel, scheduleEditorHtml, readScheduleEditor } from '../scheduleEditor.js'
import { categoryPillsHtml, estimateStepperHtml, locationPillsHtml } from './fieldPills.js'
import { doneLabel } from './ledgerLogic.js'

// Recording a completion is not an edit — it is the other thing you open a
// chore to do — so it rides in the sheet's title row rather than at the head of
// the fields. It still asks a second time in its own label, being awkward to
// take back.
export function choreDoneButtonHtml (confirming = false) {
  return '<button type="button" class="btn done-btn" aria-pressed="' +
    (confirming ? 'true' : 'false') + '">' + doneLabel(confirming) + '</button>'
}

// Putting the chore in a session is the other thing you open a chore to do, so
// it stands beside marking it done. It is the quieter of the two: filing a
// completion is a write, this is a plan. No label means the chore has nowhere to
// go — a session already has it — and then there is no control rather than one
// that could only refuse.
export function choreSessionButtonHtml (label) {
  if (!label) return ''
  return '<button type="button" class="btn btn-quiet session-btn">' +
    escapeHtml(String(label)) + '</button>'
}

export function editModalHtml (task, snapshot, state = {}) {
  const model = buildTaskEditorModel(task, snapshot)
  const selectedLocationIds = new Set(model.locationIds)

  return '<div class="edit-modal" data-id="' + escapeAttribute(task?._id ?? '') + '">' +
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
    // Archiving is not an edit, is rarely what you came for, and a misfired one
    // takes a chore off the list. It waits at the far end as a quiet aside —
    // never as a third answer standing in the path of Cancel and Save.
    '<div class="edit-archive">' +
      '<button type="button" class="btn btn-text archive-btn">Archive this chore</button>' +
    '</div>' +
  '</div>'
}

// Nothing here refuses a save, and that is load-bearing: the sheet has already
// closed by the time this runs, so a refusal would throw away every other edit
// with no way back to them. An emptied name reads as the name the chore already
// had, and a schedule that cannot be read reads as the schedule it already had
// — the same reading the cadence field gets. Everything else may genuinely be
// left blank: no estimate, no category, no day.
export function readEditModal (root, previous = {}) {
  const typed = String(root.querySelector('.edit-name')?.value ?? '').trim()
  const name = typed || String(previous?.name ?? '').trim()

  const edited = readScheduleEditor(root)
  const schedule = edited.ok
    ? edited
    : { ok: true, schedule: previous?.schedule ?? null, scheduledDate: previous?.scheduledDate ?? null }

  return {
    ok: true,
    name,
    estimatedDuration: Number(root.querySelector('.est-input')?.value) || null,
    categoryId: root.querySelector('.f-category')?.value || null,
    locationIds: [...root.querySelectorAll('.f-location:checked')].map(input => input.value),
    schedule
  }
}
