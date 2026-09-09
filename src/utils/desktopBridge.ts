import type {
  ActionResult,
  CpuInfo,
  CpuLive,
  CpuResult,
  DefenderInfo,
  HistoryEntry,
  HistoryTotals,
  Job,
  JobProgress,
  JobStatus,
  ExclusionResult,
  LockerInfo,
  PriorityClass,
  StartupEntry,
  StartupResult,
  SystemSnapshot,
  ThrottleState } from
'../types/system';
import type { RecycleBinInfo } from '../types/junk';
import type { InstalledProgram, Leftover, UninstallResult } from '../types/programs';
import type { DriveFolder, DriveInfo, MovePlan } from '../types/drives';
import type { SystemReport } from '../types/specs';
import { mockSystemReport } from '../data/mockSpecs';
import { mockProjects, mockRoot, recentRoots } from '../data/mockProjects';
import { mockSnapshot, mockDefender } from '../data/mockSystem';
import { mockCpu, mockJunkEntries, mockRecycleBin, mockStartup } from '../data/mockJunk';
import { mockPrograms } from '../data/mockPrograms';

/**
 * Single seam between the UI and the machine.
 *
 * In the browser preview this is backed by an in-memory simulation. Inside
 * Electron, `electron/preload.cjs` exposes exactly this shape on
 * `window.reclaim`, so every screen keeps working untouched against the real
 * filesystem and the real process table.
 *
 * Work is started, not awaited: `startScan` and `startClean` hand back a job id
 * and everything after that arrives on a subscription, so the window can close
 * a panel or change tabs without stopping anything.
 */

export type Unsubscribe = () => void;

export interface JobEvent {
  jobId: string;
  /**
   * `discovered` is the full list of project paths, sent as soon as the walk
   * finishes so the table fills in straight away; `projects` then carries
   * measured batches every 150ms, and `dropped` retires a placeholder that
   * turned out to have nothing in it.
   */
  event: 'discovered' | 'dropped' | 'projects' | 'junk' | 'removed' | 'failed' | 'moved' | 'folders';
  payload: unknown;
}

export interface JobProgressEvent {
  jobId: string;
  progress: JobProgress;
  status: JobStatus;
}

export interface RemoveTarget {
  id: string;
  path: string;
  /** Measured during the scan, so deleting need not walk the tree first. */
  bytes: number;
  files: number;
}

export interface DesktopApi {
  /** True when running inside Electron with real filesystem access. */
  isNative: boolean;
  platform: string;

  chooseFolder(options?: {title?: string;buttonLabel?: string;defaultPath?: string;}): Promise<string | null>;
  /** Every drive that answers, with totals. */
  drives(): Promise<DriveInfo[]>;
  /** Recolours the caption buttons Windows draws over the frameless window. */
  setTitleBarTheme(theme: 'dark' | 'light'): Promise<void>;
  /** Folders scanned before, newest first. Empty until the first real scan. */
  recentFolders(): Promise<string[]>;
  /** Folder passed as `--scan <dir>` at launch, scanned automatically on start. */
  initialRoot(): Promise<string | null>;
  revealInExplorer(path: string): Promise<void>;
  openPath(path: string): Promise<string | null>;
  /** Only available in Electron: resolves a dropped folder to a real path. */
  pathForFile?: (file: File) => string;

  /** `depth` is how many levels down the walk goes; a whole drive needs more than a chosen folder. */
  startScan(root: string, depth?: number): Promise<string>;
  /** What a move would carry and leave behind, before anything happens. */
  planMove(source: string, destinationParent: string): Promise<MovePlan>;
  /** Queues a move behind the grace window; the project's row follows the folder. */
  moveProject(source: string, destinationParent: string, graceMs?: number): Promise<{ok: boolean;jobId?: string;message?: string;}>;
  /** Measures the folders directly under a path; they arrive on `folders` events. */
  startDriveScan(dir: string): Promise<string | null>;
  /** Deletes folders picked from the drive view; only ones that view reported are accepted. */
  deleteFolders(targets: DriveFolder[], graceMs?: number): Promise<string | null>;
  /** `graceMs` is the window in which cancelling means nothing was deleted. */
  startClean(targets: RemoveTarget[], graceMs?: number): Promise<string>;
  /** Finds and measures app caches, logs and temp folders; entries arrive on `junk` events. */
  startAppScan(): Promise<string>;
  /**
   * Empties the given app folders. Every path is re-checked against the
   * catalogue in the main process; `null` means nothing was accepted.
   */
  startAppClean(targets: RemoveTarget[], graceMs?: number): Promise<string | null>;
  recycleBin(): Promise<RecycleBinInfo>;

