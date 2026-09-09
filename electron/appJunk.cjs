/**
 * Data other programs leave behind that they can live without.
 *
 * Every Chromium-based app — Claude, VS Code, Cursor, Discord, Slack, the
 * browsers — keeps the same few cache folders under its profile: an HTTP
 * cache, a compiled-script cache, GPU shader caches, logs, crash reports.
 * They are rebuilt on demand, so emptying them costs nothing but a slightly
 * slower first launch. Add the caches developer tooling keeps under the user
 * profile and the Windows temp folder, and that is usually several gigabytes
 * of space nobody will miss.
 *
 * Two rules keep this safe:
 *   1. Only folders this module itself discovered may be emptied. The renderer
 *      hands back paths, but every path is re-discovered and re-checked
 *      before anything is unlinked (see `isJunkPath`).
 *   2. Folders are emptied, never removed, so an app never finds its cache
 *      directory missing.
 */
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { measureTree, removeTree, DEFAULT_TUNING } = require('./scanner.cjs')

const HOME = os.homedir()
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')

/**
 * Folders every Chromium-based app keeps under its profile, and what happens
 * when each one is emptied.
 */
const CHROMIUM_SUBDIRS = [
  { segments: ['Cache'], label: 'Web cache', category: 'cache', note: 'Pages and images the app fetched; downloaded again when needed' },
  { segments: ['Code Cache'], label: 'Compiled script cache', category: 'cache', note: 'Scripts compiled for speed; rebuilt on the next launch, which is briefly slower' },
  { segments: ['GPUCache'], label: 'GPU shader cache', category: 'cache', note: 'Rebuilt automatically as the app draws' },
  { segments: ['DawnGraphiteCache'], label: 'GPU shader cache', category: 'cache', note: 'Rebuilt automatically as the app draws' },
  { segments: ['DawnWebGPUCache'], label: 'GPU shader cache', category: 'cache', note: 'Rebuilt automatically as the app draws' },
  { segments: ['DawnCache'], label: 'GPU shader cache', category: 'cache', note: 'Rebuilt automatically as the app draws' },
  { segments: ['ShaderCache'], label: 'GPU shader cache', category: 'cache', note: 'Rebuilt automatically as the app draws' },
  { segments: ['GrShaderCache'], label: 'GPU shader cache', category: 'cache', note: 'Rebuilt automatically as the app draws' },
  { segments: ['GraphiteDawnCache'], label: 'GPU shader cache', category: 'cache', note: 'Rebuilt automatically as the app draws' },
  { segments: ['logs'], label: 'Logs', category: 'logs', note: 'Diagnostic logs, only useful when reporting a bug' },
  { segments: ['Crashpad'], label: 'Crash reports', category: 'crash', note: 'Reports from past crashes; the folder is recreated empty' },
  { segments: ['sentry'], label: 'Error reports', category: 'crash', note: 'Queued error telemetry' },
  { segments: ['CachedData'], label: 'Cached editor data', category: 'cache', note: 'Compiled editor code; rebuilt on the next start' },
  { segments: ['CachedExtensionVSIXs'], label: 'Extension installers', category: 'installer', note: 'Installer packages for extensions already unpacked; only fetched again if you reinstall one' },
  {
    segments: ['Service Worker', 'CacheStorage'],
    label: 'Offline web content',
    category: 'cache',
    safety: 'caution',
    note: 'Web content the app stored for offline use; fetched again, and some apps re-sync on next launch',
  },
]

