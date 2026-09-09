/**
 * Everything Reclaim knows about the machine it is running on.
 *
 * Windows will not hand a plain Node process per-process CPU time, so this
 * module keeps one PowerShell helper alive (see agent.ps1) and talks JSON to
 * it. Starting PowerShell costs ~1s; every snapshot after that costs ~100ms,
 * which is what makes a live process list affordable on a four-core desktop.
 */
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const path = require('node:path')
const os = require('node:os')
const fsp = require('node:fs/promises')

// PowerShell cannot run a script from inside an asar archive, so the packaged
// build unpacks this one (see build.asarUnpack) and we point at the real file.
const AGENT = path.join(__dirname, 'agent.ps1').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
const REQUEST_TIMEOUT = 30_000

/** Names worth resolving a command line for — a bare "node" tells you nothing. */
const DETAILED = ['node.exe', 'java.exe', 'javaw.exe', 'bun.exe', 'deno.exe', 'python.exe']

const GROUPS = [
  {
    id: 'node',
    label: 'Node & tooling',
    names: ['node', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno', 'esbuild', 'tsserver', 'rollup', 'nodemon'],
  },
  {
    id: 'build',
    label: 'Builds & Android',
    names: ['java', 'javaw', 'gradle', 'kotlin-daemon', 'adb', 'qemu-system-x86_64', 'emulator', 'msbuild', 'cl', 'link'],
  },
  {
    id: 'editor',
    label: 'Editors & IDEs',
    names: [
      'code', 'cursor', 'devenv', 'idea64', 'studio64', 'phpstorm64', 'webstorm64', 'pycharm64',
      'rider64', 'sublime_text', 'notepad++', 'claude', 'electron',
    ],
  },
  { id: 'browser', label: 'Browsers', names: ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'] },
  {
    id: 'security',
    label: 'Antivirus & security',
    names: ['msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray', 'mpcmdrun', 'mssense', 'avp', 'avgui'],
  },
  {
    id: 'system',
    label: 'Windows',
    names: [
      'system', 'idle', 'registry', 'memory compression', 'smss', 'csrss', 'wininit', 'winlogon', 'services',
      'lsass', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'sihost', 'ctfmon', 'audiodg', 'runtimebroker',
      'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'taskhostw', 'wmiprvse', 'conhost',
      'dllhost', 'spoolsv', 'searchindexer', 'wudfhost', 'powershell', 'pwsh', 'cmd', 'winlogbeat',
    ],
  },
]

function groupFor(name) {
  const lower = name.toLowerCase()
  for (const group of GROUPS) {
    if (group.names.includes(lower)) return group.id
  }
  return 'other'
}

const GROUP_LABELS = Object.fromEntries(GROUPS.map((group) => [group.id, group.label]))
GROUP_LABELS.other = 'Other'

class SystemAgent {
  constructor() {
    this.child = null
    this.pending = new Map()
    this.seq = 0
    this.starting = null
    this.stopped = false
  }

  async ensure() {
    if (this.child) return this.child
    if (this.starting) return this.starting

    this.starting = new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', AGENT],
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
        )
      } catch (error) {
        this.starting = null
        reject(error)
        return
      }

      child.on('error', (error) => {
        this.starting = null
        this.failAll(error)
        reject(error)
      })

      child.on('exit', () => {
        this.child = null
        this.starting = null
        this.failAll(new Error('The system helper stopped; it will restart on the next request'))
      })

      // stderr from PowerShell means the helper itself is broken, so surface it
      // rather than letting requests time out silently.
      child.stderr.on('data', (chunk) => console.warn('[reclaim] agent:', String(chunk).trim()))

      readline.createInterface({ input: child.stdout }).on('line', (line) => this.receive(line))

      this.child = child
      this.starting = null
      resolve(child)
    })

    return this.starting
  }

  receive(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      console.warn('[reclaim] agent sent a non-JSON line:', line.slice(0, 200))
      return
    }
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.data)
    else entry.reject(new Error(message.error || 'The system helper reported a failure'))
  }

  failAll(error) {
    this.pending.forEach((entry) => {
      clearTimeout(entry.timer)
      entry.reject(error)
    })
    this.pending.clear()
  }

  /** `timeoutMs` is for the few operations that legitimately take minutes, such as waiting on an uninstaller. */
  async call(op, extra = {}, timeoutMs = REQUEST_TIMEOUT) {
    if (this.stopped) throw new Error('The app is shutting down')
    const child = await this.ensure()
    const id = String((this.seq += 1))

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The system helper did not answer '${op}' in time`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, op, ...extra })}\n`)
    })
  }

  stop() {
    this.stopped = true
    this.failAll(new Error('Reclaim is shutting down'))
    if (this.child) {
      try {
        this.child.stdin.end()
      } catch {
        /* the pipe may already be gone */
      }
      this.child.kill()
      this.child = null
    }
  }
}

const agent = new SystemAgent()
/**
 * A second helper for the slow, rare operations — listing installed
 * programs takes ten seconds or more the first time, and waiting on an
 * uninstaller takes as long as the uninstaller does. On the main helper that
 * would stall every process snapshot behind it.
 */
const slowAgent = new SystemAgent()