  /** The Add/Remove list plus Store apps. `refresh` bypasses the one-minute cache. */
  programs(refresh?: boolean): Promise<InstalledProgram[]>;
  /** Install-folder sizes for programs whose entry carried none. */
  programSizes(ids: string[]): Promise<Record<string, number>>;
  /** Runs the program's own uninstaller (quiet variant when it has one) and reports whether it is gone. */
  uninstallProgram(id: string, quiet?: boolean): Promise<UninstallResult>;
  /** Takes a broken entry off the list without running anything. */
  forceRemoveProgram(id: string): Promise<UninstallResult>;
  /** Queues deletion of leftover folders offered by an uninstall; `null` if none were accepted. */
  deleteLeftovers(programId: string, programName: string, targets: Leftover[], graceMs?: number): Promise<string | null>;
  listJobs(): Promise<Job[]>;
  cancelJob(id: string): Promise<{ok: boolean;undone: boolean;}>;
  pauseJob(id: string, paused: boolean): Promise<{ok: boolean;paused?: boolean;}>;
  clearFinishedJobs(): Promise<Job[]>;
  throttle(level?: string): Promise<ThrottleState>;

  onJobs(handler: (jobs: Job[]) => void): Unsubscribe;
  onJobEvent(handler: (event: JobEvent) => void): Unsubscribe;
  onJobProgress(handler: (event: JobProgressEvent) => void): Unsubscribe;
  onJobFinished(handler: (event: {job: Job;}) => void): Unsubscribe;

  systemSnapshot(options?: {withCommandLines?: boolean;}): Promise<SystemSnapshot>;
  defenderInfo(): Promise<DefenderInfo>;
  killProcess(pid: number): Promise<ActionResult>;
  /** Asks Windows which programs hold these paths open. */
  findLockers(paths: string[]): Promise<LockerInfo[]>;
  /**
   * Adds or removes Defender folder exclusions. Needs administrator rights, so
   * it raises a UAC prompt; declining that comes back as a plain failure.
   */
  setExclusions(paths: string[], remove?: boolean): Promise<ExclusionResult>;
  /** Same as `setExclusions`, but by executable name rather than by folder. */
  setProcessExclusions(names: string[], remove?: boolean): Promise<ExclusionResult>;
  /**
   * Turns Defender's real-time protection on or off machine-wide. Refused
   * outright when Windows' own Tamper Protection is on — that setting exists
   * so a program cannot do this on its own, and Reclaim will not try to get
   * around it.
   */
  setRealtimeProtection(enabled: boolean): Promise<ExclusionResult>;
  /** Opens the Windows Security app, for settings Reclaim will not touch itself. */
  openWindowsSecurity(): Promise<void>;
  setProcessPriority(pid: number, priority: PriorityClass): Promise<ActionResult>;

  /** Hardware, the active power plan's processor values, and what each tweak would change. */
  cpuInfo(): Promise<CpuInfo>;
  /** Everything in the box plus the upgrade paths worked out from it. */
  systemReport(): Promise<SystemReport>;
  /** The cheap reading: clock, load and battery, for polling. */
  cpuLive(): Promise<CpuLive>;
  /** Applies tweaks by id in one administrator prompt; originals are kept for `restoreCpu`. */
  applyCpuTweaks(ids: string[]): Promise<CpuResult>;
  restoreCpu(): Promise<CpuResult>;
  setService(name: string, enabled: boolean): Promise<CpuResult>;
  startupList(): Promise<StartupEntry[]>;
  setStartup(entry: {source: string;name: string;enabled: boolean;}): Promise<StartupResult>;

