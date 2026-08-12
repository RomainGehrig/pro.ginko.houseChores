// ABOUTME: Renders and wires the user-managed category and location panel.
// ABOUTME: Keeps reference mutations behind the shared category-location store.

import { categoryLocationStore } from './categoryLocationStore.js'
import { escapeHtml } from './helpers.js'
import { pendingUndo } from './undoToast.js'

const referenceConfig = {
  category: {
    label: 'Category',
    inputId: 'newCategoryName',
    add: name => categoryLocationStore.addCategory(name),
    rename: (id, name) => categoryLocationStore.renameCategory(id, name),
    archive: id => categoryLocationStore.archiveCategory(id),
    restore: id => categoryLocationStore.restoreCategory(id)
  },
  location: {
    label: 'Location',
    inputId: 'newLocationName',
    add: name => categoryLocationStore.addLocation(name),
    rename: (id, name) => categoryLocationStore.renameLocation(id, name),
    archive: id => categoryLocationStore.archiveLocation(id),
    restore: id => categoryLocationStore.restoreLocation(id)
  }
}

let manager
let status
let editingReference = null

export function splitReferences (references = []) {
  return references.reduce((groups, reference) => {
    if (reference.status === 'archived') groups.archived.push(reference)
    else groups.active.push(reference)
    return groups
  }, { active: [], archived: [] })
}

export function referenceAvailability (snapshot, kind) {
  const key = kind === 'category' ? 'categories' : 'locations'
  const disabled = snapshot?.readiness?.[key] === false
  return {
    disabled,
    message: disabled ? String(snapshot?.errors?.[key] || '') : ''
  }
}

export function escapeAttribute (value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character])
}

export function initCategoryLocationView () {
  manager = document.getElementById('referenceManager')
  status = document.getElementById('referenceManagerStatus')

  manager.addEventListener('submit', handleSubmit)
  manager.addEventListener('click', handleClick)
  categoryLocationStore.subscribe(render)
  render(categoryLocationStore.getSnapshot())
}

function render (snapshot) {
  renderReferenceList('category', snapshot.categories)
  renderReferenceList('location', snapshot.locations)
  setReferenceCollectionDisabled('category', referenceAvailability(snapshot, 'category').disabled)
  setReferenceCollectionDisabled('location', referenceAvailability(snapshot, 'location').disabled)
  if (snapshot.error) {
    manager.open = true
    showStatus(snapshot.error, 'error')
  } else if (snapshot.warning) {
    manager.open = true
    showStatus(snapshot.warning, 'warning')
  }
}

function setReferenceCollectionDisabled (kind, disabled) {
  const config = referenceConfig[kind]
  const form = document.getElementById(kind === 'category' ? 'addCategoryForm' : 'addLocationForm')
  const list = document.getElementById(kind === 'category' ? 'categoryManagerList' : 'locationManagerList')
  const controls = [
    document.getElementById(config.inputId),
    ...(form ? form.querySelectorAll('button, input') : []),
    ...(list ? list.querySelectorAll('button, input') : [])
  ].filter(Boolean)
  controls.forEach(control => { control.disabled = disabled })
}

export function mutationFeedback (snapshot, successMessage) {
  if (snapshot?.error) return { message: snapshot.error, state: 'error' }
  if (snapshot?.warning) return { message: snapshot.warning, state: 'warning' }
  return { message: successMessage, state: 'success' }
}

export async function applyReferenceMutation (write, applyUiUpdate) {
  const snapshot = await write()
  applyUiUpdate()
  return snapshot
}

export async function archiveReferenceWithUndo ({
  kind,
  id,
  archive,
  restore,
  mutate = runMutation,
  queue = pendingUndo
}) {
  const label = kind === 'category' ? 'Category' : 'Location'
  const result = await mutate(
    archive,
    label + ' archived. Existing task assignments are retained.'
  )
  if (!result.ok) return result

  await queue({
    key: `reference:${kind}:${id}`,
    label: label + ' archived',
    commit: () => null,
    revert: async () => {
      const restored = await mutate(restore, label + ' restored.')
      return { kind, id, status: restored.ok ? 'active' : 'archived' }
    }
  }, 6000)
  return result
}

