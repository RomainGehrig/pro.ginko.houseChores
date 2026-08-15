// ABOUTME: Reads and writes the single app-settings record behind the Setup switches.
// ABOUTME: A missing record is an empty one — nothing here may stop the app from opening.

export const SETTINGS_ID = 'app'

export async function readSettings () {
  try {
    return await freezr.read('settings', SETTINGS_ID) || {}
  } catch {
    // Never written, or unreadable right now. Either way the defaults hold and
    // the user can still work; the switch simply shows its off position.
    return {}
  }
}

export function writeSettings (fields) {
  return freezr.create('settings', fields, { data_object_id: SETTINGS_ID, upsert: true })
}

// Suggestions are one optional permission, off until the user asks for it.
export const aiSuggestionsEnabled = settings => settings?.aiSuggestions === true
