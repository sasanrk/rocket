const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron')
const path = require('node:path')
const fsp = require('node:fs/promises')
const { runInProcess } = require('./worker.cjs')
const { JobManager, THROTTLES } = require('./jobs.cjs')
const history = require('./history.cjs')
const system = require('./system.cjs')
const { discoverJunk } = require('./appJunk.cjs')
const programs = require('./programs.cjs')
const drives = require('./drives.cjs')
const { planMove } = require('./mover.cjs')

/** The user-facing name; internal channels and paths keep their old identifiers. */
const PRODUCT = 'Rocket'

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

/** Colours for the caption buttons Windows draws, matched to the renderer's palette. */
const TITLE_BAR = {
  dark: { color: '#111418', symbolColor: '#e9eef3', height: 36 },
  light: { color: '#ffffff', symbolColor: '#0f141b', height: 36 },
}

/** How long a deletion sits on the runway before anything is touched. */
const DEFAULT_GRACE_MS = 6000

let mainWindow = null
let tray = null
/** Set only by an explicit Quit; closing the window hides it instead. */
let quitting = false

const jobs = new JobManager()
jobs.onThrottleChange = (profile) => system.setOwnPriority(profile.ownPriority)

/**
 * `reclaim --scan D:\Dev` (or `npm run start -- --scan D:\Dev`) opens straight
 * into a scan of that folder, so a shortcut can skip the folder picker.
 */
function initialRootFromArgv(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--scan=')) return arg.slice('--scan='.length)
    if (arg === '--scan' && argv[index + 1] && !argv[index + 1].startsWith('-')) return argv[index + 1]
  }
  return null
}

const initialRoot = initialRootFromArgv(process.argv.slice(1))

/** Folders the user has scanned before, newest first, persisted between runs. */
const RECENT_LIMIT = 6
let recentFile = null

function recentPath() {
  if (!recentFile) recentFile = path.join(app.getPath('userData'), 'recent.json')
  return recentFile
}

async function isDirectory(target) {
  return fsp.stat(target).then(
    (stat) => stat.isDirectory(),
    () => false,
  )
}

async function readRecent() {
  try {
    const parsed = JSON.parse(await fsp.readFile(recentPath(), 'utf8'))
    if (!Array.isArray(parsed)) return []
    // A folder that has since been moved or deleted would only fail on click.
    const alive = await Promise.all(
      parsed
        .filter((entry) => typeof entry === 'string')
        .slice(0, RECENT_LIMIT)
        .map(async (entry) => ((await isDirectory(entry)) ? entry : null)),
    )
    return alive.filter(Boolean)
  } catch {
    return []
  }
}

async function pushRecent(dir) {
  const current = await readRecent()
  const next = [dir, ...current.filter((entry) => entry.toLowerCase() !== dir.toLowerCase())].slice(0, RECENT_LIMIT)
  try {
    await fsp.writeFile(recentPath(), JSON.stringify(next, null, 2))
  } catch (error) {
    console.warn('[reclaim] could not save recent folders', error)
  }
  return next
}

/**
 * The product was renamed from Reclaim, which moved `userData` to a new
 * folder. The first launch under the new name brings the history, recent
 * folders and power-plan backup across so nothing is lost by the rename.
 */
async function adoptOldUserData() {
  const current = app.getPath('userData')
  const previous = path.join(path.dirname(current), 'Reclaim')
  if (previous.toLowerCase() === current.toLowerCase()) return
  for (const name of ['history.json', 'recent.json', 'cpu-backup.json']) {
    const from = path.join(previous, name)
    const to = path.join(current, name)
    try {
      await fsp.access(to)
      continue // already have one under the new name
    } catch {
      /* nothing here yet, so the old file is worth taking */
    }
    try {
      await fsp.mkdir(current, { recursive: true })
      await fsp.copyFile(from, to)
    } catch {
      /* no old file either, which is the normal case on a fresh machine */
    }
  }
}

/** Icons live outside the asar so the tray can read them as real files. */
function assetPath(name) {
  return path
    .join(__dirname, '..', 'build', name)
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
}

