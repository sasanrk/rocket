/**
 * Installed programs: the Add/Remove list, the Store's package database, and
 * what each program leaves behind when it goes.
 *
 * Uninstalling is the one thing here that runs somebody else's code, so the
 * rules are strict: the command always comes from a fresh registry read (never
 * from the renderer), a machine-wide program runs its uninstaller elevated
 * through the same UAC path as everything else, and leftover folders can only
 * be deleted if this module offered them first.
 */
const path = require('node:path')
const os = require('node:os')
const fsp = require('node:fs/promises')
const { measureTree, DEFAULT_TUNING } = require('./scanner.cjs')

const HOME = os.homedir()
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData'
const PROGRAM_FILES = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean)

/** Where leftovers live. Only direct children of these are ever considered. */
const LEFTOVER_ROOTS = [
  { root: APPDATA, label: 'Roaming app data' },
  { root: LOCALAPPDATA, label: 'Local app data' },
  { root: path.join(LOCALAPPDATA, 'Programs'), label: 'Per-user install' },
  { root: PROGRAMDATA, label: 'Shared app data' },
  ...PROGRAM_FILES.map((root) => ({ root, label: 'Program files' })),
  { root: HOME, label: 'Home folder' },
]

/** Publisher folders shared by many programs; a match there is checked one level deeper. */
const SHARED_PUBLISHER_DIRS = new Set(['microsoft', 'google', 'adobe', 'common files', 'windows', 'packages', 'programs', 'temp', 'jetbrains', 'mozilla'])

/** Never offered as a leftover, whatever the name matches. */
const PROTECTED_DIRS = new Set([
  'microsoft', 'windows', 'windowsapps', 'common files', 'internet explorer', 'windows defender', 'windows nt',
  'packages', 'temp', 'programs', 'microsoft shared', 'system32', 'desktop', 'documents', 'downloads', 'pictures',
  'videos', 'music', 'onedrive', 'appdata', '.ssh', '.gnupg', 'contacts', 'favorites', 'links', 'saved games', 'searches',
])

/**
 * Programs other software or hardware depends on. They can still be removed,
 * but the row says so first.
 */