  history(): Promise<HistoryEntry[]>;
  historyTotals(): Promise<HistoryTotals>;
  clearHistory(): Promise<HistoryEntry[]>;
}

declare global {
  interface Window {
    reclaim?: DesktopApi;
  }
}

const NOISE_FOLDERS = [
'src\\components',
'node_modules\\.pnpm',
'.git\\objects',
'app\\src\\main',
'packages\\ui\\src',
'gradle\\wrapper',
'public\\assets',
'.next\\cache\\webpack'];


function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Preview mode has no filesystem, so freed bytes come from the mock sizes. */
function mockTargetBytes(targetId: string): number {
  for (const project of mockProjects) {
    const match = project.targets.find((target) => target.id === targetId);
    if (match) return match.bytes;
  }
  return 0;
}

type JobListenerKind = 'jobs' | 'event' | 'progress' | 'finished';

/**
 * A job manager small enough to live in the browser, so the whole UI —
 * including the undo runway and the task dock — can be exercised without
 * Electron.
 */
class MockJobs {
  private jobs: Job[] = [];
  private seq = 0;
  private listeners: Record<JobListenerKind, Set<(payload: never) => void>> = {
    jobs: new Set(),
    event: new Set(),
    progress: new Set(),
    finished: new Set()
  };
  private cancelled = new Set<string>();
  private paused = new Set<string>();

  list(): Job[] {
    return this.jobs.map((job) => ({ ...job, progress: { ...job.progress } }));
  }

  on(kind: JobListenerKind, handler: (payload: never) => void): Unsubscribe {
    this.listeners[kind].add(handler);
    return () => {this.listeners[kind].delete(handler);};
  }

  private announce() {
    const snapshot = this.list();
    this.listeners.jobs.forEach((handler) => (handler as (jobs: Job[]) => void)(snapshot));
  }

  private progress(job: Job, patch: Partial<JobProgress>) {
    job.progress = { ...job.progress, ...patch };
    this.listeners.progress.forEach((handler) =>
    (handler as (event: JobProgressEvent) => void)({
      jobId: job.id,
      progress: { ...job.progress },
      status: job.status
    })
    );
    this.announce();
  }

  private emit(job: Job, event: JobEvent['event'], payload: unknown) {
    this.listeners.event.forEach((handler) =>
    (handler as (event: JobEvent) => void)({ jobId: job.id, event, payload })
    );
  }

  private finish(job: Job, status: JobStatus) {
    job.status = status;
    job.finishedAt = Date.now();
    this.announce();
    this.listeners.finished.forEach((handler) => (handler as (event: {job: Job;}) => void)({ job: { ...job } }));
  }

  private async waitWhilePaused(job: Job) {
    while (this.paused.has(job.id) && !this.cancelled.has(job.id)) {
      await delay(120);
    }
  }