function showWindow() {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function buildTray() {
  if (tray) return
  const icon = nativeImage.createFromPath(assetPath('tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(PRODUCT)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${PRODUCT}`, click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  // Left click is the gesture people actually reach for.
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide()
    else showWindow()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1120,
    minHeight: 680,
    icon: assetPath('icon.png'),
    show: false,
    backgroundColor: '#090b0d',
    autoHideMenuBar: true,
    title: PRODUCT,
    // No native frame: the renderer draws the top strip and Windows draws
    // only its minimise / maximise / close buttons over it.
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR.dark,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Closing sends it to the notification area so a running scan keeps going —
  // Quit from the tray menu is what actually ends the app.
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow.hide()
  })

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Job state is broadcast rather than returned, so every window stays in step. */
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload)
  })
}

jobs.on('update', (list) => broadcast('reclaim:jobs', list))
jobs.on('job-event', (payload) => broadcast('reclaim:job-event', payload))
jobs.on('job-progress', (payload) => broadcast('reclaim:job-progress', payload))
jobs.on('job-finished', (payload) => broadcast('reclaim:job-finished', payload))

// A second launch focuses the running window instead of opening a rival one
// that would scan and delete against the same folders.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(async () => {
    await adoptOldUserData()
    history.configure(app.getPath('userData'))
    system.configureCpu(app.getPath('userData'))
    createWindow()
    buildTray()

    // Starting PowerShell costs about a second. Paying it now, in the
    // background, is why the Processes and Performance tabs open instantly
    // instead of sitting on a spinner the first time.
    system.warmUp()
    // The hardware inventory takes ~20 s cold; taking it now, quietly, means
    // the This PC page opens on data instead of a spinner.
    setTimeout(() => system.systemReport().catch(noop), 10_000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// The window is hidden rather than destroyed, so this only fires on a real
// quit; the tray is what keeps the app alive otherwise.
app.on('window-all-closed', () => {
  if (quitting && process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
  jobs.cancelAll()
  system.stopAgent()
  if (tray) {
    tray.destroy()
    tray = null
  }
})

// ---------------------------------------------------------------- jobs: work

/** A scan does not delete and a cleanup does not discover; each ignores half. */
function noop() {
  /* intentionally does nothing */
}

async function runScan(root, ctx, depth) {
  const handle = runInProcess(
    { type: 'scan', root, depth, tuning: ctx.throttle() },
    {
      // The message tag is for routing, not for the job's progress state.
      onProgress: ({ type: _type, ...rest }) => ctx.progress(rest),
      onDiscovered: (dirs) => ctx.emit('discovered', dirs),
      onDropped: (dir) => ctx.emit('dropped', dir),
      onProjects: (items) => ctx.emit('projects', items),
      onRemoved: noop,
      onFailed: noop,
    },
  )
  ctx.attach(handle)

  const summary = await handle.completion
  if (!summary) return null

  await history.add({ type: 'scan', ...summary })
  return summary
}

async function runClean(targets, ctx) {
  const handle = runInProcess(
    { type: 'clean', targets, tuning: ctx.throttle() },
    {
      // The message tag is for routing, not for the job's progress state.
      onProgress: ({ type: _type, ...rest }) => ctx.progress(rest),
      onDiscovered: noop,
      onDropped: noop,
      onProjects: noop,
      onRemoved: ({ targetId, bytes }) => ctx.emit('removed', { targetId, bytes }),
      onFailed: ({ type: _type, ...failure }) => {
        console.warn('[reclaim] could not delete', failure.path, failure.message)
        ctx.emit('failed', failure)
      },
    },
  )
  ctx.attach(handle)

  const summary = await handle.completion
  if (!summary) return null

  const { items, ...totals } = summary
  await history.add({ type: 'clean', ...totals, items })
  return totals
}

/** The one cleanup target that is not a folder. */
const RECYCLE_BIN_ID = 'special:recycle-bin'

/**
 * Finds every app cache, log and temp folder and measures it. Entries stream
 * to the renderer on the `junk` event, first unmeasured and then with sizes.
 */
async function runAppScan(ctx) {
  const handle = runInProcess(
    { type: 'appScan', tuning: ctx.throttle() },
    {
      onProgress: ({ type: _type, ...rest }) => ctx.progress(rest),
      onDiscovered: noop,
      onDropped: noop,
      onProjects: noop,
      onJunk: (items) => ctx.emit('junk', items),
      onRemoved: noop,
      onFailed: noop,
    },
  )
  ctx.attach(handle)
  return handle.completion
}

/**
 * Empties app caches. The recycle bin is the one target with no path: it is
 * handed to the PowerShell helper first, then the folders go to the worker.
 */
async function runAppClean(targets, ctx) {
  const items = []
  let freed = 0
  let folders = 0
  let failures = 0

  const bin = targets.find((target) => target.id === RECYCLE_BIN_ID)
  if (bin) {
    try {
      const result = await system.emptyRecycleBin()
      freed += result.bytes
      folders += 1
      items.push({ path: 'Recycle Bin', bytes: result.bytes, ok: true, error: null })
      ctx.emit('removed', { targetId: RECYCLE_BIN_ID, bytes: result.bytes })
    } catch (error) {
      failures += 1
      items.push({ path: 'Recycle Bin', bytes: 0, ok: false, error: error.message })
      ctx.emit('failed', { targetId: RECYCLE_BIN_ID, path: 'Recycle Bin', bytes: 0, message: error.message, locked: [] })
    }
  }

  const folderTargets = targets.filter((target) => target.id !== RECYCLE_BIN_ID)
  let summary = null
  if (folderTargets.length > 0) {
    summary = await runFolderRemoval('appClean', folderTargets, ctx)
    if (!summary) return null
    freed += summary.bytes
    folders += summary.folders
    failures += summary.failures
    items.push(...summary.items)
  }

  const totals = {
    folders,
    attempted: targets.length,
    bytes: freed,
    failures,
    durationMs: summary ? summary.durationMs : 0,
    cancelled: summary ? summary.cancelled : false,
  }
  await history.add({ type: 'clean', scope: 'apps', ...totals, items })
  return totals
}

/** Runs one of the worker's removal modes and relays its per-folder events. */
async function runFolderRemoval(type, targets, ctx) {
  {
    const handle = runInProcess(
      { type, targets, tuning: ctx.throttle() },
      {
        onProgress: ({ type: _type, ...rest }) => ctx.progress(rest),
        onDiscovered: noop,
        onDropped: noop,
        onProjects: noop,
        onRemoved: ({ targetId, bytes }) => ctx.emit('removed', { targetId, bytes }),
        onFailed: ({ type: _type, ...failure }) => ctx.emit('failed', failure),
      },
    )
    ctx.attach(handle)
    return handle.completion
  }
}

/** Deletes what an uninstalled program left behind and logs it against the program's name. */
async function runLeftoverClean(programName, targets, ctx) {
  const summary = await runFolderRemoval('leftoverClean', targets, ctx)
  if (!summary) return null
  const { items, ...totals } = summary
  await history.add({ type: 'clean', scope: 'leftovers', root: programName, ...totals, items })
  return totals
}

// ---------------------------------------------------------------- ipc: files

ipcMain.handle('reclaim:chooseFolder', async (_event, options) => {
  const wanted = options && typeof options === 'object' ? options : {}
  const result = await dialog.showOpenDialog(mainWindow, {
    title: typeof wanted.title === 'string' ? wanted.title.slice(0, 120) : 'Choose the folder that holds your projects',
    buttonLabel: typeof wanted.buttonLabel === 'string' ? wanted.buttonLabel.slice(0, 40) : 'Scan this folder',
    defaultPath: typeof wanted.defaultPath === 'string' ? wanted.defaultPath : undefined,
    properties: ['openDirectory', 'dontAddToRecent'],
  })
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
})

ipcMain.handle('reclaim:recentFolders', () => readRecent())

ipcMain.handle('reclaim:initialRoot', async () => {
  if (!initialRoot) return null
  const resolved = path.resolve(initialRoot)
  const ok = await isDirectory(resolved)
  if (!ok) console.warn('[reclaim] --scan folder does not exist:', resolved)
  return ok ? resolved : null
})

ipcMain.handle('reclaim:reveal', async (_event, target) => {
  if (typeof target === 'string' && target.length > 0) {
    shell.showItemInFolder(path.normalize(target))
  }
})

ipcMain.handle('reclaim:openPath', async (_event, target) => {
  if (typeof target !== 'string' || target.length === 0) return null
  return shell.openPath(path.normalize(target))
})

// ----------------------------------------------------------------- ipc: jobs

ipcMain.handle('reclaim:startScan', async (_event, { root, depth }) => {
  const isDrive = /^[A-Za-z]:\\?$/.test(root)
  if (!isDrive) await pushRecent(root)
  const job = jobs.create({
    type: 'scan',
    label: `Scanning ${isDrive ? root : path.basename(root) || root}`,
    detail: root,
    run: (ctx) => runScan(root, ctx, Number.isFinite(depth) ? depth : isDrive ? 6 : 5),
  })
  return job.id
})

// ----------------------------------------------------------------- ipc: move

ipcMain.handle('reclaim:planMove', async (_event, { source, destination }) => {
  try {
    return await planMove(source, destination)
  } catch (error) {
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('reclaim:moveProject', async (_event, { source, destination, graceMs }) => {
  const plan = await planMove(source, destination).catch((error) => ({ ok: false, message: error.message }))
  if (!plan.ok) return { ok: false, message: plan.message }
  const grace = Number.isFinite(graceMs) ? Math.max(0, Math.min(60_000, graceMs)) : DEFAULT_GRACE_MS
  const job = jobs.create({
    type: 'move',
    label: `Moving ${path.basename(plan.source)}`,
    detail: `${plan.source} → ${plan.destination}`,
    undoLabel: 'Keep it here',
    graceMs: grace,
    run: async (ctx) => {
      const handle = runInProcess(
        { type: 'move', source: plan.source, destination, tuning: ctx.throttle() },
        {
          onProgress: ({ type: _type, ...rest }) => ctx.progress(rest),
          onDiscovered: noop,
          onDropped: noop,
          onProjects: noop,
          onRemoved: noop,
          onFailed: noop,
          onMoved: ({ source: from, destination: to }) => ctx.emit('moved', { source: from, destination: to }),
        },
      )
      ctx.attach(handle)
      const summary = await handle.completion
      if (!summary) return null
      if (summary.ok) {
        await history.add({ type: 'move', root: summary.source, destination: summary.destination, bytes: summary.freed, moved: summary.moved, durationMs: summary.durationMs, items: [] })
      }
      if (!summary.ok) throw new Error(summary.error || 'The move did not complete')
      return summary
    },
  })
  return { ok: true, jobId: job.id }
})

// --------------------------------------------------------------- ipc: drives

ipcMain.handle('reclaim:drives', () => drives.listDrives())

ipcMain.handle('reclaim:startDriveScan', async (_event, dir) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null
  const target = path.normalize(dir)
  if (!(await isDirectory(target))) return null
  const job = jobs.create({
    type: 'drivescan',
    label: `Measuring ${target}`,
    detail: 'Every folder directly inside it, biggest first',
    run: async (ctx) => {
      const handle = runInProcess(
        { type: 'driveScan', dir: target, tuning: ctx.throttle() },
        {
          onProgress: ({ type: _type, ...rest }) => ctx.progress(rest),
          onDiscovered: noop,
          onDropped: noop,
          onProjects: noop,
          onRemoved: noop,
          onFailed: noop,
          onFolders: (items) => {
            drives.remember(target, items)
            ctx.emit('folders', { dir: target, items })
          },
        },
      )
      ctx.attach(handle)
      return handle.completion
    },
  })
  return job.id
})

ipcMain.handle('reclaim:deleteFolders', async (_event, { targets, graceMs }) => {
  const list = Array.isArray(targets) ? targets : []
  const acceptedPaths = new Set(drives.acceptFolders(list.map((target) => target.path)).map((entry) => entry.toLowerCase()))
  const accepted = list.filter((target) => typeof target.path === 'string' && acceptedPaths.has(path.normalize(target.path).replace(/[\\/]+$/, '').toLowerCase()))
  if (accepted.length === 0) return null
  const grace = Number.isFinite(graceMs) ? Math.max(0, Math.min(60_000, graceMs)) : DEFAULT_GRACE_MS
  const job = jobs.create({
    type: 'appclean',
    label: `Deleting ${accepted.length} folder${accepted.length === 1 ? '' : 's'}`,
    detail: accepted.length === 1 ? accepted[0].path : `${accepted.length} folders chosen from the drive view`,
    undoLabel: 'Keep them',
    graceMs: grace,
    run: async (ctx) => {
      const summary = await runFolderRemoval('folderClean', accepted.map((target) => ({ id: target.path, path: target.path, bytes: target.bytes, files: target.files })), ctx)
      if (!summary) return null
      const { items, ...totals } = summary
      await history.add({ type: 'clean', scope: 'drive', ...totals, items })
      return totals
    },
  })
  return job.id
})

// The renderer tells the window which palette it is on so the caption
// buttons Windows draws match it.
ipcMain.handle('reclaim:titleBarTheme', (_event, theme) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const overlay = theme === 'light' ? TITLE_BAR.light : TITLE_BAR.dark
  try {
    mainWindow.setTitleBarOverlay(overlay)
    mainWindow.setBackgroundColor(theme === 'light' ? '#f4f6f8' : '#090b0d')
  } catch {
    /* an older Electron without overlay support; the strip still draws */
  }
})

ipcMain.handle('reclaim:startClean', async (_event, { targets, graceMs }) => {
  const list = Array.isArray(targets) ? targets : []
  const grace = Number.isFinite(graceMs) ? Math.max(0, Math.min(60_000, graceMs)) : DEFAULT_GRACE_MS
  const job = jobs.create({
    type: 'clean',
    label: `Deleting ${list.length} folder${list.length === 1 ? '' : 's'}`,
    detail: list.length === 1 ? list[0].path : `${list.length} folders across your projects`,
    undoLabel: 'Keep them',
    graceMs: grace,
    run: (ctx) => runClean(list, ctx),
  })
  return job.id
})

ipcMain.handle('reclaim:startAppScan', async () => {
  const job = jobs.create({
    type: 'appscan',
    label: 'Scanning app caches',
    detail: 'Caches, logs and temp files left behind by installed programs',
    run: (ctx) => runAppScan(ctx),
  })
  return job.id
})

ipcMain.handle('reclaim:startAppClean', async (_event, { targets, graceMs }) => {
  const list = Array.isArray(targets) ? targets : []
  // Nothing from the renderer is trusted: every path must be one the catalogue
  // discovers right now, or it is dropped before a job is even created.
  const discovered = new Set((await discoverJunk()).map((entry) => entry.id))
  const accepted = list.filter((target) => {
    if (target.id === RECYCLE_BIN_ID) return true
    return typeof target.path === 'string' && discovered.has(path.normalize(target.path).toLowerCase())
  })
  if (accepted.length === 0) return null

  const grace = Number.isFinite(graceMs) ? Math.max(0, Math.min(60_000, graceMs)) : DEFAULT_GRACE_MS
  const job = jobs.create({
    type: 'appclean',
    label: `Emptying ${accepted.length} folder${accepted.length === 1 ? '' : 's'}`,
    detail: accepted.length === 1 ? accepted[0].path || 'Recycle Bin' : `${accepted.length} app caches and logs`,
    undoLabel: 'Keep them',
    graceMs: grace,
    run: (ctx) => runAppClean(accepted, ctx),
  })
  return job.id
})

// ------------------------------------------------------------- ipc: programs

ipcMain.handle('reclaim:programs', (_event, refresh) => programs.listPrograms(system.slowAgent, { refresh: Boolean(refresh) }))
ipcMain.handle('reclaim:programSizes', (_event, ids) => programs.measureSizes(system.slowAgent, Array.isArray(ids) ? ids : []))

ipcMain.handle('reclaim:uninstall', async (_event, { id, quiet }) => {
  const program = await programs.findProgram(system.slowAgent, id)
  if (!program) return { ok: false, message: 'That program is no longer listed' }
  const result = await programs.uninstall(system.slowAgent, system.runElevated, program, { quiet: quiet !== false })
  if (!result.ok) return result
  // The uninstaller's exit code means little; whether the entry is gone does.
  const still = await programs.findProgram(system.slowAgent, id)
  const removed = !still
  const leftovers = removed ? await programs.findLeftovers(program) : []
  if (removed) await history.add({ type: 'uninstall', program: program.name, publisher: program.publisher, bytes: program.sizeBytes, items: [] })
  return { ok: true, removed, leftovers, message: removed ? undefined : 'The uninstaller closed but the program is still listed — it may have been cancelled' }
})

ipcMain.handle('reclaim:forceRemove', async (_event, id) => {
  const program = await programs.findProgram(system.slowAgent, id)
  if (!program) return { ok: false, message: 'That program is no longer listed' }
  // Leftovers are found first: once the entry is gone, its install folder is not.
  const leftovers = await programs.findLeftovers(program)
  const result = await programs.forceRemove(system.slowAgent, system.runElevated, program)
  if (!result.ok) return result
  await history.add({ type: 'uninstall', program: program.name, publisher: program.publisher, bytes: program.sizeBytes, forced: true, items: [] })
  return { ok: true, removed: true, leftovers }
})

ipcMain.handle('reclaim:deleteLeftovers', async (_event, { programId, programName, targets, graceMs }) => {
  const list = Array.isArray(targets) ? targets : []
  const acceptedPaths = new Set(programs.acceptLeftovers(programId, list.map((target) => target.path)).map((entry) => entry.toLowerCase()))
  const accepted = list.filter((target) => typeof target.path === 'string' && acceptedPaths.has(path.normalize(target.path).replace(/[\\/]+$/, '').toLowerCase()))
  if (accepted.length === 0) return null
  const grace = Number.isFinite(graceMs) ? Math.max(0, Math.min(60_000, graceMs)) : DEFAULT_GRACE_MS
  const label = typeof programName === 'string' && programName.trim() ? programName.trim().slice(0, 80) : 'an uninstalled program'
  const job = jobs.create({
    type: 'appclean',
    label: `Deleting ${accepted.length} leftover folder${accepted.length === 1 ? '' : 's'}`,
    detail: `Left behind by ${label}`,
    undoLabel: 'Keep them',
    graceMs: grace,
    run: (ctx) => runLeftoverClean(label, accepted.map((target) => ({ id: target.path, path: target.path, bytes: target.bytes, files: target.files })), ctx),
  })
  return job.id
})

ipcMain.handle('reclaim:recycleBin', async () => {
  try {
    return await system.recycleBin()
  } catch {
    return { items: 0, bytes: 0 }
  }
})

ipcMain.handle('reclaim:jobs', () => jobs.list())
ipcMain.handle('reclaim:jobCancel', (_event, id) => jobs.cancel(id))
ipcMain.handle('reclaim:jobPause', (_event, { id, paused }) => jobs.setPaused(id, paused))
ipcMain.handle('reclaim:jobsClear', () => jobs.clearFinished())

ipcMain.handle('reclaim:throttle', (_event, level) => {
  if (level) jobs.setThrottle(level)
  return {
    level: jobs.throttle,
    levels: Object.entries(THROTTLES).map(([id, profile]) => ({ id, label: profile.label })),
  }
})

// --------------------------------------------------------------- ipc: system

ipcMain.handle('reclaim:systemSnapshot', async (_event, options) =>
  system.snapshot({ ...(options || {}), ownPids: app.getAppMetrics().map((metric) => metric.pid) }),
)
ipcMain.handle('reclaim:defender', () => system.defenderInfo())

ipcMain.handle('reclaim:setExclusions', async (_event, { paths, remove }) => {
  try {
    return await system.setExclusions(paths, { remove })
  } catch (error) {
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('reclaim:setProcessExclusions', async (_event, { names, remove }) => {
  try {
    return await system.setProcessExclusions(names, { remove })
  } catch (error) {
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('reclaim:setRealtimeProtection', async (_event, enabled) => {
  try {
    return await system.setRealtimeProtection(enabled)
  } catch (error) {
    return { ok: false, message: error.message }
  }
})

// A fixed, hardcoded destination — never built from anything the renderer
// sends — so this can never become a way to open an arbitrary URL.
ipcMain.handle('reclaim:openWindowsSecurity', () => shell.openExternal('windowsdefender://'))

ipcMain.handle('reclaim:lockers', async (_event, paths) => {
  try {
    return await system.findLockers(paths)
  } catch (error) {
    console.warn('[reclaim] could not work out who holds those files', error.message)
    return []
  }
})

ipcMain.handle('reclaim:killProcess', async (_event, pid) => {
  try {
    await system.killProcess(pid)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('reclaim:setPriority', async (_event, { pid, priority }) => {
  try {
    const data = await system.setPriority(pid, priority)
    return { ok: true, priority: data.priority }
  } catch (error) {
    return { ok: false, message: error.message }
  }
})

// ------------------------------------------------------------------ ipc: cpu

/** Wraps a handler so a thrown error reaches the renderer as a plain result. */
function reporting(work) {
  return async (_event, payload) => {
    try {
      return await work(payload)
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }
}

ipcMain.handle('reclaim:cpuInfo', () => system.cpuInfo())
ipcMain.handle('reclaim:systemReport', () => system.systemReport())
ipcMain.handle('reclaim:cpuLive', () => system.cpuLive())
ipcMain.handle('reclaim:applyCpuTweaks', reporting((ids) => system.applyCpuTweaks(ids)))
ipcMain.handle('reclaim:restoreCpu', reporting(() => system.restoreCpu()))
ipcMain.handle('reclaim:setService', reporting(({ name, enabled }) => system.setService(name, enabled)))
ipcMain.handle('reclaim:startupList', () => system.startupList())
ipcMain.handle('reclaim:setStartup', reporting((entry) => system.setStartup(entry)))

// -------------------------------------------------------------- ipc: history

ipcMain.handle('reclaim:history', () => history.list())
ipcMain.handle('reclaim:historyTotals', () => history.totals())
ipcMain.handle('reclaim:historyClear', () => history.clear())
