/**
 * Spawns and drives `scanProcess.cjs`.
 *
 * One utility process per job. Spawning costs ~100ms, which is nothing next to
 * a scan, and it means a job that wedges can be killed outright rather than
 * poisoning a shared worker.
 */
const path = require('node:path')
const { utilityProcess } = require('electron')

const ENTRY = path.join(__dirname, 'scanProcess.cjs')
/** How long a cancelled job gets to stop cleanly before it is killed. */
const CANCEL_GRACE_MS = 4000

/**
 * @param request  {type:'scan'|'clean', ...} sent to the child
 * @param handlers onProgress / onProjects / onJunk / onRemoved / onFailed
 * @returns a handle with `completion`, `cancel()`, `setPaused()`, `setTuning()`
 */
function runInProcess(request, handlers) {
  const child = utilityProcess.fork(ENTRY, [], {
    serviceName: 'reclaim-scanner',
    // Its own threadpool, sized for a walk that is latency-bound rather than
    // CPU-bound. This is the child's pool, so the UI's is left alone.
    env: { ...process.env, UV_THREADPOOL_SIZE: '32' },
    stdio: 'inherit',
  })

  let settle
  let fail
  const completion = new Promise((resolve, reject) => {
    settle = resolve
    fail = reject
  })

  let finished = false
  let killTimer = null

  const stop = () => {
    if (killTimer) {
      clearTimeout(killTimer)
      killTimer = null
    }
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }

  child.on('message', (message) => {
    if (!message) return
    switch (message.type) {
      case 'progress':
        handlers.onProgress(message)
        break
      case 'projects':
        handlers.onProjects(message.items)
        break
      case 'junk':
        if (handlers.onJunk) handlers.onJunk(message.items)
        break
      case 'folders':
        if (handlers.onFolders) handlers.onFolders(message.items)
        break
      case 'moved':
        if (handlers.onMoved) handlers.onMoved(message)
        break
      case 'discovered':
        handlers.onDiscovered(message.dirs)
        break
      case 'dropped':
        handlers.onDropped(message.dir)
        break
      case 'removed':
        handlers.onRemoved(message)
        break
      case 'failed':
        handlers.onFailed(message)
        break
      case 'done':
        finished = true
        stop()
        settle(message.summary)
        break
      case 'error':
        finished = true
        stop()
        fail(new Error(message.message))
        break
      default:
        break
    }
  })

  child.on('exit', (code) => {
    if (finished) return
    finished = true
    // A cancel that killed the child is an expected end, not a failure.
    if (cancelled) settle(null)
    else fail(new Error(`The scanner stopped unexpectedly (exit ${code})`))
  })

  let cancelled = false

  child.postMessage(request)

  return {
    completion,
    cancel() {
      if (cancelled || finished) return
      cancelled = true
      child.postMessage({ type: 'cancel' })
      // It should stop at its next checkpoint; if a single huge directory is
      // still being measured, take it down rather than hang the task list.
      killTimer = setTimeout(stop, CANCEL_GRACE_MS)
    },
    setPaused(paused) {
      if (finished) return
      child.postMessage({ type: 'pause', paused })
    },
    setTuning(tuning) {
      if (finished) return
      child.postMessage({ type: 'tuning', tuning })
    },
    kill: stop,
  }
}

module.exports = { runInProcess }