/** Names that are not obvious from the folder, and the process that owns them. */
const APP_NAMES = {
  claude: { label: 'Claude', processes: ['claude'] },
  code: { label: 'Visual Studio Code', processes: ['code'] },
  'code - insiders': { label: 'VS Code Insiders', processes: ['code - insiders'] },
  cursor: { label: 'Cursor', processes: ['cursor'] },
  windsurf: { label: 'Windsurf', processes: ['windsurf'] },
  kiro: { label: 'Kiro', processes: ['kiro'] },
  antigravity: { label: 'Antigravity', processes: ['antigravity'] },
  discord: { label: 'Discord', processes: ['discord'] },
  slack: { label: 'Slack', processes: ['slack'] },
  postman: { label: 'Postman', processes: ['postman'] },
  notion: { label: 'Notion', processes: ['notion'] },
  figma: { label: 'Figma', processes: ['figma'] },
  obsidian: { label: 'Obsidian', processes: ['obsidian'] },
  signal: { label: 'Signal', processes: ['signal'] },
  whatsapp: { label: 'WhatsApp', processes: ['whatsapp'] },
  'github desktop': { label: 'GitHub Desktop', processes: ['githubdesktop'] },
  'microsoft teams': { label: 'Microsoft Teams', processes: ['teams', 'ms-teams'] },
  electron: { label: 'Electron (development)', processes: ['electron'] },
  'react native debugger': { label: 'React Native Debugger', processes: ['react native debugger'] },
  reactotron: { label: 'Reactotron', processes: ['reactotron'] },
  flipper: { label: 'Flipper', processes: ['flipper'] },
  'ai.opencode.desktop': { label: 'OpenCode', processes: ['opencode'] },
  'kimi-desktop': { label: 'Kimi', processes: ['kimi'] },
  gapgpt: { label: 'GapGPT', processes: ['gapgpt'] },
  composer: { label: 'Composer', processes: ['composer'] },
  devin: { label: 'Devin', processes: ['devin'] },
  zcode: { label: 'ZCode', processes: ['zcode'] },
  jcode: { label: 'JCode', processes: ['jcode'] },
  spotify: { label: 'Spotify', processes: ['spotify'] },
}

/** Reclaim's own profile is left alone: it is the app doing the deleting. */
const SKIP_APPS = new Set(['reclaim', 'rocket', 'microsoft', 'google', 'mozilla', 'adobe'])

