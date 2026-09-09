const { contextBridge, ipcRenderer, webUtils } = require('electron')

/**
 * The whole surface the renderer is allowed to touch.
 *
 * Long-running work is not awaited here: `startScan` and `startClean` return a
 * job id immediately and everything after that arrives on a broadcast channel,
 * so closing a panel or switching tabs never stops the work.
 */

/** Subscribes to a broadcast channel and hands back an unsubscribe function. */
function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('reclaim', {
  isNative: true,
  platform: process.platform,

  // ------------------------------------------------------------------ folders
  chooseFolder: (options) => ipcRenderer.invoke('reclaim:chooseFolder', options || {}),
  drives: () => ipcRenderer.invoke('reclaim:drives'),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('reclaim:titleBarTheme', theme),
  recentFolders: () => ipcRenderer.invoke('reclaim:recentFolders'),
  initialRoot: () => ipcRenderer.invoke('reclaim:initialRoot'),
  revealInExplorer: (target) => ipcRenderer.invoke('reclaim:reveal', target),
  openPath: (target) => ipcRenderer.invoke('reclaim:openPath', target),

  // Drag and drop: only the preload can turn a dropped File into a real path.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  // --------------------------------------------------------------------- jobs
  startScan: (root, depth) => ipcRenderer.invoke('reclaim:startScan', { root, depth }),
  planMove: (source, destination) => ipcRenderer.invoke('reclaim:planMove', { source, destination }),
  moveProject: (source, destination, graceMs) => ipcRenderer.invoke('reclaim:moveProject', { source, destination, graceMs }),
  startDriveScan: (dir) => ipcRenderer.invoke('reclaim:startDriveScan', dir),
  deleteFolders: (targets, graceMs) =>
    ipcRenderer.invoke('reclaim:deleteFolders', {
      targets: targets.map((target) => ({ path: target.path, bytes: target.bytes, files: target.files })),
      graceMs,
    }),
  startClean: (targets, graceMs) =>
    ipcRenderer.invoke('reclaim:startClean', {
      targets: targets.map((target) => ({
        id: target.id,
        path: target.path,
        bytes: target.bytes,
        files: target.files,
      })),
      graceMs,
    }),
  startAppScan: () => ipcRenderer.invoke('reclaim:startAppScan'),
  startAppClean: (targets, graceMs) =>
    ipcRenderer.invoke('reclaim:startAppClean', {
      targets: targets.map((target) => ({
        id: target.id,
        path: target.path,
        bytes: target.bytes,
        files: target.files,
      })),
      graceMs,
    }),
  recycleBin: () => ipcRenderer.invoke('reclaim:recycleBin'),

  // ----------------------------------------------------------------- programs
  programs: (refresh) => ipcRenderer.invoke('reclaim:programs', Boolean(refresh)),
  programSizes: (ids) => ipcRenderer.invoke('reclaim:programSizes', ids),
  uninstallProgram: (id, quiet) => ipcRenderer.invoke('reclaim:uninstall', { id, quiet }),
  forceRemoveProgram: (id) => ipcRenderer.invoke('reclaim:forceRemove', id),
  deleteLeftovers: (programId, programName, targets, graceMs) =>
    ipcRenderer.invoke('reclaim:deleteLeftovers', {
      programId,
      programName,
      targets: targets.map((target) => ({ path: target.path, bytes: target.bytes, files: target.files })),
      graceMs,
    }),
  listJobs: () => ipcRenderer.invoke('reclaim:jobs'),
  cancelJob: (id) => ipcRenderer.invoke('reclaim:jobCancel', id),
  pauseJob: (id, paused) => ipcRenderer.invoke('reclaim:jobPause', { id, paused }),
  clearFinishedJobs: () => ipcRenderer.invoke('reclaim:jobsClear'),
  throttle: (level) => ipcRenderer.invoke('reclaim:throttle', level),

  onJobs: (handler) => subscribe('reclaim:jobs', handler),
  onJobEvent: (handler) => subscribe('reclaim:job-event', handler),
  onJobProgress: (handler) => subscribe('reclaim:job-progress', handler),
  onJobFinished: (handler) => subscribe('reclaim:job-finished', handler),

  // ------------------------------------------------------------------- system
  systemSnapshot: (options) => ipcRenderer.invoke('reclaim:systemSnapshot', options),
  defenderInfo: () => ipcRenderer.invoke('reclaim:defender'),
  killProcess: (pid) => ipcRenderer.invoke('reclaim:killProcess', pid),
  findLockers: (paths) => ipcRenderer.invoke('reclaim:lockers', paths),
  setExclusions: (paths, remove) => ipcRenderer.invoke('reclaim:setExclusions', { paths, remove }),
  setProcessExclusions: (names, remove) => ipcRenderer.invoke('reclaim:setProcessExclusions', { names, remove }),
  setRealtimeProtection: (enabled) => ipcRenderer.invoke('reclaim:setRealtimeProtection', enabled),
  openWindowsSecurity: () => ipcRenderer.invoke('reclaim:openWindowsSecurity'),
  setProcessPriority: (pid, priority) => ipcRenderer.invoke('reclaim:setPriority', { pid, priority }),

  // ---------------------------------------------------------------------- cpu
  cpuInfo: () => ipcRenderer.invoke('reclaim:cpuInfo'),
  systemReport: () => ipcRenderer.invoke('reclaim:systemReport'),
  cpuLive: () => ipcRenderer.invoke('reclaim:cpuLive'),
  applyCpuTweaks: (ids) => ipcRenderer.invoke('reclaim:applyCpuTweaks', ids),
  restoreCpu: () => ipcRenderer.invoke('reclaim:restoreCpu'),
  setService: (name, enabled) => ipcRenderer.invoke('reclaim:setService', { name, enabled }),
  startupList: () => ipcRenderer.invoke('reclaim:startupList'),
  setStartup: (entry) =>
    ipcRenderer.invoke('reclaim:setStartup', { source: entry.source, name: entry.name, enabled: entry.enabled }),

  // ------------------------------------------------------------------ history
  history: () => ipcRenderer.invoke('reclaim:history'),
  historyTotals: () => ipcRenderer.invoke('reclaim:historyTotals'),
  clearHistory: () => ipcRenderer.invoke('reclaim:historyClear'),
})