async function diskUsage() {
  const roots = new Set()
  // Only the drive letters that actually answer — probing A..Z would stall on
  // empty optical and card drives.
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    roots.add(`${letter}:\\`)
  }
  const results = await Promise.all(
    [...roots].map(async (root) => {
      try {
        const stat = await fsp.statfs(root)
        const total = stat.blocks * stat.bsize
        if (!total) return null
        return { root, totalBytes: total, freeBytes: stat.bavail * stat.bsize }
      } catch {
        return null
      }
    }),
  )
  return results.filter(Boolean)
}

/**
 * One reading of the whole machine: CPU, memory, disks and every process,
 * grouped so a developer can tell their own builds apart from Windows.
 */
async function snapshot({ withCommandLines = true, ownPids = [] } = {}) {
  const data = await agent.call('snapshot')

  let commandLines = {}
  if (withCommandLines) {
    const wanted = DETAILED.filter((name) =>
      data.processes.some((process) => `${process.name.toLowerCase()}.exe` === name),
    )
    if (wanted.length > 0) {
      try {
        commandLines = await agent.call('commandLines', { names: wanted })
      } catch (error) {
        console.warn('[reclaim] could not read command lines', error.message)
      }
    }
  }

  // Electron runs the GPU and each renderer as separate processes; ending one
  // of those closes the window the user is standing in, so the whole tree is
  // off limits, not just the main process.
  const own = new Set([process.pid, ...ownPids])
  const processes = data.processes.map((entry) => {
    const group = groupFor(entry.name)
    const commandLine = commandLines[String(entry.pid)] || ''
    return {
      pid: entry.pid,
      name: entry.name,
      title: entry.title || '',
      group,
      groupLabel: GROUP_LABELS[group],
      cpu: entry.cpu,
      memoryBytes: entry.memoryBytes,
      priority: entry.priority || 'Normal',
      threads: entry.threads,
      startedAt: entry.startedAt,
      commandLine,
      // The app must not offer to kill the window the user is looking at.
      protected: entry.protected || own.has(entry.pid),
      isSelf: own.has(entry.pid),
    }
  })

  const totalMemory = os.totalmem()
  return {
    at: new Date().toISOString(),
    cores: data.cores,
    sampleMs: data.sampleMs,
    cpuPercent: data.cpuPercent,
    memory: { totalBytes: totalMemory, freeBytes: os.freemem(), usedBytes: totalMemory - os.freemem() },
    uptimeSeconds: Math.round(os.uptime()),
    disks: await diskUsage(),
    processes,
  }
}

/**
 * Takes the first, slow reading at launch so the tabs that need it open on
 * data instead of a spinner. The reading is also what seeds the CPU deltas,
 * so the first snapshot the user sees already has real percentages.
 */
function warmUp() {
  snapshot({ withCommandLines: false }).catch((error) => {
    console.warn('[reclaim] could not warm the system helper', error.message)
  })
}

/** True when `child` sits inside one of the excluded folders. */
function isCovered(target, exclusions) {
  const lower = target.toLowerCase()
  return exclusions.some((exclusion) => {
    const parent = exclusion.toLowerCase().replace(/[\\/]+$/, '')
    return lower === parent || lower.startsWith(`${parent}\\`)
  })
}

async function defenderInfo() {
  const info = await agent.call('defender')
  const exclusions = Array.isArray(info.exclusions) ? info.exclusions.filter(Boolean) : []
  const devPaths = Array.isArray(info.devPaths) ? info.devPaths : []

  return {
    available: Boolean(info.available),
    running: Boolean(info.running),
    memoryMB: info.memoryMB || 0,
    realTimeProtection: info.realTime === null || info.realTime === undefined ? null : Boolean(info.realTime),
    behaviorMonitor: info.behaviorMonitor === null || info.behaviorMonitor === undefined ? null : Boolean(info.behaviorMonitor),
    scanInProgress: Boolean(info.scanInProgress),
    cpuLoadFactor: typeof info.cpuLoadFactor === 'number' ? info.cpuLoadFactor : null,
    onlyWhenIdle: info.onlyWhenIdle === null || info.onlyWhenIdle === undefined ? null : Boolean(info.onlyWhenIdle),
    catchUpQuick: Boolean(info.catchUpQuick),
    catchUpFull: Boolean(info.catchUpFull),
    lastQuickScan: info.lastQuickScan || null,
    tamperProtected: info.tamperProtected === null || info.tamperProtected === undefined ? null : Boolean(info.tamperProtected),
    exclusions,
    exclusionProcess: Array.isArray(info.exclusionProcess) ? info.exclusionProcess.filter(Boolean) : [],
    // The whole point: which folders your tooling hammers are still scanned.
    devPaths: devPaths.map((entry) => ({
      path: entry.path,
      label: entry.label,
      covered: isCovered(entry.path, exclusions),
    })),
  }
}

/**
 * Which programs are holding these paths open, via the Restart Manager.
 *
 * Guessing from process names is unreliable; this asks Windows the same way an
 * installer does before it tells you to close something.
 */
async function findLockers(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return []
  const list = await agent.call('lockers', { paths: paths.slice(0, 24) })
  const rows = Array.isArray(list) ? list : [list].filter(Boolean)
  const own = new Set([process.pid])
  return rows
    .filter((row) => row && row.pid && !own.has(row.pid))
    .map((row) => ({
      pid: row.pid,
      name: row.name,
      title: row.title || '',
      protected: Boolean(row.protected),
    }))
}

