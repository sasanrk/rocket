import type { CpuInfo, StartupEntry } from '../types/system';
import type { JunkEntry } from '../types/junk';

/**
 * A believable set of leftovers for the browser preview: the same folders the
 * real catalogue finds on a developer's machine, with sizes to match.
 */

const MB = 1024 * 1024;
const HOME = 'C:\\Users\\dev';
const ROAMING = `${HOME}\\AppData\\Roaming`;
const LOCAL = `${HOME}\\AppData\\Local`;

interface Seed {
  app: string;
  appLabel: string;
  category: JunkEntry['category'];
  label: string;
  path: string;
  note: string;
  bytes: number;
  files: number;
  safety?: 'safe' | 'caution';
  processNames?: string[];
}

const SEEDS: Seed[] = [
{ app: 'app:claude', appLabel: 'Claude', category: 'cache', label: 'Compiled script cache', path: `${ROAMING}\\Claude\\Code Cache`, note: 'Scripts compiled for speed; rebuilt on the next launch, which is briefly slower', bytes: 189 * MB, files: 412, processNames: ['claude'] },
{ app: 'app:claude', appLabel: 'Claude', category: 'cache', label: 'Web cache', path: `${ROAMING}\\Claude\\Cache`, note: 'Pages and images the app fetched; downloaded again when needed', bytes: 51 * MB, files: 1180, processNames: ['claude'] },
{ app: 'app:claude', appLabel: 'Claude', category: 'logs', label: 'Logs', path: `${ROAMING}\\Claude\\logs`, note: 'Diagnostic logs, only useful when reporting a bug', bytes: 58 * MB, files: 64, processNames: ['claude'] },
{ app: 'app:claude', appLabel: 'Claude', category: 'cache', label: 'GPU shader cache', path: `${ROAMING}\\Claude\\GPUCache`, note: 'Rebuilt automatically as the app draws', bytes: 5.6 * MB, files: 9, processNames: ['claude'] },
{ app: 'app:code', appLabel: 'Visual Studio Code', category: 'installer', label: 'Extension installers', path: `${ROAMING}\\Code\\CachedExtensionVSIXs`, note: 'Installer packages for extensions already unpacked; only fetched again if you reinstall one', bytes: 313 * MB, files: 41, processNames: ['code'] },
{ app: 'app:code', appLabel: 'Visual Studio Code', category: 'cache', label: 'Cached editor data', path: `${ROAMING}\\Code\\CachedData`, note: 'Compiled editor code; rebuilt on the next start', bytes: 98 * MB, files: 120, processNames: ['code'] },
{ app: 'app:code', appLabel: 'Visual Studio Code', category: 'cache', label: 'Web cache', path: `${ROAMING}\\Code\\Cache`, note: 'Pages and images the app fetched; downloaded again when needed', bytes: 13 * MB, files: 300, processNames: ['code'] },
{ app: 'app:cursor', appLabel: 'Cursor', category: 'cache', label: 'Cached editor data', path: `${ROAMING}\\Cursor\\CachedData`, note: 'Compiled editor code; rebuilt on the next start', bytes: 19 * MB, files: 40, processNames: ['cursor'] },
{ app: 'browser:chrome', appLabel: 'Google Chrome', category: 'cache', label: 'Default profile · Compiled script cache', path: `${LOCAL}\\Google\\Chrome\\User Data\\Default\\Code Cache`, note: 'Scripts compiled for speed; rebuilt on the next launch, which is briefly slower', bytes: 364 * MB, files: 5200, processNames: ['chrome'] },
{ app: 'browser:chrome', appLabel: 'Google Chrome', category: 'cache', label: 'Default profile · Web cache', path: `${LOCAL}\\Google\\Chrome\\User Data\\Default\\Cache`, note: 'Pages and images fetched again when needed', bytes: 93 * MB, files: 2100, processNames: ['chrome'] },
{ app: 'browser:chrome', appLabel: 'Google Chrome', category: 'cache', label: 'Default profile · Offline web content', path: `${LOCAL}\\Google\\Chrome\\User Data\\Default\\Service Worker\\CacheStorage`, note: 'Web content stored for offline use; fetched again, and some sites re-sync on next visit', bytes: 783 * MB, files: 9800, safety: 'caution', processNames: ['chrome'] },
{ app: 'windows', appLabel: 'Windows', category: 'temp', label: 'Temp files', path: `${LOCAL}\\Temp`, note: 'Files installers and apps left behind; anything still in use is skipped', bytes: 2781 * MB, files: 14200 },
{ app: 'windows', appLabel: 'Windows', category: 'crash', label: 'Crash dumps', path: `${LOCAL}\\CrashDumps`, note: 'Memory dumps from programs that crashed', bytes: 25 * MB, files: 3 },
{ app: 'windows', appLabel: 'Windows', category: 'cache', label: 'AMD shader cache', path: `${LOCAL}\\AMD\\DxCache`, note: 'Rebuilt on first launch of each game, which takes a moment longer', bytes: 51 * MB, files: 210 },
{ app: 'devtools', appLabel: 'Developer tools', category: 'dev', label: 'Yarn package cache', path: `${LOCAL}\\Yarn\\Cache`, note: 'Packages are downloaded again by the next install that needs them', bytes: 8264 * MB, files: 310000 },
{ app: 'devtools', appLabel: 'Developer tools', category: 'dev', label: 'npm package cache', path: `${LOCAL}\\npm-cache\\_cacache`, note: 'Packages are downloaded again by the next install that needs them', bytes: 1195 * MB, files: 48000 },
{ app: 'devtools', appLabel: 'Developer tools', category: 'dev', label: 'Electron binary downloads', path: `${LOCAL}\\electron\\Cache`, note: 'Every npm install of an Electron project downloads ~100 MB per version again', bytes: 945 * MB, files: 12, safety: 'caution' },
{ app: 'devtools', appLabel: 'Developer tools', category: 'dev', label: 'pip package cache', path: `${LOCAL}\\pip\\cache`, note: 'Packages are downloaded again by the next install that needs them', bytes: 412 * MB, files: 900 },
{ app: 'devtools', appLabel: 'Developer tools', category: 'logs', label: 'Gradle daemon logs', path: `${HOME}\\.gradle\\daemon`, note: 'Logs from past Gradle daemons', bytes: 428 * MB, files: 80, processNames: ['java'] },
{ app: 'devtools', appLabel: 'Developer tools', category: 'dev', label: 'Gradle dependency cache', path: `${HOME}\\.gradle\\caches`, note: 'Every dependency is downloaded again on the next sync, which can take a long time', bytes: 996 * MB, files: 21000, safety: 'caution', processNames: ['java'] },
{ app: 'claude-code', appLabel: 'Claude Code', category: 'temp', label: 'Shell snapshots', path: `${HOME}\\.claude\\shell-snapshots`, note: 'Captured shell environments; a new one is taken when a session starts', bytes: 24 * MB, files: 180 },
{ app: 'claude-code', appLabel: 'Claude Code', category: 'logs', label: 'MCP server logs', path: `${LOCAL}\\claude-cli-nodejs`, note: 'Per-project logs from MCP servers; written fresh by the next session', bytes: 5 * MB, files: 60 },
{ app: 'jetbrains', appLabel: 'JetBrains IDEs', category: 'logs', label: 'PhpStorm2025.2 · IDE logs', path: `${LOCAL}\\JetBrains\\PhpStorm2025.2\\log`, note: 'Diagnostic logs', bytes: 484 * MB, files: 130, processNames: ['phpstorm64'] },
{ app: 'jetbrains', appLabel: 'JetBrains IDEs', category: 'cache', label: 'AndroidStudio2025.1.3 · Android Studio caches', path: `${LOCAL}\\Google\\AndroidStudio2025.1.3\\caches`, note: 'Rebuilt as you work', bytes: 372 * MB, files: 2400, processNames: ['studio64'] },
{ app: 'telegram', appLabel: 'Telegram Desktop', category: 'cache', label: 'Media cache', path: `${ROAMING}\\Telegram Desktop\\tdata\\user_data\\media_cache`, note: 'Photos and videos you viewed; downloaded again when opened', bytes: 640 * MB, files: 3100, processNames: ['telegram'] }];


