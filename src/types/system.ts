/** Shapes shared by the Processes, Performance, Tasks and History tabs. */

export type ProcessGroup = 'node' | 'build' | 'editor' | 'browser' | 'security' | 'system' | 'other';

export type PriorityClass = 'Idle' | 'BelowNormal' | 'Normal' | 'AboveNormal' | 'High';

export interface ProcessInfo {
  pid: number;
  name: string;
  /** Window title, when the process has a window. Often the best label there is. */
  title: string;
  group: ProcessGroup;
  groupLabel: string;
  /** Share of the whole machine, so four cores at full tilt reads as 100. */
  cpu: number;
  memoryBytes: number;
  priority: PriorityClass | string;
  threads: number;
  startedAt: string | null;
  commandLine: string;
  /** Windows or Reclaim itself — the app refuses to end these. */
  protected: boolean;
  isSelf: boolean;
}

export interface DiskInfo {
  root: string;
  totalBytes: number;
  freeBytes: number;
}

export interface SystemSnapshot {
  at: string;
  cores: number;
  /** Milliseconds between this reading and the last; 0 on the first one. */
  sampleMs: number;
  cpuPercent: number;
  memory: {totalBytes: number;freeBytes: number;usedBytes: number;};
  uptimeSeconds: number;
  disks: DiskInfo[];
  processes: ProcessInfo[];
}

/** A folder the user's tooling writes to constantly, and whether it is spared. */
export interface DevCachePath {
  path: string;
  label: string;
  covered: boolean;
}

export interface DefenderInfo {
  /** False when Defender's cmdlets are unavailable (another suite is in charge). */
  available: boolean;
  running: boolean;
  memoryMB: number;
  realTimeProtection: boolean | null;
  behaviorMonitor: boolean | null;
  scanInProgress: boolean;
  /** Share of the CPU a scheduled scan may take, 1-100. */
  cpuLoadFactor: number | null;
  onlyWhenIdle: boolean | null;
  /** True when a scan missed while the machine was off reruns at next boot. */
  catchUpQuick: boolean;
  catchUpFull: boolean;
  lastQuickScan: string | null;
  /**
   * Windows only allows real-time protection to be toggled from outside
   * itself when this is off; `null` when the running build cannot report it.
   */
  tamperProtected: boolean | null;
  exclusions: string[];
  exclusionProcess: string[];
  devPaths: DevCachePath[];
}

export type JobStatus = 'grace' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobProgress {
  done: number;
  total: number;
  currentPath: string;
  /** Deletions report in bytes and files too, which is what a percentage needs. */
  bytesDone?: number;
  bytesTotal?: number;
  filesDone?: number;
  filesTotal?: number;
  /** Epoch ms the work began, for working out a rate and a time remaining. */
  startedAt?: number;
}

/** A program holding a file open, as named by the Windows Restart Manager. */
export interface LockerInfo {
  pid: number;
  name: string;
  title: string;
  protected: boolean;
}

export type JobType = 'scan' | 'clean' | 'appscan' | 'appclean' | 'move' | 'drivescan';

export interface Job {
  id: string;
  type: JobType;
  label: string;
  detail: string;
  undoLabel: string;
  status: JobStatus;
  createdAt: number;
  /** Epoch ms the undo window closes on, for jobs still on the runway. */
  graceEndsAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  progress: JobProgress;
  result: JobResult | null;
  error: string | null;
  paused: boolean;
}

export interface JobResult {
  root?: string;
  projects?: number;
  /** Moves report where the project went and what the copy carried. */
  destination?: string;
  moved?: number;
  freed?: number;
  /** App-cache scans count entries rather than projects. */
  entries?: number;
  reclaimable?: number;
  folders?: number;
  attempted?: number;
  bytes?: number;
  failures?: number;
  durationMs?: number;
  cancelled?: boolean;
}

export interface HistoryItem {
  path: string;
  bytes: number;
  ok: boolean;
  error: string | null;
}

