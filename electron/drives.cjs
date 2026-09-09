/**
 * What is taking the space on a drive — any drive, not just the one Windows
 * lives on — and the guard behind deleting a folder from that view.
 *
 * The view is a simple one: the folders directly under a path, each measured
 * whole, biggest first. Drilling into one measures its children the same
 * way. Deleting is allowed only for folders the view itself reported, and
 * never for anything Windows or an installer owns.
 */
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { measureTree, removeTree, DEFAULT_TUNING } = require('./scanner.cjs')

/** Folders no drive view will ever offer to delete, at any depth. */
const SYSTEM_SEGMENTS = new Set([
  'windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'system volume information',
  'recovery', 'perflogs', 'boot', 'efi', 'windowsapps', '$windows.~bt', '$windows.~ws', 'windows.old', 'msocache',
  'config.msi', 'documents and settings', 'appdata',
])

const HOME = os.homedir().toLowerCase()

/** Drive letters that answer, with their totals. */
async function listDrives() {
  const drives = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    try {
      const stat = await fsp.statfs(root)
      const total = stat.blocks * stat.bsize
      if (!total) continue
      drives.push({ root, totalBytes: total, freeBytes: stat.bavail * stat.bsize, system: root.toUpperCase().startsWith((process.env.SystemDrive || 'C:').toUpperCase()) })
    } catch {
      /* not a drive that answers */
    }
  }
  return drives
}

function segmentsOf(target) {
  return path.normalize(target).replace(/[\\/]+$/, '').split(path.sep).filter(Boolean)
}

/** True for folders Windows, installers or the user profile itself own. */
function isProtected(target) {
  const segments = segmentsOf(target)
  if (segments.length <= 1) return true
  const lower = target.toLowerCase().replace(/[\\/]+$/, '')
  if (lower === HOME) return true
  // "Users" and "Users\\name" are protected; anything deeper is the user's own.
  if (segments.length <= 3 && segments[1].toLowerCase() === 'users') return true
  return segments.slice(1).some((segment) => SYSTEM_SEGMENTS.has(segment.toLowerCase()))
}

/**
 * The folders directly under `dir`, measured. `onFolder` fires per folder as
 * sizes land so the view fills in while the big ones are still counting.
 */
async function measureChildren(dir, state, onFolder, tuning = DEFAULT_TUNING) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Cannot read ${dir}: ${error.code === 'EPERM' || error.code === 'EACCES' ? 'access denied' : error.message}`)
  }

  const dirs = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  const files = entries.filter((entry) => entry.isFile())
  let looseBytes = 0
  for (let index = 0; index < files.length; index += tuning.fileBatch) {
    const chunk = files.slice(index, index + tuning.fileBatch)
    const sizes = await Promise.all(chunk.map((entry) => fsp.stat(path.join(dir, entry.name)).then((stat) => stat.size, () => 0)))
    sizes.forEach((size) => {
      looseBytes += size
    })
  }

  const results = []
  for (let index = 0; index < dirs.length; index += 4) {
    if (state.cancelled) break
    const chunk = dirs.slice(index, index + 4)
    const measured = await Promise.all(
      chunk.map(async (entry) => {
        const full = path.join(dir, entry.name)
        const { bytes, files: count } = await measureTree(full, state, null, tuning)
        return { path: full, name: entry.name, bytes, files: count, protected: isProtected(full) }
      }),
    )
    measured.forEach((folder) => {
      results.push(folder)
      if (onFolder) onFolder(folder)
    })
  }

  return { folders: results, looseBytes, looseFiles: files.length }
}

/** Paths the view reported, per scanned directory, so a delete can only echo one. */
const offered = new Map()

function remember(dir, folders) {
  offered.set(dir.toLowerCase().replace(/[\\/]+$/, ''), new Set(folders.map((folder) => folder.path.toLowerCase())))
}

function acceptFolders(paths) {
  const known = new Set()
  offered.forEach((set) => set.forEach((entry) => known.add(entry)))
  return (Array.isArray(paths) ? paths : []).filter((candidate) => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false
    const normalized = path.normalize(candidate).replace(/[\\/]+$/, '')
    if (normalized.split(path.sep).includes('..')) return false
    if (isProtected(normalized)) return false
    return known.has(normalized.toLowerCase())
  })
}

/** Deletes a folder chosen from the drive view; the worker's own guard. */
async function removeUserFolder(target, state, tuning = DEFAULT_TUNING, known = null, onProgress = null) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || isProtected(target)) {
    return { ok: false, bytes: 0, files: 0, error: 'Refused: not a folder this app will delete', locked: [] }
  }
  const normalized = path.normalize(target).replace(/[\\/]+$/, '')
  const present = await fsp.stat(normalized).then((stat) => stat.isDirectory(), () => false)
  if (!present) return { ok: true, bytes: 0, files: 0, error: null, locked: [] }

  const measured = known && known.bytes > 0 ? known : await measureTree(normalized, state, null, tuning)
  const { removed, stubborn } = await removeTree(normalized, state, tuning.deleteBatch || DEFAULT_TUNING.deleteBatch, onProgress)
  const gone = !(await fsp.stat(normalized).then(() => true, () => false))
  if (gone) return { ok: true, bytes: measured.bytes, files: removed, error: null, locked: [] }
  const after = await measureTree(normalized, state, null, tuning)
  return {
    ok: false,
    bytes: Math.max(0, measured.bytes - after.bytes),
    files: removed,
    error: state.cancelled ? 'Stopped part-way through' : `${after.files} file${after.files === 1 ? '' : 's'} in use by another program`,
    locked: stubborn.slice(0, 12).map((entry) => entry.path),
  }
}

module.exports = { listDrives, measureChildren, isProtected, remember, acceptFolders, removeUserFolder }