const DEPENDENCY_PATTERNS = [
  /visual c\+\+/i, /\.net (framework|runtime|sdk|core)/i, /redistributable/i, /runtime/i, /\bsdk\b/i,
  /driver/i, /chipset/i, /graphics/i, /realtek/i, /intel\(r\)/i, /nvidia/i, /amd (software|radeon|chipset)/i,
  /windows (sdk|software development kit)/i, /webview2/i, /edge update/i, /java \d/i, /directx/i,
]

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\(x64\)|\(x86\)|\(64-bit\)|\(32-bit\)|64-bit|32-bit|\bx64\b|\bx86\b/g, '')
    .replace(/\bv?\d+(\.\d+)+\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The distinctive words of a program name — long enough not to match by accident. */
function nameTokens(name) {
  const stop = new Set(['the', 'for', 'and', 'app', 'desktop', 'application', 'setup', 'edition', 'version', 'windows', 'pro', 'free', 'client', 'tool', 'tools', 'suite', 'software', 'installer', 'launcher', 'user', 'machine', 'current', 'latest', 'stable', 'beta', 'preview', 'microsoft'])
  return normalise(name)
    .split(' ')
    .filter((word) => word.length >= 4 && /[a-z]/.test(word) && !stop.has(word))
}

function isDependency(program) {
  const haystack = `${program.name} ${program.publisher}`
  return DEPENDENCY_PATTERNS.some((pattern) => pattern.test(haystack))
}

/** "Microsoft.MicrosoftStickyNotes" reads better as "Microsoft Sticky Notes". */
function prettyStoreName(name) {
  const text = String(name || '')
  if (text.includes(' ') || !text.includes('.')) return text
  // The last segment that holds letters: "Microsoft.Ink.Handwriting.Main.en-US.1.0.1" -> "Main".
  const segments = text.split('.').filter((segment) => /[A-Za-z]{3,}/.test(segment))
  const last = segments.length > 0 ? segments[segments.length - 1] : text
  return last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').trim() || text
}

function decorate(raw) {
  return {
    id: raw.id,
    kind: raw.kind === 'store' ? 'store' : 'desktop',
    scope: raw.scope === 'machine' ? 'machine' : 'user',
    keyPath: raw.keyPath || '',
    keyName: raw.keyName || '',
    name: raw.kind === 'store' ? prettyStoreName(raw.name) : raw.name,
    publisher: raw.publisher || '',
    version: raw.version || '',
    installDate: raw.installDate || null,
    sizeBytes: Number(raw.sizeBytes) || 0,
    sizeMeasured: false,
    installLocation: raw.installLocation || '',
    icon: raw.icon || '',
    hasUninstaller: Boolean(raw.uninstallString || raw.quietUninstallString || raw.kind === 'store'),
    isMsi: Boolean(raw.isMsi),
    dependency: isDependency(raw),
  }
}

/** Cached for a minute: the Store part of the listing costs a couple of seconds. */
let cache = { at: 0, raw: [] }
const CACHE_MS = 60_000

async function listRaw(agent, { refresh = false } = {}) {
  if (!refresh && Date.now() - cache.at < CACHE_MS && cache.raw.length > 0) return cache.raw
  const list = await agent.call('programs', {}, 120_000)
  const raw = Array.isArray(list) ? list : [list].filter(Boolean)
  cache = { at: Date.now(), raw }
  return raw
}

async function listPrograms(agent, options) {
  const raw = await listRaw(agent, options)
  return raw.map(decorate).sort((a, b) => a.name.localeCompare(b.name))
}

async function findProgram(agent, id) {
  const raw = await listRaw(agent, { refresh: true })
  const match = raw.find((entry) => entry.id === id)
  return match ? { ...decorate(match), raw: match } : null
}

async function isDirectory(target) {
  try {
    return (await fsp.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Sizes for programs whose registry entry did not carry one, measured from
 * their install folder. A few at a time; the renderer asks for the ones it
 * is showing.
 */
async function measureSizes(agent, ids) {
  const raw = await listRaw(agent)
  const wanted = raw.filter((entry) => ids.includes(entry.id) && entry.installLocation)
  const result = {}
  const state = { cancelled: false }
  for (let index = 0; index < wanted.length; index += 4) {
    const chunk = wanted.slice(index, index + 4)
    const sizes = await Promise.all(
      chunk.map(async (entry) => {
        const location = entry.installLocation.replace(/^"|"$/g, '')
        if (!(await isDirectory(location))) return null
        const { bytes } = await measureTree(location, state, null, DEFAULT_TUNING)
        return bytes
      }),
    )
    chunk.forEach((entry, offset) => {
      if (sizes[offset] !== null) result[entry.id] = sizes[offset]
    })
  }
  return result
}

// ----------------------------------------------------------------- leftovers

/** Paths offered for deletion, per program id, so a delete can only echo an offer. */
const offered = new Map()

async function listDirectories(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name)
  } catch {
    return []
  }
}

function matches(dirName, tokens, fullName) {
  const dir = normalise(dirName)
  if (!dir || PROTECTED_DIRS.has(dir)) return false
  const compact = dir.replace(/\s/g, '')
  if (compact === fullName) return true
  return tokens.some((token) => compact === token || (token.length >= 5 && compact.includes(token) && compact.length <= token.length + 8))
}

/**
 * Folders a program left behind: its install folder if the uninstaller kept
 * it, and any top-level folder under the app-data roots that carries its
 * name. Publisher folders shared by many programs (Microsoft, Adobe…) are
 * looked into one level, never offered whole.
 */
async function findLeftovers(program) {
  const tokens = nameTokens(program.name)
  const fullName = normalise(program.name).replace(/\s/g, '')
  const found = new Map()
  const consider = async (target, reason) => {
    const key = target.toLowerCase()
    if (found.has(key) || !(await isDirectory(target))) return
    found.set(key, { path: target, reason })
  }

  if (program.installLocation) {
    const location = program.installLocation.replace(/^"|"$/g, '').replace(/[\\/]+$/, '')
    const base = path.basename(location).toLowerCase()
    // Never offer a whole root such as Program Files or a protected folder.
    if (location.split(path.sep).filter(Boolean).length >= 3 && !PROTECTED_DIRS.has(base)) {
      await consider(location, 'Install folder the uninstaller left behind')
    }
  }

  if (tokens.length > 0 || fullName.length >= 4) {
    for (const { root, label } of LEFTOVER_ROOTS) {
      for (const name of await listDirectories(root)) {
        const lower = name.toLowerCase()
        if (root === HOME && !lower.startsWith('.')) continue
        // A folder named after the publisher is looked into, unless it is also the program's own name.
        const publisherFolder = Boolean(program.publisher) && normalise(name) === normalise(program.publisher) && !matches(name, tokens, fullName)
        if (SHARED_PUBLISHER_DIRS.has(lower) || publisherFolder) {
          // A publisher folder: look one level in for the program itself.
          for (const child of await listDirectories(path.join(root, name))) {
            if (matches(child, tokens, fullName)) await consider(path.join(root, name, child), `${label} · ${name}`)
          }
          continue
        }
        if (matches(name, tokens, fullName)) await consider(path.join(root, name), label)
      }
    }
  }

  const state = { cancelled: false }
  const entries = []
  for (const entry of found.values()) {
    const { bytes, files } = await measureTree(entry.path, state, null, DEFAULT_TUNING)
    entries.push({ path: entry.path, bytes, files, reason: entry.reason })
  }
  entries.sort((a, b) => b.bytes - a.bytes)
  offered.set(program.id, new Set(entries.map((entry) => entry.path.toLowerCase())))
  return entries
}

/** Only paths this module offered for that program, verbatim, may be deleted. */
function acceptLeftovers(programId, paths) {
  const allowed = offered.get(programId)
  if (!allowed) return []
  return (Array.isArray(paths) ? paths : []).filter((candidate) => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false
    const normalized = path.normalize(candidate).replace(/[\\/]+$/, '')
    if (normalized.split(path.sep).includes('..')) return false
    if (normalized.split(path.sep).filter(Boolean).length < 3) return false
    return allowed.has(normalized.toLowerCase())
  })
}

// ----------------------------------------------------------------- uninstall

/** Splits `"C:\Program Files\X\unins.exe" /SILENT` into a file and its arguments. */
function parseCommand(command) {
  const text = String(command || '').trim()
  if (!text) return null
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1)
    if (end < 0) return null
    return { file: text.slice(1, end), args: text.slice(end + 1).trim() }
  }
  const exe = text.match(/^(.*?\.exe)\b\s*(.*)$/i)
  if (exe) return { file: exe[1], args: exe[2].trim() }
  const [file, ...rest] = text.split(/\s+/)
  return { file, args: rest.join(' ') }
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Works out what to run for a program: the Store's own remover, `msiexec /x`
 * for Windows Installer packages, or the uninstaller the program registered
 * (quiet variant first when it has one).
 */
