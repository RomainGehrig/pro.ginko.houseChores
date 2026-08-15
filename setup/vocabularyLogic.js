// ABOUTME: Pure view model for Setup — the vocabulary tabs, usage counts and switch copy.
// ABOUTME: A usage count is a fact about the word; nothing here scores the user's choices.

export const SETUP_TABS = [
  { key: 'categories', label: 'Categories' },
  { key: 'locations', label: 'Locations' },
  { key: 'ai', label: 'AI' },
  { key: 'theme', label: 'Theme' }
]

export function setupTabs (activeTab) {
  return SETUP_TABS.map(tab => ({ ...tab, active: tab.key === activeTab }))
}

export function usageCount (kind, reference, tasks = []) {
  const id = reference?._id
  if (!id) return 0
  return tasks.filter(task => kind === 'category'
    ? task?.categoryId === id
    : (task?.locationIds || []).includes(id)
  ).length
}

const chores = count => count + ' chore' + (count === 1 ? '' : 's')

export const usageLine = count => count ? chores(count) : 'Not used yet'

// Archiving a word keeps every assignment intact, so the line says what still
// carries it rather than implying anything was lost.
export const archivedUsageLine = count => count
  ? chores(count) + ' still ' + (count === 1 ? 'carries' : 'carry') + ' it'
  : 'Not used by any chore'

export const renamedTo = (draft, current) => String(draft ?? '').trim() || current

export function splitVocabulary (references = []) {
  return references.reduce((groups, reference) => {
    if (reference.status === 'archived') groups.archived.push(reference)
    else groups.active.push(reference)
    return groups
  }, { active: [], archived: [] })
}

export const aiSwitchLabel = on => on ? 'On' : 'Off'
export const aiToggleMessage = wasOn => wasOn ? 'Suggestions turned off' : 'Suggestions turned on'
