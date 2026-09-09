/**
 * The scanner, running in its own OS process.
 *
 * This is the whole reason the window stays responsive. Node hands every
 * `fs.stat` to a libuv threadpool that is four threads wide by default, and a
 * scan issues tens of thousands of them — run that in the main process and
 * every other filesystem call, every IPC reply and every window repaint queues
 * behind it. Electron's `utilityProcess` gives this work its own event loop and
 * its own threadpool, so a scan of a full drive costs the UI nothing.
 *
 * Talks to main over `parentPort` in both directions:
 *   in : {type:'scan'|'clean'|'appScan'|'appClean'|'cancel'|'pause'|'tuning', ...}
 *   out: {type:'progress'|'projects'|'junk'|'removed'|'failed'|'done'|'error', ...}
 */
const { findProjects, measureProject, removeTarget, measureTree } = require('./scanner.cjs')
const { discoverJunk, emptyJunk } = require('./appJunk.cjs')
const { removeLeftover } = require('./programs.cjs')
const { moveProject } = require('./mover.cjs')
const { measureChildren, removeUserFolder } = require('./drives.cjs')

/** Progress is coalesced to this many milliseconds; the UI cannot use more. */
const PROGRESS_MS = 120
/** Discovered projects are shipped in batches on the same cadence. */
const BATCH_MS = 150
/**
 * Projects measured at once. The walk waits on the disk far more than on the
 * CPU, so overlapping a few keeps the queue deep without thrashing it.
 */
const MEASURE_CONCURRENCY = 4

const control = { cancelled: false, paused: false }
let tuning = { fileBatch: 128, dirBatch: 12 }

function send(message) {
  process.parentPort.postMessage(message)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The shape scanner.cjs polls. `wait` is what makes pause work: it parks at the
 * next batch boundary instead of spinning.
 */
const state = {
  get cancelled() {
    return control.cancelled
  },
  async wait() {
    while (control.paused && !control.cancelled) {
      await sleep(80)
    }
  },
}

/** Drops progress updates the UI would only throw away. */
function makeProgressSink() {
  let last = 0
  let pending = null
  let timer = null

  const flush = () => {
    if (!pending) return
    send({ type: 'progress', ...pending })
    pending = null
    last = Date.now()
  }

  return {
    push(patch) {
      pending = { ...pending, ...patch }
      const elapsed = Date.now() - last
      if (elapsed >= PROGRESS_MS) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        flush()
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null
          flush()
        }, PROGRESS_MS - elapsed)
      }
    },
    close() {
      if (timer) clearTimeout(timer)
      timer = null
      flush()
    },
  }
}

/** Ships projects in batches so the renderer sets state once, not 229 times. */
function makeBatcher(type) {
  let items = []
  let timer = null

  const flush = () => {
    timer = null
    if (items.length === 0) return
    send({ type, items })
    items = []
  }

  return {
    push(item) {
      items.push(item)
      if (!timer) timer = setTimeout(flush, BATCH_MS)
    },
    close() {
      if (timer) clearTimeout(timer)
      flush()
    },
  }
}

async function runScan({ root, depth }) {
  const startedAt = Date.now()
  const progress = makeProgressSink()
  const batch = makeBatcher('projects')

  progress.push({ done: 0, total: 0, currentPath: root })

  // The total is unknown until the walk finishes, so the discovered count
  // stands in for it and the bar fills as measuring catches up. A whole
  // drive is walked deeper than a chosen folder: projects sit further down.
  const maxDepth = Number.isFinite(depth) ? Math.max(1, Math.min(8, depth)) : 4
  const dirs = await findProjects(root, state, maxDepth, (dir, count) => {
    progress.push({ done: 0, total: count, currentPath: dir })
  })

  // Discovery is quick; measuring is not. Hand the renderer the whole list up
  // front so the user sees every project immediately and watches the sizes
  // land, rather than staring at an empty table.
  send({ type: 'discovered', dirs })

  let reclaimable = 0
  let measured = 0
  let done = 0

  for (let index = 0; index < dirs.length; index += MEASURE_CONCURRENCY) {
    if (control.cancelled) break
    await state.wait()
    if (control.cancelled) break

    const chunk = dirs.slice(index, index + MEASURE_CONCURRENCY)
    progress.push({ done, total: dirs.length, currentPath: chunk[0] })

    const measuredChunk = await Promise.all(
      chunk.map((dir, offset) => measureProject(dir, `p${index + offset + 1}`, state, tuning)),
    )
    if (control.cancelled) break

    measuredChunk.forEach((project, offset) => {
      done += 1
      if (!project) {
        // Nothing measurable there — tell the renderer so the placeholder goes.
        send({ type: 'dropped', dir: chunk[offset] })
        return
      }
      measured += 1
      reclaimable += project.targets.reduce((sum, target) => sum + target.bytes, 0)
      batch.push(project)
    })
  }

  progress.push({ done: dirs.length, total: dirs.length, currentPath: root })
  progress.close()
  batch.close()

  return {
    root,
    projects: measured,
    reclaimable,
    durationMs: Date.now() - startedAt,
    cancelled: control.cancelled,
  }
}

