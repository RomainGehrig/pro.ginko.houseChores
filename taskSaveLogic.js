// ABOUTME: Pure orchestration for task writes followed by task-list refreshes.
// ABOUTME: Distinguishes failed writes from confirmed writes whose refresh failed.

const messageFor = error => error instanceof Error ? error.message : String(error)

export async function saveTaskWithRefresh (write, refresh) {
  try {
    await write()
  } catch (error) {
    return {
      ok: false,
      stage: 'write',
      message: 'Could not save task: ' + messageFor(error)
    }
  }

  try {
    await refresh()
  } catch (error) {
    return {
      ok: false,
      stage: 'refresh',
      message: 'Task saved, but could not refresh tasks: ' + messageFor(error)
    }
  }

  return { ok: true, stage: null, message: '' }
}
