// ABOUTME: The two writes behind an archived chore — restoring it, and deleting it for good.
// ABOUTME: The second ask lives in the delete button's own label, so nothing stops the user dead.

import { deleteTask, updateTask } from './taskData.js'
import { commitPending, undoPending } from './undoToast.js'

export function restoredTaskStatus (task) {
  return task?.schedule?.type === 'one_off' ? 'active' : 'approved_recurring'
}

export async function runArchiveAction ({
  action,
  task,
  undo = undoPending,
  commit = commitPending,
  update = updateTask,
  remove = deleteTask,
  refresh = async () => {}
}) {
  if (action === 'restore') {
    try {
      const settlement = await undo(`task:${task._id}`)
      if (settlement) return { ok: true, pendingArchiveRestored: true }
      await update(task._id, { status: restoredTaskStatus(task) })
      await refresh()
      return { ok: true, pendingArchiveRestored: false }
    } catch {
      return { ok: false, message: "Couldn't restore that. The chore is unchanged." }
    }
  }

  if (action === 'delete') {
    try {
      // An archive that has not yet reached the datastore has to settle first:
      // deleting a record the app is still trying to write is how a chore comes
      // back from the dead.
      const settlement = await commit(`task:${task._id}`)
      if (settlement?.result?.ok === false) {
        return { ok: false, message: settlement.result.message }
      }
      await remove(task._id)
      await refresh()
      return { ok: true, deleted: true }
    } catch {
      return { ok: false, message: "Couldn't delete that. The chore is still in Archive." }
    }
  }

  return { ok: true }
}