/**
 * Deletes a list of measured targets with `remove`, reporting each one as it
 * goes. Shared by project cleanups and app-cache cleanups: the only difference
 * is the guard each remover applies before touching anything.
 */
async function runRemoval(targets, remove) {
  const startedAt = Date.now()
  const progress = makeProgressSink()
  const items = []

  // The scan already measured every target, so progress can be reported in
  // bytes and files rather than "3 of 12 folders" — which is what makes a
  // percentage and a time remaining possible.
  const bytesTotal = targets.reduce((sum, target) => sum + (target.bytes || 0), 0)
  const filesTotal = targets.reduce((sum, target) => sum + (target.files || 0), 0)

  let bytesDone = 0
  let filesDone = 0
  let freed = 0
  let failures = 0

  for (let index = 0; index < targets.length; index += 1) {
    if (control.cancelled) break
    await state.wait()
    if (control.cancelled) break

    const target = targets[index]
    const targetBytes = target.bytes || 0
    const targetFiles = target.files || 0
    const startedFiles = filesDone

    const report = (removedSoFar) => {
      filesDone = startedFiles + removedSoFar
      // Bytes are inferred from how far through this folder's files we are;
      // unlink never tells us a size, and re-stating each one would cost more
      // than the delete itself.
      const share = targetFiles > 0 ? Math.min(1, removedSoFar / targetFiles) : 0
      progress.push({
        done: index,
        total: targets.length,
        currentPath: target.path,
        bytesDone: bytesDone + Math.round(targetBytes * share),
        bytesTotal,
        filesDone,
        filesTotal,
        startedAt,
      })
    }

    report(0)
    const result = await remove(target.path, { bytes: targetBytes, files: targetFiles }, report)

    freed += result.bytes
    bytesDone += result.bytes
    filesDone = startedFiles + result.files
    items.push({ path: target.path, bytes: result.bytes, ok: result.ok, error: result.error || null })

    if (result.ok) {
      send({ type: 'removed', targetId: target.id, bytes: result.bytes })
    } else {
      failures += 1
      send({
        type: 'failed',
        targetId: target.id,
        path: target.path,
        bytes: result.bytes,
        message: result.error,
        locked: result.locked || [],
      })
    }
  }

  progress.push({
    done: targets.length,
    total: targets.length,
    currentPath: '',
    bytesDone,
    bytesTotal,
    filesDone,
    filesTotal,
    startedAt,
  })
  progress.close()

  return {
    folders: items.filter((item) => item.ok).length,
    attempted: targets.length,
    bytes: freed,
    failures,
    durationMs: Date.now() - startedAt,
    cancelled: control.cancelled,
    items,
  }
}

function runClean({ targets }) {
  return runRemoval(targets, (target, known, report) => removeTarget(target, state, tuning, known, report))
}

/**
 * Finds every app cache, log and temp folder on the machine, then measures
 * them a few at a time. The list is sent first so the tab fills in at once
 * and the sizes land as they are counted.
 */
