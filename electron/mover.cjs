/**
 * Moves a project to another drive without its build output.
 *
 * Cross-drive, the copy goes through robocopy: it is the fastest thing on
 * Windows for tens of thousands of small files, keeps timestamps and
 * attributes, and copes with paths longer than 260 characters. Folders the
 * tooling rebuilds — node_modules, build, dist, .gradle and friends — are
 * skipped by name at every depth, so a 4 GB project usually travels as
 * 40 MB of source. The source is deleted only once the destination has been
 * measured and matches, and it is deleted whole, build output included, which
 * is where the freed space comes from.
 *
 * On the same drive the move is a rename, which is instant, followed by
 * removing the build folders at the destination.
 */
const fsp = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { measureTree, removeTree, DEFAULT_TUNING } = require('./scanner.cjs')

/** Folders never carried across: everything an install or a build puts back. */
const EXCLUDED_NAMES = [
  'node_modules', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.angular', '.astro',
  '.vite', '.output', '.expo', '.docusaurus', '.vercel', '.netlify', '.dart_tool', 'dist', 'build', 'out',
  'coverage', 'storybook-static', '.gradle', '.cxx', '.kotlin', 'captures', 'Pods', '__pycache__', '.venv',
  'venv', 'target', 'bin', 'obj', '.pytest_cache', '.mypy_cache', '.nyc_output', 'tmp', '.tmp',
]
const EXCLUDED = new Set(EXCLUDED_NAMES.map((name) => name.toLowerCase()))

async function isDirectory(target) {
  try {
    return (await fsp.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function exists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

/** Measures a tree while skipping the excluded folder names at every level. */
async function measureExcluding(dir, state, tuning = DEFAULT_TUNING) {
  if (state.cancelled) return { bytes: 0, files: 0 }
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return { bytes: 0, files: 0 }
  }
  let bytes = 0
  let files = 0
  const dirs = []
  const fileNames = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (!EXCLUDED.has(entry.name.toLowerCase())) dirs.push(path.join(dir, entry.name))
    } else if (entry.isFile()) {
      fileNames.push(path.join(dir, entry.name))
    }
  }
  for (let index = 0; index < fileNames.length; index += tuning.fileBatch) {
    const chunk = fileNames.slice(index, index + tuning.fileBatch)
    const stats = await Promise.all(chunk.map((file) => fsp.stat(file).then((stat) => stat.size, () => 0)))
    stats.forEach((size) => {
      bytes += size
      files += 1
    })
  }
  for (let index = 0; index < dirs.length; index += tuning.dirBatch) {
    const chunk = dirs.slice(index, index + tuning.dirBatch)
    const results = await Promise.all(chunk.map((child) => measureExcluding(child, state, tuning)))
    results.forEach((result) => {
      bytes += result.bytes
      files += result.files
    })
  }
  return { bytes, files }
}

function driveOf(target) {
  const match = path.resolve(target).match(/^([A-Za-z]:)/)
  return match ? match[1].toUpperCase() : ''
}

/**
 * What a move would do, before it does it: sizes, what stays behind, whether
 * the destination has room. The dialog shows this; the job re-checks it.
 */
async function planMove(source, destinationParent, state = { cancelled: false }) {
  const resolvedSource = path.resolve(source)
  const resolvedParent = path.resolve(destinationParent)
  const destination = path.join(resolvedParent, path.basename(resolvedSource))

  if (!(await isDirectory(resolvedSource))) return { ok: false, message: 'The project folder no longer exists' }
  if (!(await isDirectory(resolvedParent))) return { ok: false, message: 'The destination folder does not exist' }
  const lowerSource = resolvedSource.toLowerCase()
  const lowerDest = destination.toLowerCase()
  if (lowerDest === lowerSource) return { ok: false, message: 'That is where the project already is' }
  if (lowerDest.startsWith(`${lowerSource}${path.sep}`)) return { ok: false, message: 'A project cannot be moved inside itself' }
  if (await exists(destination)) return { ok: false, message: `${destination} already exists` }

  const carried = await measureExcluding(resolvedSource, state)
  const whole = await measureTree(resolvedSource, state, null, DEFAULT_TUNING)
  const sameDrive = driveOf(resolvedSource) === driveOf(destination)

  let freeBytes = null
  try {
    const stat = await fsp.statfs(resolvedParent)
    freeBytes = stat.bavail * stat.bsize
  } catch {
    /* an unusual filesystem; the copy itself will say if it runs out */
  }
  const fits = sameDrive || freeBytes === null || freeBytes > carried.bytes * 1.05 + 64 * 1024 * 1024

  return {
    ok: fits,
    message: fits ? undefined : `Only ${Math.round(freeBytes / 1048576)} MB free at the destination`,
    source: resolvedSource,
    destination,
    sameDrive,
    carriedBytes: carried.bytes,
    carriedFiles: carried.files,
    leftBehindBytes: Math.max(0, whole.bytes - carried.bytes),
    totalBytes: whole.bytes,
    freeBytes,
    excluded: EXCLUDED_NAMES,
  }
}

