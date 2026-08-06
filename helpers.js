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
  return String(str).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character])
}

export function formatDateTime(ts) {
  if (!ts) return 'n/a'
  return new Date(ts).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}
