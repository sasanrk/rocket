/**
 * Background job manager.
 *
 * Scans and cleanups used to run inside the IPC call that started them, which
 * meant the window had to sit and wait on them. Here they become jobs: queued,
 * cancellable, pausable, and — for anything destructive — held for a grace
 * period first, so "Delete" is a decision the user has a few seconds to take
 * back before a single byte moves.
 */
const { EventEmitter } = require('node:events')

/**
 * How hard a job is allowed to push the disk. On a four-core machine with
 * real-time antivirus in the path, the aggressive profile is the difference
 * between a scan you can work through and one you cannot.
 */
const THROTTLES = {
  gentle: { label: 'Gentle', fileBatch: 24, dirBatch: 3, ownPriority: 'BelowNormal' },
  balanced: { label: 'Balanced', fileBatch: 128, dirBatch: 12, ownPriority: 'Normal' },
  fast: { label: 'Fast', fileBatch: 320, dirBatch: 32, ownPriority: 'AboveNormal' },
}

const TERMINAL = new Set(['done', 'failed', 'cancelled'])

let sequence = 0

class Job {
  constructor({ type, label, detail, run, graceMs = 0, undoLabel }) {
    this.id = `j${(sequence += 1)}`
    this.type = type
    this.label = label
    this.detail = detail || ''
    this.undoLabel = undoLabel || 'Undo'
    this.graceMs = graceMs
    this.status = graceMs > 0 ? 'grace' : 'queued'
    this.createdAt = Date.now()
    this.graceEndsAt = graceMs > 0 ? Date.now() + graceMs : null
    this.startedAt = null
    this.finishedAt = null
    this.progress = { done: 0, total: 0, currentPath: '' }
    this.result = null
    this.error = null

    this.run = run
    this.cancelled = false
    this.paused = false
    this.graceTimer = null
    this.resumeWaiters = []
    /** Set by a runner that offloaded the work to its own process. */
    this.handle = null
  }

  /**
   * Handed to the work function. `state` is shaped for scanner.cjs, which polls
   * `cancelled` and awaits `wait()` at every batch boundary.
   */
  context(manager) {
    // The returned object is handed to work running in another process; it
    // closes over the job rather than over `this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const job = this
    return {
      state: {
        get cancelled() {
          return job.cancelled
        },
        wait: () => job.waitWhilePaused(),
      },
      throttle: () => THROTTLES[manager.throttle] || THROTTLES.balanced,
      progress(patch) {
        job.progress = { ...job.progress, ...patch }
        manager.touch(job)
      },
      emit(event, payload) {
        manager.emit('job-event', { jobId: job.id, event, payload })
      },
      /**
       * Hands the manager the controls for work running elsewhere, so cancel,
       * pause and throttle changes reach it.
       */
      attach(handle) {
        job.handle = handle
        if (job.cancelled) handle.cancel()
        else if (job.paused) handle.setPaused(true)
      },
    }
  }

  waitWhilePaused() {
    if (!this.paused || this.cancelled) return Promise.resolve()
    return new Promise((resolve) => this.resumeWaiters.push(resolve))
  }

  releasePause() {
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    waiters.forEach((resolve) => resolve())
  }

  /** The public shape — the work function and timers stay in the main process. */
  serialise() {
    return {
      id: this.id,
      type: this.type,
      label: this.label,
      detail: this.detail,
      undoLabel: this.undoLabel,
      status: this.status,
      createdAt: this.createdAt,
      graceEndsAt: this.graceEndsAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      progress: this.progress,
      result: this.result,
      error: this.error,
      paused: this.paused,
    }
  }
}

class JobManager extends EventEmitter {
  constructor() {
    super()
    this.jobs = new Map()
    this.order = []
    this.throttle = 'balanced'
    this.maxConcurrent = 1
    this.onThrottleChange = null
  }

  setThrottle(level) {
    if (!THROTTLES[level]) return this.throttle
    this.throttle = level
    if (this.onThrottleChange) this.onThrottleChange(THROTTLES[level])
    // Running work picks the new profile up immediately.
    this.jobs.forEach((job) => {
      if (job.handle) job.handle.setTuning(THROTTLES[level])
    })
    this.emit('update', this.list())
    return this.throttle
  }

