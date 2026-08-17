// ABOUTME: Renders and wires Setup — the vocabulary of categories and locations, and the AI switch.
// ABOUTME: Renaming and adding happen in the row itself; archiving keeps every existing assignment.

import { categoryLocationStore } from '../categoryLocationStore.js'
import { escapeAttribute, escapeHtml } from '../helpers.js'
import { listAllTasks } from '../taskData.js'
import { aiSuggestionsEnabled, readSettings, storedTheme, writeSettings } from '../settingsData.js'
import { pendingUndo } from '../undoToast.js'
import { DEFAULT_THEME, applyTheme, cacheTheme, themeChoices, themeNote } from '../theme.js'
import {
  aiSwitchLabel,
  aiToggleMessage,
  archivedUsageLine,
  renamedTo,
  setupTabs,
  splitVocabulary,
  usageCount,
  usageLine
} from './vocabularyLogic.js'

const KINDS = {
  category: {
    label: 'Category',
    title: 'Categories',
    headingId: 'categoriesHeading',
    note: 'Six are seeded on first run. Rename or archive any of them.',
    addLabel: 'Add a category',
    placeholder: 'New category',
    snapshotKey: 'categories',
    add: name => categoryLocationStore.addCategory(name),
    rename: (id, name) => categoryLocationStore.renameCategory(id, name),
    archive: id => categoryLocationStore.archiveCategory(id),
    restore: id => categoryLocationStore.restoreCategory(id)
  },
  location: {
    label: 'Location',
    title: 'Locations',
    headingId: 'locationsHeading',
    note: 'A flat list, entirely yours — used to tag where a chore happens.',
    addLabel: 'Add a location',
    placeholder: 'New location',
    snapshotKey: 'locations',
    add: name => categoryLocationStore.addLocation(name),
    rename: (id, name) => categoryLocationStore.renameLocation(id, name),
    archive: id => categoryLocationStore.archiveLocation(id),
    restore: id => categoryLocationStore.restoreLocation(id)
  }
}

export function setupTabsHtml (activeTab) {
  return setupTabs(activeTab).map(tab =>
    '<button type="button" class="seg-opt" data-setup-tab="' + tab.key +
      '" aria-pressed="' + (tab.active ? 'true' : 'false') + '">' +
      escapeHtml(tab.label) + '</button>'
  ).join('')
}

export function termRowHtml (kind, reference, { usage = 0, editing = false, archived = false } = {}) {
  const name = escapeHtml(String(reference?.name ?? ''))
  const rowData = ' data-kind="' + kind + '" data-id="' + escapeAttribute(reference?._id ?? '') + '"'

  const body = editing
    ? '<input class="input term-name-input" type="text" aria-label="Rename ' + name +
      '" value="' + escapeAttribute(String(reference?.name ?? '')) + '" autocomplete="off">'
    : '<span class="term-main"><span class="term-name">' + name + '</span>' +
      '<span class="term-note muted">' +
        escapeHtml(archived ? archivedUsageLine(usage) : usageLine(usage)) + '</span></span>'

  const actions = archived
    ? '<button type="button" class="btn btn-ghost" data-action="restore">Restore</button>'
    : editing
      ? ''
      : '<button type="button" class="btn btn-ghost" data-action="rename">Rename</button>' +
        '<button type="button" class="btn btn-ghost term-archive" data-action="archive">Archive</button>'

  return '<li class="term-row' + (archived ? ' is-archived' : '') + '"' + rowData + '>' +
    body + actions + '</li>'
}

export function vocabularyPaneHtml (kind, references, tasks, state = {}) {
  const config = KINDS[kind]
  const groups = splitVocabulary(references)
  const row = (reference, archived) => termRowHtml(kind, reference, {
    usage: usageCount(kind, reference, tasks),
    editing: state.editing === kind + ':' + reference._id,
    archived
  })

  const adding = state.adding === kind
    ? '<input class="input term-add-input" type="text" data-add-kind="' + kind +
      '" placeholder="' + escapeAttribute(config.placeholder) + '" aria-label="' +
      escapeAttribute(config.addLabel) + '" autocomplete="off">'
    : '<button type="button" class="btn btn-secondary" data-add-term="' + kind + '">' +
      escapeHtml(config.addLabel) + '</button>'

  const archivedSection = groups.archived.length
    ? '<section class="vocabulary-archived" aria-labelledby="archived-' + kind + '">' +
      '<h3 id="archived-' + kind + '" class="eyebrow eyebrow-quiet">Archived</h3>' +
      '<ul class="term-list">' + groups.archived.map(item => row(item, true)).join('') + '</ul>' +
      '</section>'
    : ''

  return '<h2 id="' + config.headingId + '" class="display setup-pane-title">' +
      escapeHtml(config.title) + '</h2>' +
    '<p class="muted vocabulary-note">' + escapeHtml(config.note) + '</p>' +
    '<ul class="term-list">' + groups.active.map(item => row(item, false)).join('') + '</ul>' +
    adding + archivedSection
}