/**
 * Runs a batch of PowerShell statements as administrator.
 *
 * This is the one thing Reclaim does that needs elevated rights, so it cannot
 * go through the long-lived helper. It writes the statements to a temp script
 * and asks Windows to run that elevated — the UAC prompt is the consent gate,
 * and declining it is a normal outcome, not an error to hide.
 *
 * The caller is responsible for making sure every line is built from values it
 * has already validated; this function only handles the elevation plumbing.
 */
function ignoreCleanup() {
  /* the temp script is disposable; a failure to remove it is not worth raising */
}

async function runElevated(lines) {
  const scriptPath = path.join(os.tmpdir(), `reclaim-elevated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`)
  const script = ["$ErrorActionPreference = 'Stop'", ...lines, 'exit 0'].join('\r\n')

  await fsp.writeFile(scriptPath, script, 'utf8')

  try {
    await new Promise((resolve, reject) => {
      // Every item must be a quoted PowerShell string. A bare `-NoProfile`
      // here would be read as a parameter of Start-Process, not as an argument
      // to pass along to the elevated shell.
      const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath].
      map((argument) => `'${argument.replace(/'/g, "''")}'`).
      join(',')

      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList ${inner}`,
        ],
        { windowsHide: true },
      )

      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve()
        // A refused UAC prompt surfaces here; say so plainly.
        else if (/cancell?ed by the user|The operation was canceled/i.test(stderr)) {
          reject(new Error('The administrator prompt was declined'))
        } else {
          reject(new Error(stderr.trim().split('\n')[0] || `The elevated step failed (exit ${code})`))
        }
      })
    })
  } finally {
    await fsp.unlink(scriptPath).catch(ignoreCleanup)
  }
}

/**
 * Adds or removes Defender folder exclusions.
 *
 * Nothing is trusted from the caller: every path must be one that already
 * exists on disk, so a bad value cannot turn into an arbitrary command.
 */
async function setExclusions(paths, { remove = false } = {}) {
  const wanted = Array.isArray(paths) ? paths.filter((entry) => typeof entry === 'string' && entry.trim()) : []
  if (wanted.length === 0) return { ok: false, message: 'Nothing to change' }
  if (wanted.length > 40) return { ok: false, message: 'Too many folders in one go' }

  const valid = []
  for (const candidate of wanted) {
    const resolved = path.resolve(candidate)
    if (!path.isAbsolute(resolved)) continue
    // Removing an exclusion for a folder that has since gone is still valid.
    const exists = await fsp.stat(resolved).then((stat) => stat.isDirectory(), () => false)
    if (!exists && !remove) continue
    valid.push(resolved)
  }
  if (valid.length === 0) return { ok: false, message: 'None of those folders exist any more' }

  const verb = remove ? 'Remove-MpPreference' : 'Add-MpPreference'
  // Single quotes are literal in PowerShell; doubling one escapes it.
  const lines = valid.map((entry) => `${verb} -ExclusionPath '${entry.replace(/'/g, "''")}'`)

  try {
    await runElevated(lines)
  } catch (error) {
    return { ok: false, message: error.message }
  }

  // Read the settings back rather than trusting the exit code: this is the
  // only answer that means anything to the user.
  const after = await defenderInfo()
  const applied = valid.filter((entry) => isCovered(entry, after.exclusions))
  const changed = remove ? valid.filter((entry) => !applied.includes(entry)) : applied

  return {
    ok: changed.length > 0,
    changed: changed.length,
    attempted: valid.length,
    defender: after,
    message:
      changed.length > 0
        ? undefined
        : remove
          ? 'Windows did not remove those exclusions'
          : 'Windows did not record those exclusions',
  }
}

/** A bare Windows executable name — no path, no arguments, no shell metacharacters. */
const EXE_NAME = /^[\w.\- ]{1,120}\.exe$/i

/**
 * Adds or removes Defender process exclusions — Windows stops inspecting
 * anything that executable does, wherever it runs from.
 *
 * Only accepts a bare `name.exe`: no path separators, quotes, or shell
 * characters, so a bad value cannot become an arbitrary command.
 */
async function setProcessExclusions(names, { remove = false } = {}) {
  const wanted = Array.isArray(names) ? names.filter((entry) => typeof entry === 'string') : []
  const valid = [...new Set(wanted.map((entry) => entry.trim()).filter((entry) => EXE_NAME.test(entry)))]
  if (valid.length === 0) return { ok: false, message: 'Nothing valid to change' }
  if (valid.length > 40) return { ok: false, message: 'Too many programs in one go' }

  const verb = remove ? 'Remove-MpPreference' : 'Add-MpPreference'
  const lines = valid.map((entry) => `${verb} -ExclusionProcess '${entry.replace(/'/g, "''")}'`)

  try {
    await runElevated(lines)
  } catch (error) {
    return { ok: false, message: error.message }
  }

  const after = await defenderInfo()
  const coveredNow = new Set(after.exclusionProcess.map((entry) => entry.toLowerCase()))
  const applied = valid.filter((entry) => coveredNow.has(entry.toLowerCase()))
  const changed = remove ? valid.filter((entry) => !applied.includes(entry)) : applied

  return {
    ok: changed.length > 0,
    changed: changed.length,
    attempted: valid.length,
    defender: after,
    message:
      changed.length > 0
        ? undefined
        : remove
          ? 'Windows did not remove those exclusions'
          : 'Windows did not record those exclusions',
  }
}

