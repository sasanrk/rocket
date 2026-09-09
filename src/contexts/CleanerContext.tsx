import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CleanTarget, KindFilter, Project, ScanPhase, SortKey } from '../types/project';
import { activeTargets, pendingProject, reclaimableBytes } from '../types/project';
import type { DriveInfo } from '../types/drives';
import { desktop, type JobEvent } from '../utils/desktopBridge';
import { targetPath } from '../utils/targets';
import { useMachine } from './MachineContext';
import { readPref, usePref, writePref } from '../utils/prefs';

export interface RemoveFailure {
  targetId: string;
  path: string;
  /** Bytes that did go, when a folder was only partly deleted. */
  bytes: number;
  message: string;
  /** The exact paths that would not go, for asking Windows who holds them. */
  locked: string[];
}

/** One place the scanner looks: a whole drive, or a folder the user added. */
export interface ScanRoot {
  path: string;
  kind: 'drive' | 'folder';
  jobId: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
}

interface CleanerContextValue {
  phase: ScanPhase;
  /** Every drive and included folder being scanned, in the order they were added. */
  roots: ScanRoot[];
  /** Kept for the pages that only care whether anything has been scanned yet. */
  root: string | null;
  drives: DriveInfo[];
  projects: Project[];
  visibleProjects: Project[];
  /** Id of the most recent scan job; progress is subscribed to, not re-rendered here. */
  scanJobId: string | null;
  /** Folders the last cleanup could not delete, with the reason why. */
  cleanFailures: RemoveFailure[];
  selected: Set<string>;
  selectedTargets: {project: Project;target: CleanTarget;}[];
  selectedBytes: number;
  focusedProject: Project | null;
  filter: KindFilter;
  /** `all`, or one root's path to show only its projects. */
  rootFilter: string;
  sort: SortKey;
  query: string;
  freedThisSession: number;
  isNative: boolean;
  totals: {
    reclaimable: number;
    scannedSize: number;
    projectsWithSpace: number;
    node: number;
    android: number;
  };
  /** Scans every fixed drive plus the included folders. Runs itself the first time the page opens. */
  scanEverything: () => void;
  /** Adds one folder to the set and scans it now; remembered for next time. */
  includeFolder: (folder: string) => void;
  removeIncluded: (folder: string) => void;
  /** Opens the folder picker and includes the choice. */
  pickFolder: () => void;
  startScan: (root: string) => void;
  cancelScan: () => void;
  rescan: () => void;
  setFilter: (filter: KindFilter) => void;
  setRootFilter: (root: string) => void;
  setSort: (sort: SortKey) => void;
  setQuery: (query: string) => void;
  focusProject: (id: string | null) => void;
  toggleTarget: (id: string) => void;
  toggleProject: (id: string) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  /** Queues the deletion and hands back the job id running it. */
  cleanTargets: (ids: string[]) => Promise<string | null>;
  /** Queues a move; the project row follows the folder to its new home. */
  moveProject: (source: string, destinationParent: string) => Promise<{ok: boolean;jobId?: string;message?: string;}>;
  /** Id of the running cleanup, for the progress panel and the blocked dialog. */
  cleanJobId: string | null;
  dismissFailures: () => void;
  scanError: string | null;
}

const CleanerContext = createContext<CleanerContextValue | null>(null);

function driveRoot(target: string): string {
  const match = target.match(/^[A-Za-z]:/);
  return match ? `${match[0].toUpperCase()}\\` : '';
}

function isDriveRoot(target: string): boolean {
  return /^[A-Za-z]:\\?$/.test(target);
}