export function aiPaneHtml (on) {
  return '<div class="card ai-card">' +
    '<div class="ai-card-head">' +
      '<div class="ai-card-title">' +
        '<p class="display ai-title">Suggestions</p>' +
        '<p class="muted">Used in the Inbox, nowhere else.</p>' +
      '</div>' +
      '<div class="ai-switch-group">' +
        '<span class="muted ai-switch-state" id="aiSwitchLabel">' + aiSwitchLabel(on) + '</span>' +
        '<button type="button" class="ai-switch" id="aiSwitch" role="switch" aria-checked="' +
          (on ? 'true' : 'false') + '" aria-labelledby="aiSwitchLabel" aria-label="Suggestions">' +
          '<span class="ai-switch-knob"></span></button>' +
      '</div>' +
    '</div>' +
    '<p class="ai-card-body">When on, the ✦ control proposes a category, an estimate and a ' +
      'schedule rule for a captured task. It never sets the date, never approves anything, and ' +
      'every field stays editable. The app is fully usable with this off.</p>' +
  '</div>' +
  '<section class="ai-data" aria-labelledby="yourDataHeading">' +
    '<h3 id="yourDataHeading" class="eyebrow eyebrow-quiet">Your data</h3>' +
    '<p class="muted">Chores, categories, locations, sessions and per-chore records live in ' +
      'your own storage. No account, no server.</p>' +
  '</section>'
}

// The three choices are a segmented control, not a toggle: System is a real
// choice and has to be reachable, not just the state you are in before choosing.
export function themePaneHtml (theme) {
  return '<h2 id="themeHeading" class="display setup-pane-title">Theme</h2>' +
    '<div class="card theme-card">' +
      '<div class="seg theme-choices" role="group" aria-label="Theme">' +
        themeChoices(theme).map(choice =>
          '<button type="button" class="seg-opt" data-theme-choice="' + choice.key +
            '" aria-pressed="' + (choice.active ? 'true' : 'false') + '">' +
            escapeHtml(choice.label) + '</button>').join('') +
      '</div>' +
      '<p class="muted theme-note">' + escapeHtml(themeNote(theme)) + '</p>' +
    '</div>'
}

const setup = { tab: 'categories', editing: null, adding: null, ai: false, theme: DEFAULT_THEME }
let tasksCache = []
let onSuggestionsChange = () => {}

export function suggestionsEnabled () {
  return setup.ai
}

function element (id) {
  return typeof document === 'undefined' ? null : document.getElementById(id)
}

function renderSetup (snapshot = categoryLocationStore.getSnapshot()) {
  const screen = element('setupScreen')
  if (!screen) return
  screen.dataset.tab = setup.tab
  element('setupTabs').innerHTML = setupTabsHtml(setup.tab)
  element('categoriesPane').innerHTML =
    vocabularyPaneHtml('category', snapshot.categories, tasksCache, setup)
  element('locationsPane').innerHTML =
    vocabularyPaneHtml('location', snapshot.locations, tasksCache, setup)
  element('aiPane').innerHTML = aiPaneHtml(setup.ai)
  element('themePane').innerHTML = themePaneHtml(setup.theme)
  if (snapshot.error) showStatus(snapshot.error, 'error')
  else if (snapshot.warning) showStatus(snapshot.warning, 'warning')

  const editor = screen.querySelector('.term-name-input, .term-add-input')
  editor?.focus()
  editor?.select?.()
}

function showStatus (message, state = 'status') {
  const status = element('setupStatus')
  if (!status) return
  status.textContent = message
  if (state === 'status') status.removeAttribute('data-state')
  else status.dataset.state = state
  status.setAttribute('role', state === 'error' ? 'alert' : 'status')
}

// A write that succeeded still has to report a collection that did not load:
// the refreshed snapshot's own trouble outranks the message about the write.
export function mutationFeedback (snapshot, successMessage) {
  if (snapshot?.error) return { message: snapshot.error, state: 'error' }
  if (snapshot?.warning) return { message: snapshot.warning, state: 'warning' }
  return { message: successMessage, state: 'success' }
}

async function runMutation (mutation, successMessage) {
  try {
    const snapshot = await mutation()
    const feedback = mutationFeedback(snapshot, successMessage)
    showStatus(feedback.message, feedback.state)
    return { ok: !snapshot?.error, snapshot, feedback }
  } catch (error) {
    showStatus(error.message || 'Could not save that. Nothing changed.', 'error')
    return { ok: false }
  }
}

// Archiving keeps every assignment intact, so it needs no confirmation — only a
// way back, for the moment you meant a different word. A failed archive queues
// nothing: there would be nothing to undo.
export async function archiveTermWithUndo ({
  kind,
  id,
  config = KINDS[kind],
  mutate = runMutation,
  queue = pendingUndo,
  render = () => renderSetup()
}) {
  const result = await mutate(() => config.archive(id),
    config.label + ' archived. Chores that carry it keep it.')
  render()
  if (!result.ok) return result

  await queue({
    key: 'reference:' + kind + ':' + id,
    label: config.label + ' archived',
    commit: () => null,
    revert: async () => {
      const restored = await mutate(() => config.restore(id), config.label + ' restored.')
      render()
      return { kind, id, status: restored.ok ? 'active' : 'archived' }
    }
  }, 6000)
  return result
}