  cancel(id: string): {ok: boolean;undone: boolean;} {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.finishedAt) return { ok: false, undone: false };
    const undone = job.status === 'grace' || job.status === 'queued';
    this.cancelled.add(id);
    this.paused.delete(id);
    if (undone) this.finish(job, 'cancelled');else
    this.announce();
    return { ok: true, undone };
  }

  setPaused(id: string, paused: boolean) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.finishedAt) return { ok: false };
    if (paused) this.paused.add(id);else
    this.paused.delete(id);
    job.paused = paused;
    this.announce();
    return { ok: true, paused };
  }

  clearFinished(): Job[] {
    this.jobs = this.jobs.filter((job) => !job.finishedAt);
    this.announce();
    return this.list();
  }

  private create(partial: Pick<Job, 'type' | 'label' | 'detail'> & {undoLabel?: string;graceMs?: number;}): Job {
    const graceMs = partial.graceMs ?? 0;
    const job: Job = {
      id: `j${this.seq += 1}`,
      type: partial.type,
      label: partial.label,
      detail: partial.detail,
      undoLabel: partial.undoLabel ?? 'Undo',
      status: graceMs > 0 ? 'grace' : 'queued',
      createdAt: Date.now(),
      graceEndsAt: graceMs > 0 ? Date.now() + graceMs : null,
      startedAt: null,
      finishedAt: null,
      progress: { done: 0, total: 0, currentPath: '' },
      result: null,
      error: null,
      paused: false
    };
    this.jobs.unshift(job);
    this.announce();
    return job;
  }

  scan(root: string): string {
    const job = this.create({ type: 'scan', label: `Scanning ${root.split('\\').filter(Boolean).pop() ?? root}`, detail: root });

    void (async () => {
      job.status = 'running';
      job.startedAt = Date.now();
      this.announce();

      const total = mockProjects.length;
      this.emit(
        job,
        'discovered',
        mockProjects.map((project) => `${root}\\${project.name}`)
      );

      for (let index = 0; index < total; index += 1) {
        await this.waitWhilePaused(job);
        if (this.cancelled.has(job.id)) break;
        this.progress(job, {
          done: index,
          total,
          currentPath: `${root}\\${mockProjects[index].name}\\${NOISE_FOLDERS[index % NOISE_FOLDERS.length]}`
        });
        await delay(150 + Math.random() * 130);
        if (this.cancelled.has(job.id)) break;
        this.emit(job, 'projects', [
        {
          ...mockProjects[index],
          path: `${root}\\${mockProjects[index].name}`,
          targets: mockProjects[index].targets.map((target) => ({ ...target, removed: false }))
        }]
        );
      }

      this.progress(job, { done: total, total, currentPath: root });
      const reclaimable = mockProjects.reduce(
        (sum, project) => sum + project.targets.reduce((inner, target) => inner + target.bytes, 0),
        0
      );
      job.result = {
        root,
        projects: total,
        reclaimable,
        durationMs: Date.now() - (job.startedAt ?? Date.now())
      };
      this.finish(job, this.cancelled.has(job.id) ? 'cancelled' : 'done');
    })();

    return job.id;
  }

  appScan(): string {
    const job = this.create({
      type: 'appscan',
      label: 'Scanning app caches',
      detail: 'Caches, logs and temp files left behind by installed programs'
    });

    void (async () => {
      job.status = 'running';
      job.startedAt = Date.now();
      this.announce();

      const entries = mockJunkEntries();
      this.emit(job, 'junk', entries);

      let reclaimable = 0;
      for (let index = 0; index < entries.length; index += 1) {
        await this.waitWhilePaused(job);
        if (this.cancelled.has(job.id)) break;
        this.progress(job, { done: index, total: entries.length, currentPath: entries[index].path });
        await delay(90 + Math.random() * 120);
        if (this.cancelled.has(job.id)) break;
        reclaimable += entries[index].bytes;
        this.emit(job, 'junk', [{ ...entries[index], pending: false }]);
      }

      this.progress(job, { done: entries.length, total: entries.length, currentPath: '' });
      job.result = { entries: entries.length, reclaimable, durationMs: Date.now() - (job.startedAt ?? Date.now()) };
      this.finish(job, this.cancelled.has(job.id) ? 'cancelled' : 'done');
    })();

    return job.id;
  }

  clean(targets: RemoveTarget[], graceMs: number, type: 'clean' | 'appclean' = 'clean'): string {
    const job = this.create({
      type,
      label: `${type === 'appclean' ? 'Emptying' : 'Deleting'} ${targets.length} folder${targets.length === 1 ? '' : 's'}`,
      detail: targets.length === 1 ? targets[0].path : `${targets.length} folders${type === 'appclean' ? '' : ' across your projects'}`,
      undoLabel: 'Keep them',
      graceMs
    });

    void (async () => {
      if (graceMs > 0) {
        await delay(graceMs);
        // Cancelling inside the runway means nothing was ever deleted.
        if (this.cancelled.has(job.id)) return;
      }

      job.status = 'running';
      job.startedAt = Date.now();
      this.announce();

      // The real scanner reports in bytes and files as well as folders, so the
      // preview does too — otherwise the progress panel looks broken here.
      const bytesTotal = targets.reduce((sum, target) => sum + (target.bytes || mockTargetBytes(target.id)), 0);
      const filesTotal = targets.reduce((sum, target) => sum + (target.files || 0), 0);
      let bytes = 0;
      let files = 0;

      for (let index = 0; index < targets.length; index += 1) {
        await this.waitWhilePaused(job);
        if (this.cancelled.has(job.id)) break;
        this.progress(job, {
          done: index,
          total: targets.length,
          currentPath: targets[index].path,
          bytesDone: bytes,
          bytesTotal,
          filesDone: files,
          filesTotal,
          startedAt: job.startedAt ?? Date.now()
        });
        await delay(240 + Math.random() * 200);
        if (this.cancelled.has(job.id)) break;
        const freed = targets[index].bytes || mockTargetBytes(targets[index].id);
        bytes += freed;
        files += targets[index].files || 0;
        this.emit(job, 'removed', { targetId: targets[index].id, bytes: freed });
      }

      this.progress(job, {
        done: targets.length,
        total: targets.length,
        currentPath: '',
        bytesDone: bytes,
        bytesTotal,
        filesDone: files,
        filesTotal,
        startedAt: job.startedAt ?? Date.now()
      });
      job.result = { folders: targets.length, attempted: targets.length, bytes, failures: 0 };
      this.finish(job, this.cancelled.has(job.id) ? 'cancelled' : 'done');
    })();

    return job.id;
  }
}