async function runAppScan() {
  const startedAt = Date.now()
  const progress = makeProgressSink()
  const batch = makeBatcher('junk')

  progress.push({ done: 0, total: 0, currentPath: 'Looking for app caches' })
  const entries = await discoverJunk()
  send({ type: 'junk', items: entries })

  let reclaimable = 0
  let done = 0
  const measured = []

  for (let index = 0; index < entries.length; index += MEASURE_CONCURRENCY) {
    if (control.cancelled) break
    await state.wait()
    if (control.cancelled) break

    const chunk = entries.slice(index, index + MEASURE_CONCURRENCY)
    progress.push({ done, total: entries.length, currentPath: chunk[0].path })

    const sizes = await Promise.all(chunk.map((entry) => measureTree(entry.path, state, null, tuning)))
    if (control.cancelled) break

    sizes.forEach((size, offset) => {
      done += 1
      const entry = { ...chunk[offset], bytes: size.bytes, files: size.files, pending: false }
      reclaimable += size.bytes
      measured.push(entry)
      batch.push(entry)
    })
  }

  progress.push({ done: entries.length, total: entries.length, currentPath: '' })
  progress.close()
  batch.close()

  return {
    entries: measured.length,
    reclaimable,
    durationMs: Date.now() - startedAt,
    cancelled: control.cancelled,
  }
}

/** Empties app caches. The allow-list is discovered once, up front, and every path is checked against it. */
async function runAppClean({ targets }) {
  const discovered = await discoverJunk()
  return runRemoval(targets, (target, known, report) => emptyJunk(target, state, tuning, known, report, discovered))
}

/** Moves one project to another folder or drive, build output left behind. */
async function runMove({ source, destination }) {
  const startedAt = Date.now()
  const progress = makeProgressSink()
  progress.push({ done: 0, total: 1, currentPath: source, startedAt })
  const result = await moveProject(source, destination, state, (update) => {
    progress.push({ done: 0, total: 1, currentPath: update.currentPath, bytesDone: update.bytesDone, bytesTotal: update.bytesTotal, filesDone: update.filesDone, filesTotal: update.filesTotal, startedAt })
  }, tuning)
  progress.push({ done: 1, total: 1, currentPath: '', startedAt })
  progress.close()
  if (result.ok) send({ type: 'moved', source: result.source, destination: result.destination })
  return { ...result, durationMs: Date.now() - startedAt, cancelled: control.cancelled }
}

/** Measures the folders directly under a path, streaming each as it lands. */
async function runDriveScan({ dir }) {
  const startedAt = Date.now()
  const progress = makeProgressSink()
  const batch = makeBatcher('folders')
  progress.push({ done: 0, total: 0, currentPath: dir })
  let done = 0
  const { folders, looseBytes, looseFiles } = await measureChildren(dir, state, (folder) => {
    done += 1
    batch.push(folder)
    progress.push({ done, total: 0, currentPath: folder.path })
  }, tuning)
  progress.push({ done, total: done, currentPath: '' })
  progress.close()
  batch.close()
  return { dir, folders: folders.length, bytes: folders.reduce((sum, folder) => sum + folder.bytes, 0) + looseBytes, looseBytes, looseFiles, durationMs: Date.now() - startedAt, cancelled: control.cancelled }
}

/** Deletes folders picked from the drive view; main only sends paths that view reported. */
function runFolderClean({ targets }) {
  return runRemoval(targets, (target, known, report) => removeUserFolder(target, state, tuning, known, report))
}

/** Deletes folders an uninstalled program left behind; main only sends paths it offered. */
function runLeftoverClean({ targets }) {
  return runRemoval(targets, (target, known, report) => removeLeftover(target, state, tuning, known, report))
}

process.parentPort.on('message', async ({ data }) => {
  if (!data) return

  if (data.type === 'cancel') {
    control.cancelled = true
    control.paused = false
    return
  }
  if (data.type === 'pause') {
    control.paused = Boolean(data.paused)
    return
  }
  if (data.type === 'tuning') {
    if (data.tuning) tuning = data.tuning
    return
  }

  if (data.tuning) tuning = data.tuning

  try {
    const runners = {
      scan: runScan,
      clean: runClean,
      appScan: runAppScan,
      appClean: runAppClean,
      leftoverClean: runLeftoverClean,
      move: runMove,
      driveScan: runDriveScan,
      folderClean: runFolderClean,
    }
    const runner = runners[data.type]
    if (!runner) throw new Error(`unknown request '${data.type}'`)
    const summary = await runner(data)
    send({ type: 'done', summary })
  } catch (error) {
    send({ type: 'error', message: error && error.message ? error.message : String(error) })
  }
})