const BROWSERS = [
  { key: 'chrome', label: 'Google Chrome', root: path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data'), processes: ['chrome'] },
  { key: 'chrome-beta', label: 'Chrome Beta', root: path.join(LOCALAPPDATA, 'Google', 'Chrome Beta', 'User Data'), processes: ['chrome'] },
  { key: 'edge', label: 'Microsoft Edge', root: path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data'), processes: ['msedge'] },
  { key: 'brave', label: 'Brave', root: path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data'), processes: ['brave'] },
  { key: 'vivaldi', label: 'Vivaldi', root: path.join(LOCALAPPDATA, 'Vivaldi', 'User Data'), processes: ['vivaldi'] },
  { key: 'chromium', label: 'Chromium', root: path.join(LOCALAPPDATA, 'Chromium', 'User Data'), processes: ['chrome', 'chromium'] },
]

const BROWSER_ROOT_SUBDIRS = CHROMIUM_SUBDIRS.filter((entry) =>
  ['ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'Crashpad'].includes(entry.segments[0]),
)
const BROWSER_PROFILE_SUBDIRS = CHROMIUM_SUBDIRS.filter((entry) =>
  ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Service Worker'].includes(entry.segments[0]),
)

const JETBRAINS_PROCESSES = [
  'phpstorm64', 'idea64', 'webstorm64', 'pycharm64', 'rider64', 'goland64', 'clion64', 'rubymine64',
  'datagrip64', 'studio64', 'jetbrains-toolbox',
]

/**
 * Well-known folders outside the Chromium pattern. `path` may hold a `*`
 * segment, which matches every child directory at that level.
 */
function knownFolders() {
  const under = (base, ...parts) => path.join(base, ...parts)
  return [
    // Windows itself
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'Temp'), label: 'Temp files', category: 'temp', note: 'Files installers and apps left behind; anything still in use is skipped' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'CrashDumps'), label: 'Crash dumps', category: 'crash', note: 'Memory dumps from programs that crashed' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'Microsoft', 'Windows', 'WER'), label: 'Error reports', category: 'crash', note: 'Windows Error Reporting queue' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'D3DSCache'), label: 'DirectX shader cache', category: 'cache', note: 'Rebuilt by games and apps as they run' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'NVIDIA', 'DXCache'), label: 'NVIDIA shader cache', category: 'cache', note: 'Rebuilt on first launch of each game, which takes a moment longer' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'NVIDIA', 'GLCache'), label: 'NVIDIA shader cache', category: 'cache', note: 'Rebuilt on first launch of each game, which takes a moment longer' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'AMD', 'DxCache'), label: 'AMD shader cache', category: 'cache', note: 'Rebuilt on first launch of each game, which takes a moment longer' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'AMD', 'GLCache'), label: 'AMD shader cache', category: 'cache', note: 'Rebuilt on first launch of each game, which takes a moment longer' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'SquirrelTemp'), label: 'Installer leftovers', category: 'installer', note: 'Staging files from app installers' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, '*-updater'), label: 'Downloaded app update', category: 'installer', note: 'An update installer an app downloaded; fetched again if it has not been applied yet' },
    { app: 'windows', appLabel: 'Windows', path: under(LOCALAPPDATA, 'Microsoft', 'OneDrive', 'logs'), label: 'OneDrive logs', category: 'logs', note: 'Sync logs', processes: ['onedrive'] },

    // Developer tooling
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'npm-cache', '_cacache'), label: 'npm package cache', category: 'dev', note: 'Packages are downloaded again by the next install that needs them' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'npm-cache', '_logs'), label: 'npm logs', category: 'logs', note: 'Logs from past npm runs' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(APPDATA, 'npm-cache'), label: 'npm package cache (old location)', category: 'dev', note: 'Packages are downloaded again by the next install that needs them' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'Yarn', 'Cache'), label: 'Yarn package cache', category: 'dev', note: 'Packages are downloaded again by the next install that needs them' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'pnpm-cache'), label: 'pnpm metadata cache', category: 'dev', note: 'Registry metadata; refreshed on the next install' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'pip', 'cache'), label: 'pip package cache', category: 'dev', note: 'Packages are downloaded again by the next install that needs them' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'uv', 'cache'), label: 'uv package cache', category: 'dev', note: 'Packages are downloaded again by the next install that needs them' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(APPDATA, 'Composer', 'cache'), label: 'Composer package cache', category: 'dev', note: 'Packages are downloaded again by the next install that needs them' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'NuGet', 'v3-cache'), label: 'NuGet HTTP cache', category: 'dev', note: 'Registry responses; refreshed on the next restore' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'NuGet', 'http-cache'), label: 'NuGet HTTP cache', category: 'dev', note: 'Registry responses; refreshed on the next restore' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'next-swc'), label: 'Next.js compiler downloads', category: 'dev', note: 'Downloaded again the next time a Next.js project starts' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'electron', 'Cache'), label: 'Electron binary downloads', category: 'dev', safety: 'caution', note: 'Every npm install of an Electron project downloads ~100 MB per version again' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'electron-builder', 'Cache'), label: 'electron-builder downloads', category: 'dev', safety: 'caution', note: 'NSIS and winCodeSign are downloaded again on the next packaging run' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'node-gyp', 'Cache'), label: 'Node headers for native builds', category: 'dev', safety: 'caution', note: 'Downloaded again the next time a native module compiles' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'ms-playwright'), label: 'Playwright browsers', category: 'dev', safety: 'caution', note: 'Several hundred MB per browser, restored by npx playwright install' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(HOME, '.gradle', 'daemon'), label: 'Gradle daemon logs', category: 'logs', note: 'Logs from past Gradle daemons', processes: ['java'] },
    { app: 'devtools', appLabel: 'Developer tools', path: under(HOME, '.gradle', '.tmp'), label: 'Gradle temp files', category: 'temp', note: 'Scratch files from past builds' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(HOME, '.gradle', 'caches'), label: 'Gradle dependency cache', category: 'dev', safety: 'caution', note: 'Every dependency is downloaded again on the next sync, which can take a long time', processes: ['java'] },
    { app: 'devtools', appLabel: 'Developer tools', path: under(HOME, '.android', 'cache'), label: 'Android SDK manager cache', category: 'dev', note: 'Repository listings; refreshed by the SDK manager' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(HOME, '.android', 'build-cache'), label: 'Android build cache', category: 'dev', note: 'Pre-dexed libraries; rebuilt on the next build' },
    { app: 'devtools', appLabel: 'Developer tools', path: under(LOCALAPPDATA, 'Docker', 'log'), label: 'Docker Desktop logs', category: 'logs', note: 'Diagnostic logs', processes: ['docker desktop', 'com.docker.backend'] },

    // Claude Code (the CLI). Sessions, projects and settings are never listed.
    { app: 'claude-code', appLabel: 'Claude Code', path: under(LOCALAPPDATA, 'claude-cli-nodejs'), label: 'MCP server logs', category: 'logs', note: 'Per-project logs from MCP servers; written fresh by the next session' },
    { app: 'claude-code', appLabel: 'Claude Code', path: under(HOME, '.claude', 'shell-snapshots'), label: 'Shell snapshots', category: 'temp', note: 'Captured shell environments; a new one is taken when a session starts' },
    { app: 'claude-code', appLabel: 'Claude Code', path: under(HOME, '.claude', 'telemetry'), label: 'Failed telemetry events', category: 'logs', note: 'Usage events that could not be sent' },
    { app: 'claude-code', appLabel: 'Claude Code', path: under(HOME, '.claude', 'cache'), label: 'Download cache', category: 'cache', note: 'Changelog and model lists; fetched again on demand' },
    { app: 'claude-code', appLabel: 'Claude Code', path: under(HOME, '.claude', 'backups'), label: 'Config backups', category: 'temp', note: 'Older copies of .claude.json; the current file is untouched' },

    // JetBrains IDEs and Android Studio
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'JetBrains', '*', 'caches'), label: 'IDE caches', category: 'cache', note: 'Rebuilt as you work', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'JetBrains', '*', 'log'), label: 'IDE logs', category: 'logs', note: 'Diagnostic logs', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'JetBrains', '*', 'tmp'), label: 'IDE temp files', category: 'temp', note: 'Scratch files', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'JetBrains', '*', 'jcef_cache'), label: 'Embedded browser cache', category: 'cache', note: 'Web cache for IDE panels', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'JetBrains', '*', 'index'), label: 'Project indexes', category: 'cache', safety: 'caution', note: 'The IDE re-indexes every open project on next start, which takes minutes', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'Google', 'AndroidStudio*', 'caches'), label: 'Android Studio caches', category: 'cache', note: 'Rebuilt as you work', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'Google', 'AndroidStudio*', 'log'), label: 'Android Studio logs', category: 'logs', note: 'Diagnostic logs', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'Google', 'AndroidStudio*', 'tmp'), label: 'Android Studio temp files', category: 'temp', note: 'Scratch files', processes: JETBRAINS_PROCESSES },
    { app: 'jetbrains', appLabel: 'JetBrains IDEs', path: under(LOCALAPPDATA, 'Google', 'AndroidStudio*', 'index'), label: 'Android Studio indexes', category: 'cache', safety: 'caution', note: 'Every open project is re-indexed on next start', processes: JETBRAINS_PROCESSES },

    // Messaging
    { app: 'telegram', appLabel: 'Telegram Desktop', path: under(APPDATA, 'Telegram Desktop', 'tdata', 'user_data*', 'cache'), label: 'Media cache', category: 'cache', note: 'Photos and files you viewed; downloaded again when opened', processes: ['telegram'] },
    { app: 'telegram', appLabel: 'Telegram Desktop', path: under(APPDATA, 'Telegram Desktop', 'tdata', 'user_data*', 'media_cache'), label: 'Media cache', category: 'cache', note: 'Photos and videos you viewed; downloaded again when opened', processes: ['telegram'] },
    { app: 'telegram', appLabel: 'Telegram Desktop', path: under(APPDATA, 'Telegram Desktop', 'tdata', 'temp'), label: 'Temp files', category: 'temp', note: 'Scratch files from downloads', processes: ['telegram'] },
    { app: 'telegram', appLabel: 'Telegram Desktop', path: under(APPDATA, 'Telegram Desktop', 'tdata', 'dumps'), label: 'Crash dumps', category: 'crash', note: 'Reports from past crashes', processes: ['telegram'] },
    { app: 'teams', appLabel: 'Microsoft Teams', path: under(LOCALAPPDATA, 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams', 'EBWebView', '*', 'Cache'), label: 'Web cache', category: 'cache', note: 'Downloaded again as you use Teams', processes: ['ms-teams', 'teams'] },
    { app: 'teams', appLabel: 'Microsoft Teams', path: under(LOCALAPPDATA, 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams', 'EBWebView', '*', 'Code Cache'), label: 'Compiled script cache', category: 'cache', note: 'Rebuilt on next launch', processes: ['ms-teams', 'teams'] },
    { app: 'teams', appLabel: 'Microsoft Teams', path: under(LOCALAPPDATA, 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams', 'Logs'), label: 'Logs', category: 'logs', note: 'Diagnostic logs', processes: ['ms-teams', 'teams'] },

    // Media
    { app: 'spotify', appLabel: 'Spotify', path: under(LOCALAPPDATA, 'Spotify', 'Storage'), label: 'Streaming cache', category: 'cache', note: 'Songs you streamed recently; streamed again when played', processes: ['spotify'] },
    { app: 'adobe', appLabel: 'Adobe', path: under(APPDATA, 'Adobe', 'Common', 'Media Cache Files'), label: 'Media cache', category: 'cache', note: 'Premiere and After Effects rebuild it when a project opens', processes: ['adobe premiere pro', 'afterfx'] },
    { app: 'adobe', appLabel: 'Adobe', path: under(APPDATA, 'Adobe', 'Common', 'Media Cache'), label: 'Media cache database', category: 'cache', note: 'Rebuilt alongside the media cache', processes: ['adobe premiere pro', 'afterfx'] },
  ]
}

async function isDirectory(target) {
  try {
    return (await fsp.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function listDirectories(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function listNames(dir) {
  try {
    return new Set(await fsp.readdir(dir))
  } catch {
    return null
  }
}

/** Turns a `*` glob segment into a plain regular expression. */
function globToRegExp(segment) {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/** Expands a path whose segments may hold `*`, returning only real directories. */
async function expand(pattern) {
  const segments = pattern.split(path.sep)
  let current = [segments[0] + path.sep]
  for (const segment of segments.slice(1)) {
    if (!segment) continue
    const next = []
    if (segment.includes('*')) {
      const matcher = globToRegExp(segment)
      for (const base of current) {
        const children = await listDirectories(base)
        children.filter((name) => matcher.test(name)).forEach((name) => next.push(path.join(base, name)))
      }
    } else {
      for (const base of current) next.push(path.join(base, segment))
    }
    current = next
  }
  const real = []
  for (const candidate of current) {
    if (await isDirectory(candidate)) real.push(candidate)
  }
  return real
}

function entryFor({ app, appLabel, processes, sub, base, labelPrefix, safety }) {
  const target = path.join(base, ...sub.segments)
  return {
    id: target.toLowerCase(),
    app,
    appLabel,
    category: sub.category,
    label: labelPrefix ? `${labelPrefix} · ${sub.label}` : sub.label,
    path: target,
    note: sub.note,
    safety: safety || sub.safety || 'safe',
    processNames: processes,
    bytes: 0,
    files: 0,
    pending: true,
    removed: false,
  }
}

/** A profile folder is Chromium-shaped when it has a cache and a state file. */
function looksChromium(names) {
  if (!names) return false
  const hasCache = names.has('Cache') || names.has('Code Cache') || names.has('GPUCache')
  const hasState = names.has('Local State') || names.has('Preferences') || names.has('Network') || names.has('Local Storage')
  return hasCache && hasState
}

async function discoverChromiumApps() {
  const found = []
  for (const root of [APPDATA, LOCALAPPDATA]) {
    const children = await listDirectories(root)
    for (const name of children) {
      const key = name.toLowerCase()
      if (SKIP_APPS.has(key)) continue
      const base = path.join(root, name)
      const names = await listNames(base)
      if (!looksChromium(names)) continue

      const known = APP_NAMES[key]
      const app = {
        app: `app:${key}`,
        appLabel: known ? known.label : name,
        processes: known ? known.processes : [key],
      }
      for (const sub of CHROMIUM_SUBDIRS) {
        if (!names.has(sub.segments[0])) continue
        const target = path.join(base, ...sub.segments)
        if (!(await isDirectory(target))) continue
        found.push(entryFor({ ...app, sub, base }))
      }
    }
  }
  return found
}

async function discoverBrowsers() {
  const found = []
  for (const browser of BROWSERS) {
    if (!(await isDirectory(browser.root))) continue
    const app = { app: `browser:${browser.key}`, appLabel: browser.label, processes: browser.processes }
    const rootNames = await listNames(browser.root)

    for (const sub of BROWSER_ROOT_SUBDIRS) {
      if (rootNames && rootNames.has(sub.segments[0]) && (await isDirectory(path.join(browser.root, ...sub.segments)))) {
        found.push(entryFor({ ...app, sub, base: browser.root }))
      }
    }

    const profiles = (await listDirectories(browser.root)).filter(
      (name) => name === 'Default' || /^Profile \d+$/.test(name) || name === 'Guest Profile' || name === 'System Profile',
    )
    for (const profile of profiles) {
      const base = path.join(browser.root, profile)
      const names = await listNames(base)
      if (!names) continue
      for (const sub of BROWSER_PROFILE_SUBDIRS) {
        if (!names.has(sub.segments[0])) continue
        const target = path.join(base, ...sub.segments)
        if (!(await isDirectory(target))) continue
        found.push(entryFor({ ...app, sub, base, labelPrefix: profile === 'Default' ? 'Default profile' : profile }))
      }
    }
  }

  // Firefox keeps its cache apart from its profile.
  const firefoxProfiles = path.join(LOCALAPPDATA, 'Mozilla', 'Firefox', 'Profiles')
  for (const profile of await listDirectories(firefoxProfiles)) {
    const base = path.join(firefoxProfiles, profile)
    const app = { app: 'browser:firefox', appLabel: 'Firefox', processes: ['firefox'] }
    for (const sub of [
      { segments: ['cache2'], label: 'Web cache', category: 'cache', note: 'Pages and images fetched again when needed' },
      { segments: ['startupCache'], label: 'Startup cache', category: 'cache', note: 'Rebuilt on the next launch' },
    ]) {
      if (await isDirectory(path.join(base, ...sub.segments))) {
        found.push(entryFor({ ...app, sub, base, labelPrefix: profile.replace(/^[^.]+\./, '') }))
      }
    }
  }
  const firefoxCrashes = path.join(APPDATA, 'Mozilla', 'Firefox', 'Crash Reports')
  if (await isDirectory(firefoxCrashes)) {
    found.push(
      entryFor({
        app: 'browser:firefox',
        appLabel: 'Firefox',
        processes: ['firefox'],
        sub: { segments: ['Crash Reports'], label: 'Crash reports', category: 'crash', note: 'Reports from past crashes' },
        base: path.join(APPDATA, 'Mozilla', 'Firefox'),
      }),
    )
  }
  return found
}

async function discoverKnown() {
  const found = []
  for (const rule of knownFolders()) {
    const matches = await expand(rule.path)
    for (const target of matches) {
      // A wildcard rule names the matched folder so two IDE versions are told apart.
      const wildcardIndex = rule.path.split(path.sep).findIndex((segment) => segment.includes('*'))
      const matchedName = wildcardIndex >= 0 ? target.split(path.sep)[wildcardIndex] : ''
      found.push({
        id: target.toLowerCase(),
        app: rule.app,
        appLabel: rule.appLabel,
        category: rule.category,
        label: matchedName ? `${matchedName} · ${rule.label}` : rule.label,
        path: target,
        note: rule.note,
        safety: rule.safety || 'safe',
        processNames: rule.processes || [],
        bytes: 0,
        files: 0,
        pending: true,
        removed: false,
      })
    }
  }
  return found
}

/**
 * Everything on this machine that can be emptied without anyone noticing.
 * Fast — a few hundred directory reads — so it is also how a path handed
 * back by the renderer gets re-validated before deletion.
 */
async function discoverJunk() {
  const [apps, browsers, known] = await Promise.all([discoverChromiumApps(), discoverBrowsers(), discoverKnown()])
  const seen = new Set()
  const all = []
  for (const entry of [...apps, ...browsers, ...known]) {
    if (seen.has(entry.id)) continue
    // A folder inside another listed folder would be counted and emptied twice.
    if (all.some((other) => entry.id.startsWith(`${other.id}${path.sep}`))) continue
    seen.add(entry.id)
    all.push(entry)
  }
  return all
}

/** The deletion guard: only a path this module discovered itself may be emptied. */
async function isJunkPath(candidate, discovered = null) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false
  const normalized = path.normalize(candidate)
  if (normalized.split(path.sep).includes('..')) return false
  const list = discovered || (await discoverJunk())
  const wanted = normalized.toLowerCase().replace(/[\\/]+$/, '')
  return list.some((entry) => entry.id === wanted)
}

function ignore() {
  /* recreating the folder is best-effort; the app recreates it too */
}

/**
 * Empties one discovered folder and reports the bytes actually freed.
 *
 * The folder itself is put back afterwards: an app that finds its cache
 * directory missing may refuse to start, whereas an empty one is what it
 * sees on first run.
 */
async function emptyJunk(target, state, tuning = DEFAULT_TUNING, known = null, onProgress = null, discovered = null) {
  if (!(await isJunkPath(target, discovered))) {
    return { ok: false, bytes: 0, files: 0, error: 'Refused: not a folder Reclaim recognises as safe to empty', locked: [] }
  }
  if (!(await isDirectory(target))) {
    return { ok: true, bytes: 0, files: 0, error: null, locked: [] }
  }

  const measured = known && known.bytes > 0 ? known : await measureTree(target, state, null, tuning)
  const width = tuning.deleteBatch || DEFAULT_TUNING.deleteBatch
  const { removed, stubborn } = await removeTree(target, state, width, onProgress)
  await fsp.mkdir(target, { recursive: true }).catch(ignore)

  const after = await measureTree(target, state, null, tuning)
  const freed = Math.max(0, measured.bytes - after.bytes)

  if (state.cancelled) {
    return { ok: false, bytes: freed, files: removed, error: 'Stopped part-way through', locked: [] }
  }

  // Files an app still has open stay behind. Temp folders in particular
  // always hold a few; that is a partial success, not a failure.
  const leftovers = stubborn.filter((entry) => entry.error && entry.error.code !== 'ENOENT')
  if (leftovers.length === 0 || after.files === 0) {
    return { ok: true, bytes: freed, files: removed, error: null, locked: [] }
  }

  return {
    ok: false,
    bytes: freed,
    files: removed,
    error: `${after.files} file${after.files === 1 ? '' : 's'} in use by another program`,
    locked: leftovers.slice(0, 12).map((entry) => entry.path),
  }
}

module.exports = { discoverJunk, isJunkPath, emptyJunk, CHROMIUM_SUBDIRS }