/**
 * Turns Defender's real-time protection on or off for the whole machine.
 *
 * This is a much bigger decision than excluding a folder — it drops protection
 * everywhere, not just in your build caches — so it is refused outright if
 * Tamper Protection is on. That setting exists specifically so a program
 * cannot flip this switch on its own; Windows would silently ignore the
 * change anyway, and working around Tamper Protection is not something this
 * app will do. When it is on, the user is pointed at Windows Security itself.
 */
async function setRealtimeProtection(enabled) {
  const before = await defenderInfo()
  if (!before.available) {
    return { ok: false, message: 'Microsoft Defender is not answering on this machine' }
  }
  if (before.tamperProtected) {
    return {
      ok: false,
      message:
        'Tamper Protection is on, so only Windows Security itself can change this. Open ' +
        'Windows Security → Virus & threat protection → Manage settings to turn it off first.',
      defender: before,
    }
  }
  if (before.realTimeProtection === Boolean(enabled)) {
    return { ok: true, changed: 0, defender: before }
  }

  try {
    await runElevated([`Set-MpPreference -DisableRealtimeMonitoring $${enabled ? 'false' : 'true'}`])
  } catch (error) {
    return { ok: false, message: error.message }
  }

  const after = await defenderInfo()
  const applied = after.realTimeProtection === Boolean(enabled)

  return {
    ok: applied,
    changed: applied ? 1 : 0,
    defender: after,
    message: applied ? undefined : 'Windows did not record the change',
  }
}

async function killProcess(pid) {
  if (pid === process.pid) throw new Error('Reclaim will not close itself')
  return agent.call('kill', { pid })
}

const PRIORITIES = new Set(['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High'])

async function setPriority(pid, priority) {
  if (!PRIORITIES.has(priority)) throw new Error(`'${priority}' is not a priority Reclaim will set`)
  // Realtime is deliberately absent: it can starve the mouse cursor.
  return agent.call('priority', { pid, priority })
}

/** Drops Reclaim's own priority so a big scan cannot fight the user's editor. */
function setOwnPriority(priority) {
  if (!PRIORITIES.has(priority)) return false
  try {
    os.setPriority(process.pid, { Idle: 19, BelowNormal: 10, Normal: 0, AboveNormal: -7, High: -14 }[priority])
    return true
  } catch (error) {
    console.warn('[reclaim] could not set own priority', error.message)
    return false
  }
}


// ------------------------------------------------------------ CPU & power

/**
 * How Windows decides how fast the CPU may run.
 *
 * On a stock install the Balanced plan lets the clock idle at 5% and parks
 * cores; laptops often ship with the maximum state capped below 100% so the
 * turbo never engages. None of that is a hardware limit — it is a handful of
 * power-plan values, all of which `powercfg` can change and all of which are
 * recorded here first so they can be put back exactly.
 */
const SCHEMES = {
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e',
  high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  saver: 'a1841308-3541-4fab-bc81-f71556f20b4a',
  ultimate: 'e9a42b02-d5df-448d-aa00-03f14749eb61',
}
const SUB_PROCESSOR = '54533251-82be-4824-96c1-47b60b740d00'
const PROC_SETTINGS = {
  min: '893dee8e-2bef-41e0-89c6-b55d0929964c',
  max: 'bc5038f7-23e0-4960-96da-33abaf5935ec',
  boost: 'be337238-0d82-4146-a960-4f3749d470c7',
  minCores: '0cc5b647-c1df-4637-891a-dec35c318583',
  cooling: '94d3a615-a899-4ac5-ae2b-e4d8f634367f',
}
const OVERLAY_GUIDS = {
  max: 'ded574b5-45a0-4f42-8737-46345c09c238',
  high: '3af9b8d9-7c97-431d-ad78-34a8bfea439f',
  saver: '961cc777-2547-4f9d-8174-7d86181b8a7a',
  balanced: '00000000-0000-0000-0000-000000000000',
}
/** Short, variable quantum with a 3:1 foreground boost — what "Programs" means in System Properties. */
const FOREGROUND_PRIORITY = 38
const PRIORITY_KEY = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function value(info, key, side) {
  const entry = info.settings && info.settings[key]
  return entry && typeof entry[side] === 'number' ? entry[side] : null
}

function performancePlan(info) {
  return (info.schemes || []).some((scheme) => scheme.guid.toLowerCase() === SCHEMES.ultimate) ? SCHEMES.ultimate : SCHEMES.high
}

function setIndex(side, key, amount) {
  return `powercfg /set${side}valueindex SCHEME_CURRENT ${SUB_PROCESSOR} ${PROC_SETTINGS[key]} ${amount}`
}

function unhide(key) {
  return `powercfg -attributes ${SUB_PROCESSOR} ${PROC_SETTINGS[key]} -ATTRIB_HIDE`
}

/**
 * Every change the CPU tab can make. `evaluate` reads the current state so the
 * tab shows what is already in effect; `lines` builds the elevated commands.
 * Battery (DC) values are left alone on laptops unless a tweak says otherwise,
 * because a pinned clock on battery is a fan that never stops.
 */
