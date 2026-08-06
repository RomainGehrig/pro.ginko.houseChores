// ABOUTME: Renders and wires the user-managed category and location panel.
// ABOUTME: Keeps reference mutations behind the shared category-location store.

import { categoryLocationStore } from './categoryLocationStore.js'
import { escapeHtml } from './helpers.js'

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
  if (snapshot.error) {
    manager.open = true
    showStatus(snapshot.error, 'error')
  } else if (snapshot.warning) {
    manager.open = true
    showStatus(snapshot.warning, 'warning')
  }
}

export function mutationFeedback (snapshot, successMessage) {
  if (snapshot?.warning) return { message: snapshot.warning, state: 'warning' }
  return { message: successMessage, state: 'success' }
}

export async function applyReferenceMutation (write, applyUiUpdate) {
  const snapshot = await write()
  applyUiUpdate()
  return snapshot
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
      '<button type="button" data-action="save">Save</button>' +
      '<button type="button" data-action="cancel">Cancel</button>' +
    '</div>'
  }

  return '<div class="' + rowClass + '" ' + rowData + '>' +
    '<span>' + name + '</span>' +
    '<span class="reference-actions">' +
      '<button type="button" data-action="rename">Rename</button>' +
      '<button type="button" data-action="' + (archived ? 'restore' : 'archive') + '">' + (archived ? 'Restore' : 'Archive') + '</button>' +
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
    const confirmed = window.confirm('Archive this ' + kind + '? Existing task assignments will be retained.')
    if (!confirmed) return
    await runMutation(() => config.archive(id), config.label + ' archived.')
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
  } catch (error) {
    showStatus(error.message || 'Could not save changes.', 'error')
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
}

function clearStatus () {
  status.textContent = ''
  status.removeAttribute('data-state')
}

function showStatus (message, state) {
  status.textContent = message
  status.dataset.state = state
}
