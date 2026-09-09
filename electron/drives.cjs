/**
 * What is taking the space on a drive — any drive, not just the one Windows
 * lives on — and the guard behind deleting a folder from that view.
 *
 * Measuring happens once per folder tree, in the PowerShell helper's
 * compiled walker (see Get-TreeSizes in agent.ps1), and every folder size it
 * produces is kept here. Opening a folder in the view is then a lookup, not
 * another walk; only a folder the walk did not keep children for (small and
 * deep) is measured on its own, which is quick because it is small.
 *
 * Deleting is allowed only for folders the cache knows, and never for
 * anything Windows or an installer owns.
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

/** How long a measurement stays trusted before the view measures again on its own. */
const CACHE_TTL_MS = 30 * 60 * 1000

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

function normalize(target) {
  const trimmed = path.normalize(target).replace(/[\\/]+$/, '')
  // "D:" alone is the drive root, which needs its backslash back.
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed
}

function keyOf(target) {
  return normalize(target).toLowerCase()
}

function parentOf(target) {
  const normalized = normalize(target)
  if (/^[A-Za-z]:\\$/.test(normalized)) return null
  const parent = path.dirname(normalized)
  return normalize(parent)
}

function segmentsOf(target) {
  return normalize(target).replace(/[\\/]+$/, '').split(path.sep).filter(Boolean)
}

/** True for folders Windows, installers or the user profile itself own. */
function isProtected(target) {
  const segments = segmentsOf(target)
  if (segments.length <= 1) return true
  const lower = keyOf(target)
  if (lower === HOME) return true
  // "Users" and "Users\\name" are protected; anything deeper is the user's own.
  if (segments.length <= 3 && segments[1].toLowerCase() === 'users') return true
  return segments.slice(1).some((segment) => SYSTEM_SEGMENTS.has(segment.toLowerCase()))
}

/**
 * Every folder size the helper has reported, keyed by lower-cased path.
 * A node knows whether all of its children were kept (`complete`), which is
 * what decides whether opening it is a lookup or a fresh, small measurement.
 */
class DriveCache {
  constructor() {
    this.nodes = new Map()
    /** Folders measured as a whole: key → measuredAt. */
    this.roots = new Map()
  }

  /** Stores one Get-TreeSizes result taken at `scanRoot` with the given kept depth. */
  ingest(scanRoot, result, keepDepth) {
    const rootKey = keyOf(scanRoot)
    const now = Date.now()
    // Anything previously known under this root is replaced wholesale.
    for (const key of [...this.nodes.keys()]) {
      if (key === rootKey || key.startsWith(`${rootKey.replace(/\\$/, '')}\\`)) this.nodes.delete(key)
    }
    this.nodes.set(rootKey, {
      path: normalize(scanRoot),
      name: path.basename(normalize(scanRoot)) || normalize(scanRoot),
      bytes: Number(result.bytes) || 0,
      files: Number(result.files) || 0,
      looseBytes: Number(result.looseBytes) || 0,
      looseFiles: Number(result.looseFiles) || 0,
      complete: true,
      measuredAt: now,
    })
    for (const node of result.nodes || []) {
      const depth = Number(node.d) || 0
      this.nodes.set(keyOf(node.p), {
        path: normalize(node.p),
        name: path.basename(normalize(node.p)),
        bytes: Number(node.b) || 0,
        files: Number(node.f) || 0,
        looseBytes: Number(node.l) || 0,
        looseFiles: Number(node.n) || 0,
        // Children of a node at the kept depth were only kept when big.
        complete: depth < keepDepth,
        measuredAt: now,
      })
    }
    this.roots.set(rootKey, now)
  }

  /** The folders directly under `dir`, if the cache holds all of them and they are fresh. */
  childrenOf(dir) {
    const key = keyOf(dir)
    const node = this.nodes.get(key)
    if (!node || !node.complete || Date.now() - node.measuredAt > CACHE_TTL_MS) return null
    const prefix = key.replace(/\\$/, '') + '\\'
    const folders = []
    for (const [childKey, child] of this.nodes) {
      if (!childKey.startsWith(prefix)) continue
      if (childKey.slice(prefix.length).includes('\\')) continue
      folders.push({ path: child.path, name: child.name, bytes: child.bytes, files: child.files, protected: isProtected(child.path) })
    }
    folders.sort((a, b) => b.bytes - a.bytes)
    return { folders, looseBytes: node.looseBytes, looseFiles: node.looseFiles, measuredAt: node.measuredAt, bytes: node.bytes }
  }

  /** True when a path was reported by a measurement, whatever its depth. */
  knows(target) {
    return this.nodes.has(keyOf(target))
  }

  /** A folder is gone: drop its subtree and take its bytes off every ancestor. */
  forget(target, bytes, files) {
    const key = keyOf(target)
    const node = this.nodes.get(key)
    const removedBytes = node ? node.bytes : bytes || 0
    const removedFiles = node ? node.files : files || 0
    for (const candidate of [...this.nodes.keys()]) {
      if (candidate === key || candidate.startsWith(`${key}\\`)) this.nodes.delete(candidate)
    }
    let parent = parentOf(target)
    while (parent) {
      const ancestor = this.nodes.get(keyOf(parent))
      if (ancestor) {
        ancestor.bytes = Math.max(0, ancestor.bytes - removedBytes)
        ancestor.files = Math.max(0, ancestor.files - removedFiles)
      }
      parent = parentOf(parent)
    }
  }

  /** Empties the cache for one drive, so "Measure again" starts clean. */
  drop(dir) {
    const key = keyOf(dir)
    for (const candidate of [...this.nodes.keys()]) {
      if (candidate === key || candidate.startsWith(`${key.replace(/\\$/, '')}\\`)) this.nodes.delete(candidate)
    }
    this.roots.delete(key)
  }
}

const cache = new DriveCache()

/** Which of the given paths a deletion may touch: known to the cache, not protected. */
function acceptFolders(paths) {
  return (Array.isArray(paths) ? paths : []).filter((candidate) => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false
    const normalized = normalize(candidate)
    if (normalized.split(path.sep).includes('..')) return false
    if (isProtected(normalized)) return false
    return cache.knows(normalized)
  })
}

/** Deletes a folder chosen from the drive view; the worker's own guard. */
async function removeUserFolder(target, state, tuning = DEFAULT_TUNING, known = null, onProgress = null) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || isProtected(target)) {
    return { ok: false, bytes: 0, files: 0, error: 'Refused: not a folder this app will delete', locked: [] }
  }
  const normalized = normalize(target)
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

module.exports = { listDrives, isProtected, cache, normalize, acceptFolders, removeUserFolder, CACHE_TTL_MS }