const CPU_TWEAKS = [
  {
    id: 'plan',
    label: 'High performance power plan',
    detail: 'Switches from Balanced, which lets the clock idle and parks cores, to the plan that keeps the CPU ready.',
    laptopNote: 'Uses more battery. Windows keeps the plan across restarts.',
    evaluate: (info) => {
      const active = info.activeScheme ? info.activeScheme.guid.toLowerCase() : ''
      return active === SCHEMES.high || active === SCHEMES.ultimate
    },
    lines: (info) => [`powercfg /setactive ${performancePlan(info)}`],
  },
  {
    id: 'max',
    label: 'Maximum processor state 100%',
    detail: 'Many laptops ship capped at 99% or lower, which quietly disables the turbo. This lifts the cap on power and on battery.',
    evaluate: (info) => {
      const ac = value(info, 'max', 'ac')
      const dc = value(info, 'max', 'dc')
      if (ac === null) return null
      return ac >= 100 && (!info.isLaptop || dc === null || dc >= 100)
    },
    lines: () => [setIndex('ac', 'max', 100), setIndex('dc', 'max', 100)],
  },
  {
    id: 'boost',
    label: 'Turbo boost: aggressive',
    detail: 'Lets the CPU jump to its boost clock as soon as there is work, instead of ramping up over a few hundred milliseconds.',
    evaluate: (info) => {
      const ac = value(info, 'boost', 'ac')
      return ac === null ? null : ac >= 2
    },
    lines: (info) => {
      const lines = [unhide('boost'), setIndex('ac', 'boost', 2)]
      // Off on battery stays off only if it was explicitly off; enabled is the sane floor.
      if (info.isLaptop && value(info, 'boost', 'dc') === 0) lines.push(setIndex('dc', 'boost', 1))
      return lines
    },
  },
  {
    id: 'cores',
    label: 'No core parking',
    detail: 'Keeps every core awake on power. Windows otherwise puts idle cores to sleep and wakes them a little too late for bursty work like builds.',
    evaluate: (info) => {
      const ac = value(info, 'minCores', 'ac')
      return ac === null ? null : ac >= 100
    },
    lines: () => [unhide('minCores'), setIndex('ac', 'minCores', 100)],
  },
  {
    id: 'min',
    label: 'Minimum processor state 100% on power',
    detail: 'The clock never drops while plugged in, so nothing waits for it to ramp up. Costs idle power and some heat; the battery setting is untouched.',
    laptopNote: 'Only applies while plugged in.',
    evaluate: (info) => {
      const ac = value(info, 'min', 'ac')
      return ac === null ? null : ac >= 100
    },
    lines: () => [setIndex('ac', 'min', 100)],
  },
  {
    id: 'cooling',
    label: 'Active cooling',
    detail: 'Spins the fan up before slowing the CPU down, rather than the other way round. Matters most on laptops, which default to passive on battery.',
    evaluate: (info) => {
      const ac = value(info, 'cooling', 'ac')
      return ac === null ? null : ac === 1
    },
    lines: (info) => (info.isLaptop ? [setIndex('ac', 'cooling', 1), setIndex('dc', 'cooling', 1)] : [setIndex('ac', 'cooling', 1)]),
  },
  {
    id: 'overlay',
    label: 'Windows power mode: Best performance',
    detail: 'The slider under Settings → Power. Only some machines have it; where it is missing this step is skipped.',
    evaluate: (info) => (info.overlay === 'unsupported' ? null : info.overlay === 'max'),
    available: (info) => info.overlay !== 'unsupported',
    lines: () => [`try { & powercfg /overlaysetactive ${OVERLAY_GUIDS.max} 2>&1 | Out-Null } catch { }`],
  },
  {
    id: 'foreground',
    label: 'Favour the program in front',
    detail: 'Gives the window you are working in three times the CPU share of background work, with short scheduling slices so it stays responsive.',
    evaluate: (info) => (typeof info.prioritySeparation === 'number' ? info.prioritySeparation === FOREGROUND_PRIORITY : null),
    lines: () => [`Set-ItemProperty -Path '${PRIORITY_KEY}' -Name Win32PrioritySeparation -Value ${FOREGROUND_PRIORITY} -Type DWord`],
  },
]

const TWEAK_IDS = new Set(CPU_TWEAKS.map((tweak) => tweak.id))

/** Services worth turning off on some machines, and why. */
const SERVICES = {
  SysMain: {
    label: 'SysMain (Superfetch)',
    detail: 'Pre-loads programs it thinks you will open. On a hard disk that is constant background reading; on an SSD it mostly does nothing.',
  },
  WSearch: {
    label: 'Windows Search indexing',
    detail: 'Indexes every file that changes. On a machine that writes tens of thousands of build files, it keeps a core busy for nothing you search.',
  },
}

let backupFile = null

function configureCpu(userDataPath) {
  backupFile = path.join(userDataPath, 'cpu-backup.json')
}

async function readBackup() {
  if (!backupFile) return null
  try {
    return JSON.parse(await fsp.readFile(backupFile, 'utf8'))
  } catch {
    return null
  }
}

function normaliseCpuInfo(raw) {
  const services = {}
  Object.entries(SERVICES).forEach(([name, meta]) => {
    const entry = raw.services && raw.services[name]
    services[name] = {
      name,
      label: meta.label,
      detail: meta.detail,
      status: entry ? entry.status : 'Missing',
      startType: entry ? entry.startType : 'Unknown',
      present: Boolean(entry),
    }
  })
  return {
    name: raw.name || 'Unknown processor',
    cores: raw.cores || os.cpus().length,
    logical: raw.logical || os.cpus().length,
    maxMHz: typeof raw.maxMHz === 'number' ? raw.maxMHz : null,
    isLaptop: Boolean(raw.isLaptop),
    systemDriveIsSsd: typeof raw.systemDriveIsSsd === 'boolean' ? raw.systemDriveIsSsd : null,
    schemes: Array.isArray(raw.schemes) ? raw.schemes : [],
    activeScheme: raw.activeScheme || null,
    overlay: raw.overlay || 'unsupported',
    settings: raw.settings || {},
    prioritySeparation: typeof raw.prioritySeparation === 'number' ? raw.prioritySeparation : null,
    services,
    live: raw.live || {},
  }
}