const mockJobs = new MockJobs();
let mockThrottle = 'balanced';
let mockHistory: HistoryEntry[] = [];

const mockApi: DesktopApi = {
  isNative: false,
  platform: 'web-preview',

  async chooseFolder() {
    return mockRoot;
  },
  async drives() {
    return mockSnapshot().disks.map((disk) => ({ ...disk, system: disk.root.startsWith('C:') }));
  },
  async setTitleBarTheme() {
    /* the browser has no window frame to recolour */
  },
  async planMove(source, destination) {
    return {
      ok: true,
      source,
      destination: `${destination}\\${source.split('\\').pop() ?? ''}`,
      sameDrive: source.slice(0, 2).toUpperCase() === destination.slice(0, 2).toUpperCase(),
      carriedBytes: 48 * 1024 * 1024,
      carriedFiles: 1240,
      leftBehindBytes: 910 * 1024 * 1024,
      totalBytes: 958 * 1024 * 1024,
      freeBytes: 120 * 1024 * 1024 * 1024,
      excluded: ['node_modules', '.next', 'dist', 'build', '.gradle', 'coverage', '.turbo', '.cache', 'out']
    };
  },
  async moveProject() {
    return { ok: false, message: 'Moving projects needs the desktop app' };
  },
  async startDriveScan() {
    return null;
  },
  async deleteFolders() {
    return null;
  },
  async recentFolders() {
    return recentRoots;
  },
  async initialRoot() {
    return null;
  },
  async revealInExplorer() {
    /* no-op in the browser preview */
  },
  async openPath() {
    return null;
  },

  async startScan(root) {
    return mockJobs.scan(root);
  },
  async startClean(targets, graceMs = 6000) {
    return mockJobs.clean(targets, graceMs);
  },
  async startAppScan() {
    return mockJobs.appScan();
  },
  async startAppClean(targets, graceMs = 6000) {
    return mockJobs.clean(targets, graceMs, 'appclean');
  },
  async recycleBin() {
    return mockRecycleBin();
  },
  async programs() {
    return mockPrograms();
  },
  async programSizes() {
    return {};
  },
  async uninstallProgram() {
    return { ok: false, message: 'Uninstalling needs the desktop app' };
  },
  async forceRemoveProgram() {
    return { ok: false, message: 'Uninstalling needs the desktop app' };
  },
  async deleteLeftovers() {
    return null;
  },
  async listJobs() {
    return mockJobs.list();
  },
  async cancelJob(id) {
    return mockJobs.cancel(id);
  },
  async pauseJob(id, paused) {
    return mockJobs.setPaused(id, paused);
  },
  async clearFinishedJobs() {
    return mockJobs.clearFinished();
  },
  async throttle(level) {
    if (level) mockThrottle = level;
    return {
      level: mockThrottle,
      levels: [
      { id: 'gentle', label: 'Gentle' },
      { id: 'balanced', label: 'Balanced' },
      { id: 'fast', label: 'Fast' }]

    };
  },

  onJobs: (handler) => mockJobs.on('jobs', handler as (payload: never) => void),
  onJobEvent: (handler) => mockJobs.on('event', handler as (payload: never) => void),
  onJobProgress: (handler) => mockJobs.on('progress', handler as (payload: never) => void),
  onJobFinished: (handler) => mockJobs.on('finished', handler as (payload: never) => void),

  async systemSnapshot() {
    return mockSnapshot();
  },
  async defenderInfo() {
    return mockDefender();
  },
  async killProcess() {
    return { ok: false, message: 'Process control needs the desktop app' };
  },
  async findLockers() {
    return [];
  },
  async setExclusions() {
    return { ok: false, message: 'Changing antivirus settings needs the desktop app' };
  },
  async setProcessExclusions() {
    return { ok: false, message: 'Changing antivirus settings needs the desktop app' };
  },
  async setRealtimeProtection() {
    return { ok: false, message: 'Changing antivirus settings needs the desktop app' };
  },
  async openWindowsSecurity() {
    /* the browser preview has no Windows Security app to open */
  },
  async setProcessPriority() {
    return { ok: false, message: 'Process control needs the desktop app' };
  },

  async systemReport() {
    return mockSystemReport();
  },
  async cpuInfo() {
    return mockCpu();
  },
  async cpuLive() {
    const base = mockCpu().live;
    const wobble = Math.round((Math.random() - 0.5) * 12);
    return {
      ...base,
      perfPercent: (base.perfPercent ?? 0) + wobble,
      utilityPercent: (base.utilityPercent ?? 0) + Math.round((Math.random() - 0.5) * 20),
      currentMHz: Math.round(3301 * ((base.perfPercent ?? 0) + wobble) / 100)
    };
  },
  async applyCpuTweaks() {
    return { ok: false, message: 'Changing power settings needs the desktop app' };
  },
  async restoreCpu() {
    return { ok: false, message: 'Changing power settings needs the desktop app' };
  },
  async setService() {
    return { ok: false, message: 'Changing services needs the desktop app' };
  },
  async startupList() {
    return mockStartup();
  },
  async setStartup() {
    return { ok: false, message: 'Changing startup programs needs the desktop app' };
  },

  async history() {
    return mockHistory;
  },
  async historyTotals() {
    const clean = mockHistory.filter((entry) => entry.type === 'clean');
    return {
      bytes: clean.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
      folders: clean.reduce((sum, entry) => sum + (entry.folders ?? 0), 0),
      cleanups: clean.length,
      entries: mockHistory.length
    };
  },
  async clearHistory() {
    mockHistory = [];
    return mockHistory;
  }
};

// The preview writes its own history so the History tab has something to show.
mockJobs.on('finished', ((event: {job: Job;}) => {
  const { job } = event;
  mockHistory = [
  {
    id: `h${job.id}`,
    at: new Date().toISOString(),
    type: job.type === 'appclean' ? 'clean' : job.type === 'appscan' || job.type === 'drivescan' ? 'scan' : job.type,
    scope: job.type === 'appclean' ? 'apps' : undefined,
    ...job.result,
    items: []
  },
  ...mockHistory];

}) as (payload: never) => void);

export function getDesktopApi(): DesktopApi {
  if (typeof window !== 'undefined' && window.reclaim) {
    return window.reclaim;
  }
  return mockApi;
}

export const desktop = getDesktopApi();
