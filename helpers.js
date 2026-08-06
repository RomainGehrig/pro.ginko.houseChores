export const CATEGORIES = ['Admin', 'Clean / Reset', 'Fix', 'Plan', 'Organize', 'Run Errands']

export function formatDate(ts) {
  if (!ts) return 'n/a'
  return new Date(ts).toLocaleDateString()
}

export function formatDuration(mins) {
  if (mins == null) return '?'
  if (mins < 60) return mins + ' min'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h + 'h' + (m ? ' ' + m + 'm' : '')
}

export function formatTimer(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

export function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}