export function mockJunkEntries(): JunkEntry[] {
  return SEEDS.map((seed) => ({
    id: seed.path.toLowerCase(),
    app: seed.app,
    appLabel: seed.appLabel,
    category: seed.category,
    label: seed.label,
    path: seed.path,
    note: seed.note,
    safety: seed.safety ?? 'safe',
    processNames: seed.processNames ?? [],
    bytes: Math.round(seed.bytes),
    files: seed.files,
    pending: true,
    removed: false
  }));
}

export function mockRecycleBin() {
  return { items: 3, bytes: 24 * MB };
}

export function mockCpu(): CpuInfo {
  return {
    name: 'Intel(R) Core(TM) i5-4590 CPU @ 3.30GHz',
    cores: 4,
    logical: 4,
    maxMHz: 3301,
    isLaptop: false,
    systemDriveIsSsd: true,
    schemes: [
    { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Balanced' },
    { guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'High performance' },
    { guid: 'a1841308-3541-4fab-bc81-f71556f20b4a', name: 'Power saver' }],

    activeScheme: { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Balanced' },
    overlay: 'unsupported',
    settings: {
      min: { ac: 5, dc: 5 },
      max: { ac: 100, dc: 100 },
      boost: { ac: 2, dc: 2 },
      minCores: { ac: 100, dc: 10 },
      cooling: { ac: 1, dc: 0 }
    },
    prioritySeparation: 2,
    services: {
      SysMain: { name: 'SysMain', label: 'SysMain (Superfetch)', detail: 'Pre-loads programs it thinks you will open. On a hard disk that is constant background reading; on an SSD it mostly does nothing.', status: 'Running', startType: 'Automatic', present: true },
      WSearch: { name: 'WSearch', label: 'Windows Search indexing', detail: 'Indexes every file that changes. On a machine that writes tens of thousands of build files, it keeps a core busy for nothing you search.', status: 'Running', startType: 'Automatic', present: true }
    },
    live: { perfPercent: 74, utilityPercent: 41, currentMHz: 2443, onBattery: null, batteryPercent: null },
    tweaks: [
    { id: 'plan', label: 'High performance power plan', detail: 'Switches from Balanced, which lets the clock idle and parks cores, to the plan that keeps the CPU ready.', laptopNote: 'Uses more battery. Windows keeps the plan across restarts.', active: false, available: true },
    { id: 'max', label: 'Maximum processor state 100%', detail: 'Many laptops ship capped at 99% or lower, which quietly disables the turbo. This lifts the cap on power and on battery.', laptopNote: null, active: true, available: true },
    { id: 'boost', label: 'Turbo boost: aggressive', detail: 'Lets the CPU jump to its boost clock as soon as there is work, instead of ramping up over a few hundred milliseconds.', laptopNote: null, active: true, available: true },
    { id: 'cores', label: 'No core parking', detail: 'Keeps every core awake on power. Windows otherwise puts idle cores to sleep and wakes them a little too late for bursty work like builds.', laptopNote: null, active: true, available: true },
    { id: 'min', label: 'Minimum processor state 100% on power', detail: 'The clock never drops while plugged in, so nothing waits for it to ramp up. Costs idle power and some heat; the battery setting is untouched.', laptopNote: 'Only applies while plugged in.', active: false, available: true },
    { id: 'cooling', label: 'Active cooling', detail: 'Spins the fan up before slowing the CPU down, rather than the other way round. Matters most on laptops, which default to passive on battery.', laptopNote: null, active: true, available: true },
    { id: 'overlay', label: 'Windows power mode: Best performance', detail: 'The slider under Settings → Power. Only some machines have it; where it is missing this step is skipped.', laptopNote: null, active: null, available: false },
    { id: 'foreground', label: 'Favour the program in front', detail: 'Gives the window you are working in three times the CPU share of background work, with short scheduling slices so it stays responsive.', laptopNote: null, active: false, available: true }],

    canRestore: false,
    backupAt: null
  };
}

export function mockStartup(): StartupEntry[] {
  return [
  { id: 'hkcu:Docker Desktop', source: 'hkcu', scope: 'user', name: 'Docker Desktop', command: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', enabled: true },
  { id: 'hkcu:JetBrains Toolbox', source: 'hkcu', scope: 'user', name: 'JetBrains Toolbox', command: `${LOCAL}\\JetBrains\\Toolbox\\bin\\jetbrains-toolbox.exe --minimize`, enabled: true },
  { id: 'hkcu:OneDrive', source: 'hkcu', scope: 'user', name: 'OneDrive', command: 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe /background', enabled: false },
  { id: 'hkcu:MicrosoftEdgeAutoLaunch', source: 'hkcu', scope: 'user', name: 'MicrosoftEdgeAutoLaunch', command: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe --no-startup-window', enabled: true },
  { id: 'hklm:SecurityHealth', source: 'hklm', scope: 'machine', name: 'SecurityHealth', command: 'C:\\WINDOWS\\system32\\SecurityHealthSystray.exe', enabled: true },
  { id: 'hklm:RTHDVCPL', source: 'hklm', scope: 'machine', name: 'RTHDVCPL', command: 'C:\\Program Files\\Realtek\\Audio\\HDA\\RtkNGUI64.exe -s', enabled: true }];

}