async function planUninstall(program, { quiet = true } = {}) {
  const raw = program.raw
  if (program.kind === 'store') return { mode: 'store', package: raw.keyName }

  const productCode = String(raw.uninstallString || '').match(/\{[0-9A-F-]{36}\}/i)
  if (raw.isMsi && productCode) {
    return { mode: 'msi', file: 'msiexec.exe', args: `/x ${productCode[0]}${quiet ? ' /passive' : ''}` }
  }

  const command = (quiet && raw.quietUninstallString) || raw.uninstallString
  const parsed = parseCommand(command)
  if (!parsed) return { mode: 'none' }
  const missing = !/^msiexec(\.exe)?$/i.test(parsed.file) && !(await fsp.stat(parsed.file).then(() => true, () => false))
  return { mode: 'exe', file: parsed.file, args: parsed.args, missing }
}

/**
 * Runs the uninstaller and waits for it. Machine-wide programs need
 * administrator rights, so they go through the elevated batch runner; a
 * per-user program runs through the helper without a prompt.
 */
async function uninstall(agent, runElevated, program, options = {}) {
  const plan = await planUninstall(program, options)
  if (plan.mode === 'none') return { ok: false, message: 'This program did not register an uninstaller', canForce: true }
  if (plan.mode === 'exe' && plan.missing) {
    return { ok: false, message: `The uninstaller is missing: ${plan.file}`, canForce: true }
  }

  try {
    if (plan.mode === 'store') {
      await agent.call('removeAppx', { package: plan.package }, 300_000)
    } else if (program.scope === 'user' && plan.mode === 'exe') {
      const result = await agent.call('run', { file: plan.file, arguments: plan.args, timeoutSeconds: 900 }, 920_000)
      if (!result.finished) return { ok: false, message: 'The uninstaller is still running; check again once it closes', canForce: false }
    } else {
      const line = plan.args
        ? `Start-Process -FilePath ${quote(plan.file)} -ArgumentList ${quote(plan.args)} -Wait`
        : `Start-Process -FilePath ${quote(plan.file)} -Wait`
      await runElevated([line])
    }
  } catch (error) {
    return { ok: false, message: error.message, canForce: true }
  }

  return { ok: true }
}

