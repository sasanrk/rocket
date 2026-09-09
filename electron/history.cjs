/**
 * A durable log of everything Reclaim has done to this machine.
 *
 * Deletions are not reversible once they start, so the least the app can do is
 * remember exactly what went, when, and how much it bought back.
 */
const path = require('node:path')
const fsp = require('node:fs/promises')

const MAX_ENTRIES = 400
/** Per-entry folder detail, capped so one huge cleanup cannot bloat the file. */
const MAX_ITEMS = 60

let file = null
let queue = Promise.resolve()

function configure(userDataPath) {
  file = path.join(userDataPath, 'history.json')
}

async function readAll() {
  if (!file) return []
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Serialised through a promise chain: two cleanups finishing at once would
 * otherwise read the same file and one would overwrite the other's entry.
 */
function write(mutate) {
  queue = queue.then(async () => {
    const current = await readAll()
    const next = mutate(current).slice(0, MAX_ENTRIES)
    if (!file) return next
    try {
      await fsp.writeFile(file, JSON.stringify(next, null, 2))
    } catch (error) {
      console.warn('[reclaim] could not write history', error.message)
    }
    return next
  })
  return queue
}

function add(entry) {
  const record = {
    id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ...entry,
    items: Array.isArray(entry.items) ? entry.items.slice(0, MAX_ITEMS) : [],
  }
  if (Array.isArray(entry.items) && entry.items.length > MAX_ITEMS) {
    record.itemsTruncated = entry.items.length - MAX_ITEMS
  }
  return write((current) => [record, ...current]).then(() => record)
}

function list() {
  return readAll()
}

function clear() {
  return write(() => [])
}

/** Totals for the header strip: what this machine has got back overall. */
async function totals() {
  const entries = await readAll()
  let bytes = 0
  let folders = 0
  let cleanups = 0
  entries.forEach((entry) => {
    if (entry.type !== 'clean') return
    cleanups += 1
    bytes += entry.bytes || 0
    folders += entry.folders || 0
  })
  return { bytes, folders, cleanups, entries: entries.length }
}

module.exports = { configure, add, list, clear, totals }
