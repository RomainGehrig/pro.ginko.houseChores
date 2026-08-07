import { normalizeSchedule } from './scheduleLogic.js'

export function buildEnrichmentPrompt (tasks, categoryNames) {
  return 'For each household/admin task below, suggest a category (one of: ' +
    categoryNames.join(', ') + '), an estimated duration in minutes, and an optional schedule. ' +
    'Respond as a JSON array matching the input order, each item: ' +
    '{ "category": string, "estimatedDuration": number, "schedule": null|' +
    '{ "type": "periodic", "every": number, "unit": "day"|"week"|"month"|"year" }|' +
    '{ "type": "fixed", "pattern": { "kind": "weekdays", "weekdays": number[] } }|' +
    '{ "type": "fixed", "pattern": { "kind": "month_day", "day": number } }|' +
    '{ "type": "fixed", "pattern": { "kind": "annual_date", "month": number, "day": number } } }. ' +
    'Do not suggest a scheduledDate; the user chooses it.\n\n' +
    'Tasks:\n' + tasks.map(task => '- ' + task.name).join('\n')
}

export function normalizeEnrichmentSuggestion (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    category: value.category || null,
    estimatedDuration: Number(value.estimatedDuration) > 0
      ? Number(value.estimatedDuration)
      : null,
    schedule: normalizeSchedule(value.schedule)
  }
}

export async function enrichTasks (tasks, categoryNames) {
  const result = await freezr.llm.ask(buildEnrichmentPrompt(tasks, categoryNames), { responseType: 'json' })
  if (!result.success) throw new Error('AI enrichment failed')
  if (!Array.isArray(result.response)) throw new Error('AI enrichment returned an invalid response')
  return result.response.map(normalizeEnrichmentSuggestion)
}

// Simple heuristic (average of recent actual durations) - kept AI-free per scope's
// guidance to avoid advanced optimization; only fires once enough history exists.
export async function suggestDuration(history) {
  const durations = history.map(e => e.actualDuration).filter(d => d != null)
  if (!durations.length) return null
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length
  return Math.round(avg)
}