export function CleanerProvider({ children }: {children: React.ReactNode;}) {
  const { jobs } = useMachine();

  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [included, setIncluded] = useState<string[]>(() => readPref('includedFolders'));
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The list settings you left the Projects page in, kept between runs.
  const [filter, setFilter] = usePref('projectFilter');
  const [sort, setSort] = usePref('projectSort');
  const [rootFilter, setRootFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [freedThisSession, setFreedThisSession] = useState(0);
  const [cleanFailures, setCleanFailures] = useState<RemoveFailure[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cleanJobId, setCleanJobId] = useState<string | null>(null);
  const [moveJobIds, setMoveJobIds] = useState<Set<string>>(new Set());

  // Read inside subscriptions, which are registered once and must not re-bind
  // every time a job id changes.
  const scanJobs = useRef(new Set<string>());
  const cleanJob = useRef<string | null>(null);
  const moveJobs = useRef(new Set<string>());
  cleanJob.current = cleanJobId;
  moveJobs.current = moveJobIds;

  useEffect(() => {
    writePref('includedFolders', included);
  }, [included]);

  // Job status comes from the shared job list, so a scan that ends in the
  // main process is reflected here without a second channel.
  const liveRoots = useMemo<ScanRoot[]>(
    () =>
    roots.map((entry) => {
      const job = entry.jobId ? jobs.find((candidate) => candidate.id === entry.jobId) : null;
      const status: ScanRoot['status'] =
      !job ? entry.status : job.status === 'running' || job.status === 'queued' || job.status === 'grace' ? 'running' : job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : 'cancelled';
      return { ...entry, status };
    }),
    [roots, jobs]
  );

  const scanning = liveRoots.some((entry) => entry.status === 'queued' || entry.status === 'running');
  const phase: ScanPhase = roots.length === 0 ? 'idle' : scanning ? 'scanning' : 'ready';
  const scanJobId = useMemo(() => {
    const running = liveRoots.find((entry) => entry.status === 'running' && entry.jobId);
    return running?.jobId ?? liveRoots[liveRoots.length - 1]?.jobId ?? null;
  }, [liveRoots]);

  // Work starts in the main process before the renderer is told which id it
  // was given, so an event can beat its own job id back. Anything that arrives
  // early waits here until the id lands.
  const buffered = useRef(new Map<string, JobEvent[]>());

  const applyEvent = useCallback(({ event, payload }: JobEvent) => {
    if (event === 'discovered') {
      // Several roots scan at once; each one's list is merged, never replaces.
      const dirs = payload as string[];
      setProjects((current) => {
        const known = new Set(current.map((project) => project.path.toLowerCase()));
        const fresh = dirs.filter((dir) => !known.has(dir.toLowerCase())).map(pendingProject);
        return fresh.length > 0 ? [...current, ...fresh] : current;
      });
      return;
    }

    if (event === 'projects') {
      const batch = payload as Project[];
      if (batch.length === 0) return;
      setProjects((current) => {
        const byPath = new Map(batch.map((project) => [project.path.toLowerCase(), project]));
        const next = current.map((project) => byPath.get(project.path.toLowerCase()) ?? project);
        byPath.forEach((project, key) => {
          if (!current.some((existing) => existing.path.toLowerCase() === key)) next.push(project);
        });
        return next;
      });
      return;
    }

    if (event === 'dropped') {
      const dir = (payload as string).toLowerCase();
      setProjects((current) => current.filter((project) => !(project.pending && project.path.toLowerCase() === dir)));
      return;
    }

    if (event === 'moved') {
      const { source, destination } = payload as {source: string;destination: string;};
      // The project keeps its id; only its home changes, and its build
      // output is gone with the original.
      setProjects((current) =>
      current.map((project) =>
      project.path.toLowerCase() === source.toLowerCase() ?
      {
        ...project,
        path: destination,
        totalBytes: Math.max(0, project.totalBytes - reclaimableBytes(project)),
        targets: project.targets.map((target) => ({ ...target, removed: true }))
      } :
      project
      )
      );
      setSelected((current) => {
        const next = new Set(current);
        current.forEach((id) => {
          if (id.startsWith(`${source.toLowerCase()}`)) next.delete(id);
        });
        return next;
      });
      return;
    }

    if (event === 'removed') {
      const { targetId, bytes } = payload as {targetId: string;bytes: number;};
      setFreedThisSession((current) => current + bytes);
      setProjects((current) =>
      current.map((project) => ({
        ...project,
        targets: project.targets.map((target) => target.id === targetId ? { ...target, removed: true } : target)
      }))
      );
      setSelected((current) => {
        const next = new Set(current);
        next.delete(targetId);
        return next;
      });
      return;
    }

    if (event === 'failed') {
      const raw = payload as RemoveFailure;
      const failure: RemoveFailure = { ...raw, locked: raw.locked ?? [] };
      // A partial delete still freed something; keep that in the running total.
      setFreedThisSession((current) => current + failure.bytes);
      setCleanFailures((current) => [...current, failure]);
    }
  }, []);

  /** Replays whatever arrived for a job before its id was known. */
  const drain = useCallback(
    (jobId: string) => {
      const queued = buffered.current.get(jobId);
      if (!queued) return;
      buffered.current.delete(jobId);
      queued.forEach(applyEvent);
    },
    [applyEvent]
  );

  useEffect(() => {
    return desktop.onJobEvent((message) => {
      if (scanJobs.current.has(message.jobId) || message.jobId === cleanJob.current || moveJobs.current.has(message.jobId)) {
        applyEvent(message);
        return;
      }
      // Only this page's events are worth holding; app-cache scans go elsewhere.
      if (!['discovered', 'dropped', 'projects', 'removed', 'failed', 'moved'].includes(message.event)) return;
      const queued = buffered.current.get(message.jobId) ?? [];
      queued.push(message);
      buffered.current.set(message.jobId, queued);
      if (buffered.current.size > 6) {
        buffered.current.delete(buffered.current.keys().next().value as string);
      }
    });
  }, [applyEvent]);

  const launch = useCallback(
    (target: string, kind: ScanRoot['kind']) => {
      const key = target.toLowerCase();
      setRoots((current) => {
        const existing = current.find((entry) => entry.path.toLowerCase() === key);
        if (existing?.jobId) void desktop.cancelJob(existing.jobId);
        const entry: ScanRoot = { path: target, kind, jobId: null, status: 'queued' };
        return existing ? current.map((item) => item.path.toLowerCase() === key ? entry : item) : [...current, entry];
      });
      // Projects under this root are re-measured; drop the old rows first.
      setProjects((current) => current.filter((project) => !project.path.toLowerCase().startsWith(key.replace(/\\$/, '') + '\\') || kind === 'folder' && !project.path.toLowerCase().startsWith(key)));
      setScanError(null);

      desktop.
      startScan(target, kind === 'drive' ? 6 : 5).
      then((jobId) => {
        scanJobs.current.add(jobId);
        setRoots((current) => current.map((entry) => entry.path.toLowerCase() === key ? { ...entry, jobId, status: 'running' } : entry));
        drain(jobId);
      }).
      catch((error: unknown) => {
        setScanError(error instanceof Error ? error.message : String(error));
        setRoots((current) => current.map((entry) => entry.path.toLowerCase() === key ? { ...entry, status: 'failed' } : entry));
      });
    },
    [drain]
  );

  const scanEverything = useCallback(() => {
    setSelected(new Set());
    setFocusedId(null);
    desktop.
    drives().
    then((list) => {
      setDrives(list);
      list.forEach((drive) => launch(drive.root, 'drive'));
      included.forEach((folder) => launch(folder, 'folder'));
    }).
    catch((error: unknown) => {
      setScanError(error instanceof Error ? error.message : String(error));
    });
  }, [launch, included]);

  const startScan = useCallback(
    (target: string) => {
      launch(target, isDriveRoot(target) ? 'drive' : 'folder');
    },
    [launch]
  );

  const includeFolder = useCallback(
    (folder: string) => {
      const clean = folder.replace(/[\\/]+$/, '');
      if (!clean) return;
      setIncluded((current) => current.some((entry) => entry.toLowerCase() === clean.toLowerCase()) ? current : [...current, clean]);
      launch(clean, 'folder');
    },
    [launch]
  );

  const removeIncluded = useCallback((folder: string) => {
    const key = folder.toLowerCase();
    setIncluded((current) => current.filter((entry) => entry.toLowerCase() !== key));
    setRoots((current) => {
      const entry = current.find((item) => item.path.toLowerCase() === key);
      if (entry?.jobId) void desktop.cancelJob(entry.jobId);
      return current.filter((item) => item.path.toLowerCase() !== key);
    });
    setProjects((current) => current.filter((project) => !project.path.toLowerCase().startsWith(`${key}\\`)));
    setRootFilter((current) => current.toLowerCase() === key ? 'all' : current);
  }, []);

  // A folder passed on the command line is included and scanned on first paint.
  useEffect(() => {
    let live = true;
    desktop.
    initialRoot().
    then((folder) => {
      if (live && folder) includeFolder(folder);
    }).
    catch(() => {
      /* no launch folder is the normal case */
    });
    return () => {live = false;};
    // Runs once; includeFolder is stable after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFolder = useCallback(() => {
    desktop.chooseFolder({ title: 'Include a folder in the project scan', buttonLabel: 'Include this folder' }).then((picked) => {
      if (picked) includeFolder(picked);
    });
  }, [includeFolder]);

  const cancelScan = useCallback(() => {
    roots.forEach((entry) => {
      if (entry.jobId) void desktop.cancelJob(entry.jobId);
    });
  }, [roots]);

  const rescan = useCallback(() => {
    if (roots.length === 0) scanEverything();else
    roots.forEach((entry) => launch(entry.path, entry.kind));
  }, [roots, launch, scanEverything]);

  const toggleTarget = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);else
      next.add(id);
      return next;
    });
  }, []);

  const toggleProject = useCallback(
    (id: string) => {
      const project = projects.find((item) => item.id === id);
      if (!project) return;
      const ids = activeTargets(project).map((target) => target.id);
      if (ids.length === 0) return;
      setSelected((current) => {
        const next = new Set(current);
        const allSelected = ids.every((targetId) => next.has(targetId));
        ids.forEach((targetId) => allSelected ? next.delete(targetId) : next.add(targetId));
        return next;
      });
    },
    [projects]
  );

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rootKey = rootFilter === 'all' ? null : rootFilter.toLowerCase().replace(/\\$/, '');
    const filtered = projects.filter((project) => {
      if (filter !== 'all' && project.kind !== filter) return false;
      if (rootKey) {
        const lower = project.path.toLowerCase();
        if (isDriveRoot(rootFilter) ? driveRoot(project.path).toLowerCase() !== `${rootKey}\\` : !lower.startsWith(`${rootKey}\\`)) return false;
      }
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        project.framework.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle));

    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (Boolean(a.pending) !== Boolean(b.pending)) return a.pending ? 1 : -1;
      if (a.pending && b.pending) return a.name.localeCompare(b.name);
      switch (sort) {
        case 'total':
          return b.totalBytes - a.totalBytes;
        case 'recent':
          return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
        case 'name':
          return a.name.localeCompare(b.name);
        case 'reclaimable':
        default:
          return reclaimableBytes(b) - reclaimableBytes(a);
      }
    });
    return sorted;
  }, [projects, filter, rootFilter, query, sort]);

  const selectAllVisible = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current);
      visibleProjects.forEach((project) => {
        activeTargets(project).forEach((target) => {
          if (target.safety === 'safe') next.add(target.id);
        });
      });
      return next;
    });
  }, [visibleProjects]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectedTargets = useMemo(() => {
    const entries: {project: Project;target: CleanTarget;}[] = [];
    projects.forEach((project) => {
      activeTargets(project).forEach((target) => {
        if (selected.has(target.id)) entries.push({ project, target });
      });
    });
    return entries;
  }, [projects, selected]);

  const selectedBytes = useMemo(() => selectedTargets.reduce((sum, entry) => sum + entry.target.bytes, 0), [selectedTargets]);

  const dismissFailures = useCallback(() => setCleanFailures([]), []);

  const cleanTargets = useCallback(
    async (ids: string[]) => {
      const entries: {project: Project;target: CleanTarget;}[] = [];
      projects.forEach((project) => {
        activeTargets(project).forEach((target) => {
          if (ids.includes(target.id)) entries.push({ project, target });
        });
      });
      if (entries.length === 0) return null;

      setCleanFailures([]);
      const jobId = await desktop.startClean(
        entries.map((entry) => ({
          id: entry.target.id,
          path: targetPath(entry.project, entry.target),
          bytes: entry.target.bytes,
          files: entry.target.files
        }))
      );
      cleanJob.current = jobId;
      setCleanJobId(jobId);
      drain(jobId);
      return jobId;
    },
    [projects, drain]
  );

  const moveProject = useCallback(
    async (source: string, destinationParent: string) => {
      const result = await desktop.moveProject(source, destinationParent);
      if (result.ok && result.jobId) {
        const jobId = result.jobId;
        moveJobs.current.add(jobId);
        setMoveJobIds((current) => new Set([...current, jobId]));
        drain(jobId);
      }
      return result;
    },
    [drain]
  );

  const totals = useMemo(() => {
    let reclaimable = 0;
    let scannedSize = 0;
    let projectsWithSpace = 0;
    let node = 0;
    let android = 0;
    projects.forEach((project) => {
      const free = reclaimableBytes(project);
      reclaimable += free;
      scannedSize += project.totalBytes;
      if (free > 0) projectsWithSpace += 1;
      if (project.kind === 'node') node += free;else
      android += free;
    });
    return { reclaimable, scannedSize, projectsWithSpace, node, android };
  }, [projects]);

  const focusedProject = useMemo(() => projects.find((project) => project.id === focusedId) ?? null, [projects, focusedId]);

  const value: CleanerContextValue = {
    phase,
    roots: liveRoots,
    root: roots.length > 0 ? roots[0].path : null,
    drives,
    projects,
    visibleProjects,
    scanJobId,
    cleanFailures,
    selected,
    selectedTargets,
    selectedBytes,
    focusedProject,
    filter,
    rootFilter,
    sort,
    query,
    freedThisSession,
    isNative: desktop.isNative,
    totals,
    scanEverything,
    includeFolder,
    removeIncluded,
    pickFolder,
    startScan,
    cancelScan,
    rescan,
    setFilter,
    setRootFilter,
    setSort,
    setQuery,
    focusProject: setFocusedId,
    toggleTarget,
    toggleProject,
    selectAllVisible,
    clearSelection,
    cleanTargets,
    moveProject,
    cleanJobId,
    dismissFailures,
    scanError
  };

  return <CleanerContext.Provider value={value}>{children}</CleanerContext.Provider>;
}

export function useCleaner(): CleanerContextValue {
  const context = useContext(CleanerContext);
  if (!context) {
    throw new Error('useCleaner must be used inside a CleanerProvider');
  }
  return context;
}
