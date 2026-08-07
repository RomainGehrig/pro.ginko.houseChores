export const state = {
  currentSession: null,
  currentBundle: [],
  currentExecutions: []
}

export function setCurrentSessionAggregate (aggregate) {
  state.currentSession = aggregate?.session || null
  state.currentBundle = aggregate?.bundle || []
  state.currentExecutions = aggregate?.executions || []
}