/** The full reading: hardware, the active plan's processor values, services. */
async function cpuInfo() {
  const info = normaliseCpuInfo(await agent.call('cpu'))
  const backup = await readBackup()
  return {
    ...info,
    tweaks: CPU_TWEAKS.map((tweak) => ({
      id: tweak.id,
      label: tweak.label,
      detail: tweak.detail,
      laptopNote: tweak.laptopNote || null,
      // null means "cannot tell on this machine", which the tab shows as such.
      active: tweak.evaluate(info),
      // False when the machine has no such setting at all (no power-mode slider).
      available: tweak.available ? tweak.available(info) : true,
    })),
    canRestore: Boolean(backup),
    backupAt: backup ? backup.at : null,
  }
}

/** The cheap reading for polling: clock, load, battery. */
async function cpuLive() {
  return agent.call('cpuLive')
}

/**
 * Remembers what the machine looked like before the first change, so a
 * restore puts back exactly that rather than some generic default.
 */
async function ensureBackup(info, targetScheme) {
  if (!backupFile || (await readBackup())) return
  let values = info.settings
  if (targetScheme !== (info.activeScheme && info.activeScheme.guid.toLowerCase())) {
    try {
      values = await agent.call('powerValues', { scheme: targetScheme })
    } catch {
      values = {}
    }
  }
  const backup = {
    at: new Date().toISOString(),
    activeScheme: info.activeScheme ? info.activeScheme.guid : SCHEMES.balanced,
    modifiedScheme: targetScheme,
    values,
    overlay: info.overlay,
    prioritySeparation: info.prioritySeparation,
    services: Object.fromEntries(
      Object.entries(info.services).filter(([, entry]) => entry.present).map(([name, entry]) => [name, entry.startType]),
    ),
  }
  await fsp.writeFile(backupFile, JSON.stringify(backup, null, 2))
}

/**
 * Applies a set of tweaks in one elevated step. Only ids from the catalogue
 * are accepted, so nothing the renderer sends can turn into a command.
 */
async function applyCpuTweaks(ids) {
  const wanted = Array.isArray(ids) ? [...new Set(ids.filter((id) => TWEAK_IDS.has(id)))] : []
  if (wanted.length === 0) return { ok: false, message: 'Nothing selected' }

  const before = normaliseCpuInfo(await agent.call('cpu'))
  const targetScheme = wanted.includes('plan')
    ? performancePlan(before)
    : before.activeScheme
      ? before.activeScheme.guid.toLowerCase()
      : SCHEMES.balanced
  await ensureBackup(before, targetScheme)

  // The plan switch goes first so SCHEME_CURRENT means the plan being tuned.
  const ordered = CPU_TWEAKS.filter((tweak) => wanted.includes(tweak.id) && (!tweak.available || tweak.available(before)))
  if (ordered.length === 0) return { ok: false, message: 'None of those settings exist on this machine' }
  const lines = ordered.flatMap((tweak) => tweak.lines(before))
  if (ordered.some((tweak) => tweak.id !== 'overlay' && tweak.id !== 'foreground')) {
    // Values written to a scheme only take effect once it is re-activated.
    lines.push('powercfg /setactive SCHEME_CURRENT')
  }

  try {
    await runElevated(lines)
  } catch (error) {
    return { ok: false, message: error.message }
  }

  const after = await cpuInfo()
  const applied = wanted.filter((id) => after.tweaks.find((tweak) => tweak.id === id)?.active === true)
  return {
    ok: applied.length > 0,
    changed: applied.length,
    attempted: wanted.length,
    cpu: after,
    message: applied.length > 0 ? undefined : 'Windows did not record the change',
  }
}

/** Puts back everything the backup recorded, then forgets the backup. */
async function restoreCpu() {
  const backup = await readBackup()
  if (!backup) return { ok: false, message: 'There is nothing to restore' }

  const lines = []
  const scheme = typeof backup.modifiedScheme === 'string' && GUID.test(backup.modifiedScheme) ? backup.modifiedScheme : null
  if (scheme && backup.values) {
    Object.entries(PROC_SETTINGS).forEach(([key, guid]) => {
      const entry = backup.values[key]
      if (!entry) return
      if (typeof entry.ac === 'number') lines.push(`powercfg /setacvalueindex ${scheme} ${SUB_PROCESSOR} ${guid} ${Math.max(0, Math.round(entry.ac))}`)
      if (typeof entry.dc === 'number') lines.push(`powercfg /setdcvalueindex ${scheme} ${SUB_PROCESSOR} ${guid} ${Math.max(0, Math.round(entry.dc))}`)
    })
  }
  if (typeof backup.activeScheme === 'string' && GUID.test(backup.activeScheme)) {
    lines.push(`powercfg /setactive ${backup.activeScheme}`)
  }
  if (backup.overlay && OVERLAY_GUIDS[backup.overlay]) {
    lines.push(`try { & powercfg /overlaysetactive ${OVERLAY_GUIDS[backup.overlay]} 2>&1 | Out-Null } catch { }`)
  }
  if (typeof backup.prioritySeparation === 'number') {
    lines.push(`Set-ItemProperty -Path '${PRIORITY_KEY}' -Name Win32PrioritySeparation -Value ${Math.round(backup.prioritySeparation)} -Type DWord`)
  }
  Object.entries(backup.services || {}).forEach(([name, startType]) => {
    if (!SERVICES[name] || !['Automatic', 'Manual', 'Disabled'].includes(startType)) return
    lines.push(`Set-Service -Name ${name} -StartupType ${startType}`)
    if (startType === 'Automatic') lines.push(`Start-Service -Name ${name} -ErrorAction SilentlyContinue`)
  })

  if (lines.length === 0) return { ok: false, message: 'The backup holds nothing to restore' }

  try {
    await runElevated(lines)
  } catch (error) {
    return { ok: false, message: error.message }
  }

  await fsp.unlink(backupFile).catch(ignoreCleanup)
  return { ok: true, changed: 1, cpu: await cpuInfo() }
}