export interface HistoryEntry {
  id: string;
  at: string;
  type: 'scan' | 'clean' | 'uninstall' | 'move';
  /** `apps` marks a cleanup of app caches, `leftovers` one of an uninstalled program's folders, `drive` one from the drive view. */
  scope?: 'projects' | 'apps' | 'leftovers' | 'drive';
  /** For moves: where the project went, and how many bytes travelled. */
  destination?: string;
  moved?: number;
  /** For uninstall entries: the program that went, and whether it was forced off the list. */
  program?: string;
  publisher?: string;
  forced?: boolean;
  root?: string;
  projects?: number;
  reclaimable?: number;
  folders?: number;
  attempted?: number;
  bytes?: number;
  failures?: number;
  durationMs?: number;
  cancelled?: boolean;
  items: HistoryItem[];
  itemsTruncated?: number;
}

export interface HistoryTotals {
  bytes: number;
  folders: number;
  cleanups: number;
  entries: number;
}

export interface ThrottleLevel {
  id: string;
  label: string;
}

export interface ThrottleState {
  level: string;
  levels: ThrottleLevel[];
}

/** What came back from an attempt to change Defender's exclusion list. */
export interface ExclusionResult {
  ok: boolean;
  /** How many folders Windows actually recorded, read back afterwards. */
  changed?: number;
  attempted?: number;
  /** The settings as they stand now, so the panel can refresh from one call. */
  defender?: DefenderInfo;
  message?: string;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  priority?: string;
}

export const PRIORITY_CHOICES: {value: PriorityClass;label: string;hint: string;}[] = [
{ value: 'Idle', label: 'Idle', hint: 'Only runs when nothing else wants the CPU' },
{ value: 'BelowNormal', label: 'Below normal', hint: 'Yields to whatever you are typing in' },
{ value: 'Normal', label: 'Normal', hint: 'The default every process starts at' },
{ value: 'AboveNormal', label: 'Above normal', hint: 'Wins ties against ordinary processes' },
{ value: 'High', label: 'High', hint: 'Use sparingly — it can starve the desktop' }];

// ------------------------------------------------------------------- CPU

/** An AC (plugged in) and DC (battery) value of one processor power setting. */
export interface PowerValue {
  ac: number | null;
  dc: number | null;
}

export interface CpuTweak {
  id: string;
  label: string;
  detail: string;
  laptopNote: string | null;
  /** True when already in effect, false when not, null when Windows will not say. */
  active: boolean | null;
  /** False when the machine has no such setting, e.g. no power-mode slider. */
  available: boolean;
}

export interface ServiceState {
  name: string;
  label: string;
  detail: string;
  status: string;
  startType: string;
  present: boolean;
}

/** The cheap reading, polled while the CPU tab is open. */
export interface CpuLive {
  /** Current clock as a share of the nominal one; over 100 means turbo is engaged. */
  perfPercent: number | null;
  utilityPercent: number | null;
  currentMHz: number | null;
  onBattery: boolean | null;
  batteryPercent: number | null;
}

export interface CpuInfo {
  name: string;
  cores: number;
  logical: number;
  maxMHz: number | null;
  isLaptop: boolean;
  systemDriveIsSsd: boolean | null;
  schemes: {guid: string;name: string;}[];
  activeScheme: {guid: string;name: string;} | null;
  /** Windows' power-mode slider: max / high / balanced / saver, or unsupported. */
  overlay: string;
  settings: Record<string, PowerValue | null>;
  prioritySeparation: number | null;
  services: Record<string, ServiceState>;
  live: CpuLive;
  tweaks: CpuTweak[];
  /** True once Reclaim has changed something and kept the original values. */
  canRestore: boolean;
  backupAt: string | null;
}

export interface CpuResult {
  ok: boolean;
  changed?: number;
  attempted?: number;
  cpu?: CpuInfo;
  message?: string;
}

export interface StartupEntry {
  id: string;
  source: string;
  /** Machine-wide entries need an administrator prompt to change. */
  scope: 'user' | 'machine';
  name: string;
  command: string;
  enabled: boolean;
}

export interface StartupResult {
  ok: boolean;
  enabled?: boolean;
  message?: string;
}