function renderReferenceList (kind, references) {
  const container = document.getElementById(kind === 'category' ? 'categoryManagerList' : 'locationManagerList')
  const groups = splitReferences(references)
  const { label } = referenceConfig[kind]
  const activeRows = groups.active.map(reference => referenceRowHtml(
    kind,
    reference,
    editingReference === kind + ':' + reference._id
  )).join('')
  const archivedRows = groups.archived.map(reference => referenceRowHtml(
    kind,
    reference,
    editingReference === kind + ':' + reference._id
  )).join('')
  const empty = groups.active.length ? '' : '<p class="empty">No active ' + label.toLowerCase() + 's.</p>'
  const archivedSection = groups.archived.length
    ? '<details class="reference-archived"><summary>Archived (' + groups.archived.length + ')</summary>' + archivedRows + '</details>'
    : ''

  container.innerHTML = activeRows + empty + archivedSection
}

export function referenceRowHtml (kind, reference, isEditing = false) {
  const id = escapeAttribute(reference._id)
  const name = escapeHtml(String(reference.name))
  const nameAttribute = escapeAttribute(reference.name)
  const archived = reference.status === 'archived'
  const rowClass = archived ? 'reference-row is-archived' : 'reference-row'
  const rowData = 'data-kind="' + kind + '" data-id="' + id + '"'

  if (isEditing) {
    return '<div class="reference-edit-row" ' + rowData + '>' +
      '<input class="reference-name-input" aria-label="Rename ' + kind + '" value="' + nameAttribute + '" autocomplete="off">' +
      '<button type="button" class="btn btn-sage" data-action="save">Save</button>' +
      '<button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>' +
    '</div>'
  }

  return '<div class="' + rowClass + '" ' + rowData + '>' +
    '<span>' + name + '</span>' +
    '<span class="reference-actions">' +
      '<button type="button" class="btn btn-ghost" data-action="rename">Rename</button>' +
      '<button type="button" class="btn btn-secondary" data-action="' +
        (archived ? 'restore' : 'archive') + '">' + (archived ? 'Restore' : 'Archive') + '</button>' +
    '</span>' +
  '</div>'
}

async function handleSubmit (event) {
  const form = event.target.closest('.reference-add-form')
  if (!form) return
  event.preventDefault()

  const kind = form.id === 'addCategoryForm' ? 'category' : 'location'
  const config = referenceConfig[kind]
  const input = document.getElementById(config.inputId)
  await runMutation(() => applyReferenceMutation(
    () => config.add(input.value),
    () => { input.value = '' }
  ), config.label + ' added.')
}

async function handleClick (event) {
  const actionButton = event.target.closest('[data-action]')
  if (!actionButton || !manager.contains(actionButton)) return

  const row = actionButton.closest('[data-kind][data-id]')
  if (!row) return
  const { kind, id } = row.dataset
  const config = referenceConfig[kind]
  const { action } = actionButton.dataset

  if (action === 'rename') {
    editingReference = kind + ':' + id
    render(categoryLocationStore.getSnapshot())
    manager.querySelector('.reference-name-input')?.focus()
    return
  }
  if (action === 'cancel') {
    editingReference = null
    render(categoryLocationStore.getSnapshot())
    return
  }
  if (action === 'save') {
    const input = row.querySelector('.reference-name-input')
    await runMutation(() => applyReferenceMutation(
      () => config.rename(id, input.value),
      () => {
        editingReference = null
        render(categoryLocationStore.getSnapshot())
      }
    ), config.label + ' renamed.')
    return
  }
  if (action === 'archive') {
    await archiveReferenceWithUndo({
      kind,
      id,
      archive: () => config.archive(id),
      restore: () => config.restore(id)
    })
    return
  }
  if (action === 'restore') {
    await runMutation(() => config.restore(id), config.label + ' restored.')
  }
}

async function runMutation (mutation, successMessage) {
  setBusy(true)
  clearStatus()
  try {
    const snapshot = await mutation()
    const feedback = mutationFeedback(snapshot, successMessage)
    showStatus(feedback.message, feedback.state)
    return { ok: true, snapshot, feedback }
  } catch (error) {
    showStatus(error.message || 'Could not save changes.', 'error')
    return { ok: false, error }
  } finally {
    setBusy(false)
  }
}

function setBusy (busy) {
  manager.classList.toggle('is-busy', busy)
  manager.setAttribute('aria-busy', String(busy))
  manager.querySelectorAll('button, input').forEach(control => {
    control.disabled = busy
  })
  if (!busy) {
    const snapshot = categoryLocationStore.getSnapshot()
    setReferenceCollectionDisabled('category', referenceAvailability(snapshot, 'category').disabled)
    setReferenceCollectionDisabled('location', referenceAvailability(snapshot, 'location').disabled)
  }
}

function clearStatus () {
  status.textContent = ''
  status.removeAttribute('data-state')
}

function showStatus (message, state) {
  status.textContent = message
  status.dataset.state = state
}