async function commitRename (row) {
  const input = row.querySelector('.term-name-input')
  if (!input) return
  const { kind, id } = row.dataset
  const config = KINDS[kind]
  const current = (categoryLocationStore.getSnapshot()[config.snapshotKey] || [])
    .find(item => item._id === id)
  const name = renamedTo(input.value, String(current?.name ?? ''))
  setup.editing = null
  if (name === current?.name) return renderSetup()
  await runMutation(() => config.rename(id, name), config.label + ' renamed.')
  renderSetup()
}

async function commitAdd (input) {
  const kind = input.dataset.addKind
  const config = KINDS[kind]
  const name = String(input.value || '').trim()
  setup.adding = null
  if (!name) return renderSetup()
  await runMutation(() => config.add(name), config.label + ' added.')
  renderSetup()
}

async function handleSetupClick (event) {
  const tab = event.target.closest('[data-setup-tab]')
  if (tab) {
    Object.assign(setup, { tab: tab.dataset.setupTab, editing: null, adding: null })
    return renderSetup()
  }

  if (event.target.closest('#aiSwitch')) return toggleSuggestions()

  const themeChoice = event.target.closest('[data-theme-choice]')
  if (themeChoice) return chooseTheme(themeChoice.dataset.themeChoice)

  const addButton = event.target.closest('[data-add-term]')
  if (addButton) {
    Object.assign(setup, { adding: addButton.dataset.addTerm, editing: null })
    return renderSetup()
  }

  const actionButton = event.target.closest('[data-action]')
  if (!actionButton) return
  const row = actionButton.closest('[data-kind][data-id]')
  if (!row) return
  const { kind, id } = row.dataset
  const config = KINDS[kind]

  if (actionButton.dataset.action === 'rename') {
    Object.assign(setup, { editing: kind + ':' + id, adding: null })
    return renderSetup()
  }
  if (actionButton.dataset.action === 'archive') {
    return archiveTermWithUndo({ kind, id, config })
  }
  if (actionButton.dataset.action === 'restore') {
    await runMutation(() => config.restore(id), config.label + ' restored.')
    renderSetup()
  }
}

function handleSetupKeydown (event) {
  const input = event.target.closest('.term-name-input, .term-add-input')
  if (!input) return
  if (event.key === 'Enter') {
    event.preventDefault()
    const row = input.closest('[data-kind][data-id]')
    return row ? commitRename(row) : commitAdd(input)
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    Object.assign(setup, { editing: null, adding: null })
    renderSetup()
  }
}

function handleSetupBlur (event) {
  const input = event.target.closest?.('.term-name-input, .term-add-input')
  if (!input) return
  const row = input.closest('[data-kind][data-id]')
  if (row) commitRename(row)
  else commitAdd(input)
}

async function toggleSuggestions () {
  const wasOn = setup.ai
  setup.ai = !wasOn
  renderSetup()
  try {
    await writeSettings({ aiSuggestions: setup.ai })
    onSuggestionsChange(setup.ai)
  } catch {
    setup.ai = wasOn
    renderSetup()
    showStatus("Couldn't save that. Suggestions are unchanged.", 'error')
    return
  }
  await pendingUndo({
    key: 'setting:aiSuggestions',
    label: aiToggleMessage(wasOn),
    commit: () => null,
    revert: async () => {
      setup.ai = wasOn
      await writeSettings({ aiSuggestions: wasOn })
      onSuggestionsChange(setup.ai)
      renderSetup()
      return { aiSuggestions: wasOn }
    }
  }, 6000)
}

// The whole app repainting is the feedback, so a success message would only
// repeat what the user can see. There is no undo either: the way back is the
// choice next to the one they just pressed.
async function chooseTheme (choice) {
  const previous = setup.theme
  setup.theme = applyTheme(choice)
  cacheTheme(setup.theme)
  renderSetup()
  if (setup.theme === previous) return

  try {
    await writeSettings({ theme: setup.theme })
    showStatus('', 'status')
  } catch {
    // The colour is already what they asked for and this device will remember
    // it, so the only thing lost is every other device. Say exactly that.
    showStatus('Kept on this device — the setting could not be saved.', 'warning')
  }
}

export async function refreshSetupView () {
  tasksCache = await listAllTasks().catch(() => [])
  renderSetup()
}

export async function initSetupView ({ onSuggestionsChange: notify = () => {} } = {}) {
  onSuggestionsChange = notify
  const screen = element('setupScreen')
  if (!screen) return false

  screen.addEventListener('click', handleSetupClick)
  screen.addEventListener('keydown', handleSetupKeydown)
  screen.addEventListener('focusout', handleSetupBlur)
  categoryLocationStore.subscribe(() => renderSetup())

  const settings = await readSettings()
  setup.ai = aiSuggestionsEnabled(settings)
  onSuggestionsChange(setup.ai)

  // The record outranks the cache the first paint used: another device may have
  // changed it since. Re-caching keeps the next first paint right.
  setup.theme = applyTheme(storedTheme(settings))
  cacheTheme(setup.theme)
  await refreshSetupView()
  return true
}