/**
 * Takes a program off the list when its uninstaller is gone or broken: the
 * registry entry is removed and the install folder is offered as a leftover.
 * The program's files are never touched here — that is the leftovers step,
 * which the user reviews.
 */
async function forceRemove(agent, runElevated, program) {
  if (program.kind === 'store') return { ok: false, message: 'Store apps are removed by Windows itself; try again' }
  const keyPath = program.keyPath
  if (!/^HKEY_(LOCAL_MACHINE|CURRENT_USER)\\Software\\(WOW6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\]+$/i.test(keyPath)) {
    return { ok: false, message: 'That registry entry is not one this app will remove' }
  }
  try {
    if (program.scope === 'user') {
      await agent.call('removeUninstallKey', { keyPath })
    } else {
      await runElevated([`Remove-Item -Path ${quote(`Registry::${keyPath}`)} -Recurse`])
    }
  } catch (error) {
    return { ok: false, message: error.message }
  }
  return { ok: true }
}

/**
 * Deletes a leftover folder outright. The main process has already checked
 * the path against what was offered; this is the structural guard behind it.
 */
async function removeLeftover(target, state, tuning = DEFAULT_TUNING, known = null, onProgress = null) {
  const { removeTree } = require('./scanner.cjs')
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    return { ok: false, bytes: 0, files: 0, error: 'Refused: not an absolute path', locked: [] }
  }
  const normalized = path.normalize(target).replace(/[\\/]+$/, '')
  const segments = normalized.split(path.sep).filter(Boolean)
  if (segments.includes('..') || segments.length < 3 || PROTECTED_DIRS.has(segments[segments.length - 1].toLowerCase())) {
    return { ok: false, bytes: 0, files: 0, error: 'Refused: not a folder this app will delete', locked: [] }
  }
  if (!(await isDirectory(normalized))) return { ok: true, bytes: 0, files: 0, error: null, locked: [] }

  const measured = known && known.bytes > 0 ? known : await measureTree(normalized, state, null, tuning)
  const { removed, stubborn } = await removeTree(normalized, state, tuning.deleteBatch || DEFAULT_TUNING.deleteBatch, onProgress)
  const gone = !(await isDirectory(normalized))
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

module.exports = { listPrograms, findProgram, measureSizes, findLeftovers, acceptLeftovers, uninstall, forceRemove, removeLeftover, nameTokens, normalise }