/** Runs robocopy and reports bytes as each file lands. */
function robocopy(source, destination, onFile) {
  return new Promise((resolve, reject) => {
    const args = [
      source, destination,
      '/E', '/COPY:DAT', '/DCOPY:DAT', '/XJ', '/R:2', '/W:1', '/MT:16',
      '/NP', '/NJH', '/NJS', '/NDL', '/NC', '/BYTES',
      '/XD', ...EXCLUDED_NAMES,
    ]
    const child = spawn('robocopy.exe', args, { windowsHide: true })
    let remainder = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      remainder += String(chunk)
      const lines = remainder.split(/\r?\n/)
      remainder = lines.pop() || ''
      for (const line of lines) {
        // With /NC and /BYTES each file is "<spaces><bytes><tab><path>".
        const match = line.match(/^\s*(\d+)\s+(.+)$/)
        if (match) onFile(Number(match[1]), match[2].trim())
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      // robocopy: 0-7 are success flags, 8 and above mean something failed.
      if (code !== null && code < 8) resolve(code)
      else reject(new Error(stderr.trim().split('\n')[0] || `robocopy failed (exit ${code})`))
    })
  })
}

/**
 * The move itself. `onProgress` receives {bytesDone, filesDone, currentPath}.
 * Returns what happened in the shape the history log keeps.
 */
async function moveProject(source, destinationParent, state, onProgress, tuning = DEFAULT_TUNING) {
  const plan = await planMove(source, destinationParent, state)
  if (!plan.ok) return { ok: false, error: plan.message, freed: 0, moved: 0 }
  if (state.cancelled) return { ok: false, error: 'Cancelled before anything moved', freed: 0, moved: 0 }

  const report = (bytesDone, filesDone, currentPath) => {
    if (onProgress) onProgress({ bytesDone, filesDone, currentPath, bytesTotal: plan.carriedBytes, filesTotal: plan.carriedFiles })
  }

  if (plan.sameDrive) {
    // A rename is instant; the build folders then go from the new location.
    try {
      await fsp.rename(plan.source, plan.destination)
    } catch (error) {
      return { ok: false, error: `Could not rename: ${error.message}`, freed: 0, moved: 0 }
    }
    let freed = 0
    await removeBuildFolders(plan.destination, state, tuning, (bytes) => {
      freed += bytes
    })
    report(plan.carriedBytes, plan.carriedFiles, plan.destination)
    return { ok: true, source: plan.source, destination: plan.destination, moved: plan.carriedBytes, freed, sameDrive: true }
  }

  let bytesDone = 0
  let filesDone = 0
  try {
    await robocopy(plan.source, plan.destination, (bytes, file) => {
      bytesDone += bytes
      filesDone += 1
      report(Math.min(bytesDone, plan.carriedBytes), filesDone, file)
    })
  } catch (error) {
    return { ok: false, error: error.message, freed: 0, moved: bytesDone, destination: plan.destination, partial: true }
  }

  if (state.cancelled) {
    return { ok: false, error: 'Stopped after copying; the original is untouched and the copy is left at the destination', freed: 0, moved: bytesDone, destination: plan.destination, partial: true }
  }

  // Trust nothing until the destination measures the same as what was meant to travel.
  const copied = await measureExcluding(plan.destination, state, tuning)
  if (copied.files !== plan.carriedFiles || copied.bytes !== plan.carriedBytes) {
    return {
      ok: false,
      error: `The copy does not match (${copied.files} of ${plan.carriedFiles} files); the original is untouched`,
      freed: 0,
      moved: copied.bytes,
      destination: plan.destination,
      partial: true,
    }
  }

  report(plan.carriedBytes, plan.carriedFiles, 'Removing the original')
  const { stubborn } = await removeTree(plan.source, state, tuning.deleteBatch || DEFAULT_TUNING.deleteBatch, null)
  const leftover = (await isDirectory(plan.source)) ? await measureTree(plan.source, state, null, tuning) : { bytes: 0, files: 0 }
  const freed = Math.max(0, plan.totalBytes - leftover.bytes)

  return {
    ok: true,
    source: plan.source,
    destination: plan.destination,
    moved: plan.carriedBytes,
    freed,
    sameDrive: false,
    originalLeftBehind: leftover.files > 0 ? `${leftover.files} file${leftover.files === 1 ? '' : 's'} in use stayed behind at the old location` : null,
    locked: stubborn.slice(0, 12).map((entry) => entry.path),
  }
}

/** Deletes every excluded-by-name folder under `dir`, reporting bytes freed. */
async function removeBuildFolders(dir, state, tuning, onFreed) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (EXCLUDED.has(entry.name.toLowerCase())) {
      const measured = await measureTree(full, state, null, tuning)
      await removeTree(full, state, tuning.deleteBatch || DEFAULT_TUNING.deleteBatch, null)
      onFreed(measured.bytes)
    } else {
      await removeBuildFolders(full, state, tuning, onFreed)
    }
  }
}

module.exports = { planMove, moveProject, measureExcluding, EXCLUDED_NAMES }
