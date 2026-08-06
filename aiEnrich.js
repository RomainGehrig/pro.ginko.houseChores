export function buildEnrichmentPrompt (tasks, categoryNames) {
  return 'For each household/admin task below, suggest a category (one of: ' +
    categoryNames.join(', ') + '), an estimated duration in minutes, and an optional recurrence ' +
    'in days (null if one-off). Respond as a JSON array matching the input order, each item: ' +
    '{ "category": string, "estimatedDuration": number, "recurrenceDays": number|null }.\n\n' +
    'Tasks:\n' + tasks.map(task => '- ' + task.name).join('\n')
}

export async function enrichTasks (tasks, categoryNames) {
  const result = await freezr.llm.ask(buildEnrichmentPrompt(tasks, categoryNames), { responseType: 'json' })
  if (!result.success) throw new Error('AI enrichment failed')
  return result.response
}

// Simple heuristic (average of recent actual durations) - kept AI-free per scope's
// guidance to avoid advanced optimization; only fires once enough history exists.
export async function suggestDuration(history) {
  const durations = history.map(e => e.actualDuration).filter(d => d != null)
  if (!durations.length) return null
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length
  return Math.round(avg)
}
