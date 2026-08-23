// ABOUTME: Shared title-row actions for recording a chore or placing it in a session.
// ABOUTME: Keeps confirmation and completion feedback consistent wherever chore details open.

import { escapeHtml } from '../helpers.js'
import { doneLabel } from './ledgerLogic.js'

export function choreDoneButtonHtml (confirming = false) {
  return '<button type="button" class="btn done-btn" aria-pressed="' +
    (confirming ? 'true' : 'false') + '">' + doneLabel(confirming) + '</button>'
}

export function choreSessionButtonHtml (label) {
  if (!label) return ''
  return '<button type="button" class="btn btn-quiet session-btn">' +
    escapeHtml(String(label)) + '</button>'
}

export function armOrConfirmDone (button) {
  if (!button) return false
  if (button.getAttribute('aria-pressed') === 'true') return true
  button.setAttribute('aria-pressed', 'true')
  button.textContent = doneLabel(true)
  return false
}

export function disarmDone (button) {
  if (!button || button.getAttribute('aria-pressed') !== 'true') return false
  button.setAttribute('aria-pressed', 'false')
  button.textContent = doneLabel(false)
  return true
}

function failureReason (message) {
  const text = String(message ?? '').trim()
  if (!text) return ''
  const separator = text.lastIndexOf(':')
  const reason = (separator >= 0 ? text.slice(separator + 1) : text).trim()
  if (!reason) return ''
  return reason.replace(/[.!?]+$/, '') + '.'
}

export function completionFailureMessage (result) {
  if (result?.ok) return ''
  const base = result?.stage === 'refresh'
    ? "Recorded, but couldn't refresh the chores."
    : "Couldn't record that. The chore is unchanged."
  const reason = failureReason(result?.message)
  return base + (reason ? ' Reason: ' + reason : '')
}
