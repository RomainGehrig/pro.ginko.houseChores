export const state = {
  currentSession: null,
  currentBundle: [],
  currentBundleIndex: 0,
  currentExecutions: []
}

export function setCurrentSessionAggregate (aggregate) {
  state.currentSession = aggregate?.session || null
  state.currentBundle = aggregate?.bundle || []
  state.currentBundleIndex = 0
  state.currentExecutions = aggregate?.executions || []
}