/**
 * Turns a background service off (start type Disabled, stopped now) or back
 * on (Automatic, started). Only the two services the tab describes.
 */
async function setService(name, enabled) {
  if (!SERVICES[name]) return { ok: false, message: `${name} is not a service Reclaim manages` }
  const before = normaliseCpuInfo(await agent.call('cpu'))
  if (!before.services[name].present) return { ok: false, message: `${name} is not installed on this machine` }
  await ensureBackup(before, before.activeScheme ? before.activeScheme.guid.toLowerCase() : SCHEMES.balanced)

  const lines = enabled
    ? [`Set-Service -Name ${name} -StartupType Automatic`, `Start-Service -Name ${name} -ErrorAction SilentlyContinue`]
    : [`Set-Service -Name ${name} -StartupType Disabled`, `Stop-Service -Name ${name} -Force -ErrorAction SilentlyContinue`]

  try {
    await runElevated(lines)
  } catch (error) {
    return { ok: false, message: error.message }
  }

  const after = await cpuInfo()
  const state = after.services[name]
  const applied = enabled ? state.startType === 'Automatic' : state.startType === 'Disabled'
  return { ok: applied, changed: applied ? 1 : 0, cpu: after, message: applied ? undefined : 'Windows did not record the change' }
}

// ----------------------------------------------------------------- startup