  list() {
    // Newest first; a finished job stays in the list so the user can read it.
    return this.order.map((id) => this.jobs.get(id)).filter(Boolean).map((job) => job.serialise())
  }

  get(id) {
    return this.jobs.get(id)
  }

  touch(job) {
    this.emit('job-progress', { jobId: job.id, progress: job.progress, status: job.status })
  }

  create(options) {
    const job = new Job(options)
    this.jobs.set(job.id, job)
    this.order.unshift(job.id)

    // Keep the tail of the list bounded; finished jobs live on in history.
    while (this.order.length > 40) {
      const oldest = this.order[this.order.length - 1]
      const candidate = this.jobs.get(oldest)
      if (candidate && !TERMINAL.has(candidate.status)) break
      this.order.pop()
      this.jobs.delete(oldest)
    }

    if (job.graceMs > 0) {
      job.graceTimer = setTimeout(() => {
        job.graceTimer = null
        if (job.status !== 'grace') return
        job.status = 'queued'
        this.emit('update', this.list())
        this.pump()
      }, job.graceMs)
    }

    this.emit('update', this.list())
    this.pump()
    return job
  }

  /** Starts queued jobs up to the concurrency limit. */
  pump() {
    const running = this.order.filter((id) => this.jobs.get(id)?.status === 'running').length
    if (running >= this.maxConcurrent) return

    // Oldest queued job first, so a queue behaves like a queue.
    const next = [...this.order].reverse().map((id) => this.jobs.get(id)).find((job) => job && job.status === 'queued')
    if (!next) return

    this.start(next)
  }

  async start(job) {
    job.status = 'running'
    job.startedAt = Date.now()
    this.emit('update', this.list())

    try {
      const result = await job.run(job.context(this))
      if (job.cancelled) {
        job.status = 'cancelled'
        job.result = result ?? null
      } else {
        job.status = 'done'
        job.result = result ?? null
      }
    } catch (error) {
      if (job.cancelled) {
        job.status = 'cancelled'
      } else {
        job.status = 'failed'
        job.error = error && error.message ? error.message : String(error)
        console.error('[reclaim] job failed', job.type, error)
      }
    } finally {
      job.finishedAt = Date.now()
      job.handle = null
      job.releasePause()
      this.emit('update', this.list())
      this.emit('job-finished', { job: job.serialise() })
      this.pump()
    }
  }

  /**
   * Cancelling inside the grace window means the job never ran at all — that is
   * the undo. Cancelling later stops it at its next checkpoint, keeping
   * whatever it already finished.
   */
  cancel(id) {
    const job = this.jobs.get(id)
    if (!job || TERMINAL.has(job.status)) return { ok: false, undone: false }

    const undone = job.status === 'grace' || job.status === 'queued'
    job.cancelled = true
    job.paused = false
    job.releasePause()
    if (job.handle) job.handle.cancel()

    if (job.graceTimer) {
      clearTimeout(job.graceTimer)
      job.graceTimer = null
    }

    if (undone) {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      this.emit('update', this.list())
      this.emit('job-finished', { job: job.serialise() })
      this.pump()
    } else {
      this.emit('update', this.list())
    }

    return { ok: true, undone }
  }

  setPaused(id, paused) {
    const job = this.jobs.get(id)
    if (!job || TERMINAL.has(job.status)) return { ok: false }
    job.paused = Boolean(paused)
    if (!job.paused) job.releasePause()
    if (job.handle) job.handle.setPaused(job.paused)
    this.emit('update', this.list())
    return { ok: true, paused: job.paused }
  }

  /** Clears finished jobs from the list without touching history. */
  clearFinished() {
    this.order = this.order.filter((id) => {
      const job = this.jobs.get(id)
      if (job && TERMINAL.has(job.status)) {
        this.jobs.delete(id)
        return false
      }
      return true
    })
    this.emit('update', this.list())
    return this.list()
  }

  cancelAll() {
    this.order.forEach((id) => this.cancel(id))
  }
}

module.exports = { JobManager, THROTTLES }