/** Mirrors the sources in agent.ps1; only the machine-wide ones need elevation. */
const STARTUP_APPROVED = {
  hkcu: { scope: 'user' },
  'folder-user': { scope: 'user' },
  hklm: { scope: 'machine', key: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
  hklm32: { scope: 'machine', key: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32' },
  'folder-machine': { scope: 'machine', key: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder' },
}
/** A registry value name: no control characters, no quotes, bounded length. */
function isStartupName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false
  if (/['"`]/.test(name)) return false
  return [...name].every((char) => char.charCodeAt(0) >= 32)
}

async function startupList() {
  const list = await agent.call('startup')
  const rows = Array.isArray(list) ? list : [list].filter(Boolean)
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    scope: row.scope,
    name: row.name,
    command: row.command || '',
    enabled: Boolean(row.enabled),
  }))
}

/**
 * Enables or disables a startup entry the way Task Manager does: the program
 * stays installed and listed, Windows just skips launching it at sign-in.
 */
async function setStartup({ source, name, enabled }) {
  const meta = STARTUP_APPROVED[source]
  if (!meta) return { ok: false, message: 'Unknown startup source' }
  if (!isStartupName(name)) return { ok: false, message: 'That entry name cannot be handled' }

  if (meta.scope === 'user') {
    try {
      const result = await agent.call('startupToggle', { source, name, enabled: Boolean(enabled) })
      return { ok: Boolean(result.enabled) === Boolean(enabled), enabled: Boolean(result.enabled) }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }

  const bytes = enabled
    ? '[byte[]](2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)'
    : '([byte[]](3, 0, 0, 0) + [BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTime()))'
  try {
    await runElevated([
      `if (-not (Test-Path '${meta.key}')) { New-Item -Path '${meta.key}' -Force | Out-Null }`,
      `Set-ItemProperty -Path '${meta.key}' -Name '${name}' -Value ${bytes} -Type Binary`,
    ])
  } catch (error) {
    return { ok: false, message: error.message }
  }
  const after = (await startupList()).find((row) => row.source === source && row.name === name)
  const applied = after ? after.enabled === Boolean(enabled) : false
  return { ok: applied, enabled: after ? after.enabled : !enabled, message: applied ? undefined : 'Windows did not record the change' }
}

// ------------------------------------------------------------- recycle bin

async function recycleBin() {
  const data = await agent.call('recycleBin')
  return { items: Number(data.items) || 0, bytes: Number(data.bytes) || 0 }
}

async function emptyRecycleBin() {
  const data = await agent.call('emptyRecycleBin')
  return { items: Number(data.items) || 0, bytes: Number(data.bytes) || 0 }
}

// ------------------------------------------------------------------ specs

const { adviseUpgrades, ramTypeLabel } = require('./upgrades.cjs')

const FORM_FACTORS = { 8: 'DIMM', 12: 'SODIMM', 9: 'RIMM', 13: 'SRIMM', 0: 'unknown' }

/**
 * Everything in the box, normalised for the renderer, with the upgrade
 * advice worked out from it. Slow the first time (WMI providers load), so
 * the helper caches the raw reading.
 */
async function systemReport() {
  const started = Date.now()
  const raw = await (slowAgent || agent).call('specs')
  const pcType = Number(raw.computer && raw.computer.pcType) || 0
  const cpuName = String((raw.cpu && raw.cpu.name) || '')
  const modules = Array.isArray(raw.memory && raw.memory.modules) ? raw.memory.modules : []
  const specs = {
    computer: {
      manufacturer: String((raw.computer && raw.computer.manufacturer) || '').trim(),
      model: String((raw.computer && raw.computer.model) || '').trim(),
      family: String((raw.computer && raw.computer.family) || '').trim(),
      // PCSystemType: 1 desktop, 2 mobile, 3 workstation, 8 max-performance server
      type: pcType === 2 ? 'laptop' : pcType === 1 || pcType === 3 ? 'desktop' : 'other',
    },
    os: {
      name: String((raw.os && raw.os.name) || 'Windows'),
      version: String((raw.os && raw.os.version) || ''),
      build: String((raw.os && raw.os.build) || ''),
      arch: String((raw.os && raw.os.arch) || ''),
      installedAt: (raw.os && raw.os.installedAt) || null,
    },
    board: {
      manufacturer: String((raw.board && raw.board.manufacturer) || '').trim(),
      product: String((raw.board && raw.board.product) || '').trim(),
      version: String((raw.board && raw.board.version) || '').trim(),
      bios: String((raw.board && raw.board.bios) || '').trim(),
      biosDate: (raw.board && raw.board.biosDate) || null,
    },
    cpu: {
      name: cpuName,
      cores: Number(raw.cpu && raw.cpu.cores) || os.cpus().length,
      threads: Number(raw.cpu && raw.cpu.threads) || os.cpus().length,
      maxMHz: Number(raw.cpu && raw.cpu.maxMHz) || null,
      socket: String((raw.cpu && raw.cpu.socket) || ''),
      l2KB: Number(raw.cpu && raw.cpu.l2KB) || null,
      l3KB: Number(raw.cpu && raw.cpu.l3KB) || null,
    },
    memory: {
      totalBytes: Number(raw.memory && raw.memory.totalBytes) || os.totalmem(),
      maxBytes: Number(raw.memory && raw.memory.maxBytes) || null,
      slots: Number(raw.memory && raw.memory.slots) || null,
      modules: modules.map((module) => ({
        slot: String(module.slot || ''),
        bank: String(module.bank || ''),
        bytes: Number(module.bytes) || 0,
        speed: Number(module.speed) || null,
        configuredSpeed: Number(module.configuredSpeed) || null,
        type: ramTypeLabel(Number(module.typeCode)),
        formFactor: FORM_FACTORS[Number(module.formFactor)] || 'DIMM',
        manufacturer: String(module.manufacturer || '').trim(),
        partNumber: String(module.partNumber || '').trim(),
      })),
    },
    gpus: (Array.isArray(raw.gpus) ? raw.gpus : []).map((gpu) => ({
      name: String(gpu.name || ''),
      vramBytes: Number(gpu.vramBytes) > 0 ? Number(gpu.vramBytes) : null,
      driver: String(gpu.driver || ''),
      resolution: gpu.resolution || null,
    })),
    disks: (Array.isArray(raw.disks) ? raw.disks : []).map((disk) => ({
      name: String(disk.name || ''),
      mediaType: String(disk.mediaType || 'Unspecified'),
      bus: String(disk.bus || ''),
      bytes: Number(disk.bytes) || 0,
      health: String(disk.health || ''),
      system: Boolean(disk.system),
      letter: disk.letter || null,
      totalBytes: Number(disk.totalBytes) || 0,
      freeBytes: disk.freeBytes === null || disk.freeBytes === undefined ? null : Number(disk.freeBytes),
    })),
    network: (Array.isArray(raw.network) ? raw.network : []).map((nic) => ({
      name: String(nic.name || ''),
      speedBps: Number(nic.speedBps) || null,
      up: Boolean(nic.up),
    })),
    monitors: (Array.isArray(raw.monitors) ? raw.monitors : []).map((monitor) => ({
      name: String(monitor.name || ''),
      width: Number(monitor.width) || null,
      height: Number(monitor.height) || null,
    })),
  }
  // The memory array sometimes reports fewer slots than there are sticks; trust the sticks.
  if (specs.memory.slots !== null && specs.memory.slots < specs.memory.modules.length) specs.memory.slots = specs.memory.modules.length
  const { platform, advice } = adviseUpgrades(specs)
  return { specs, platform, advice, tookMs: Date.now() - started }
}

module.exports = {
  systemReport,
  snapshot,
  findLockers,
  setExclusions,
  setProcessExclusions,
  setRealtimeProtection,
  warmUp,
  defenderInfo,
  killProcess,
  setPriority,
  setOwnPriority,
  configureCpu,
  cpuInfo,
  cpuLive,
  applyCpuTweaks,
  restoreCpu,
  setService,
  startupList,
  setStartup,
  recycleBin,
  emptyRecycleBin,
  /** For modules that need the helper and the elevated runner without owning them. */
  agent,
  slowAgent,
  runElevated,
  stopAgent: () => {
    agent.stop()
    slowAgent.stop()
  },
}
