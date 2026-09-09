import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JunkEntry, JunkGroup } from '../types/junk';
import { RECYCLE_BIN_ID, groupJunk, recycleBinEntry } from '../types/junk';
import { desktop, type JobEvent } from '../utils/desktopBridge';
import { useMachine } from './MachineContext';

export interface JunkFailure {
  targetId: string;
  path: string;
  bytes: number;
  message: string;
  locked: string[];
}

interface JunkContextValue {
  entries: JunkEntry[];
  groups: JunkGroup[];
  phase: 'idle' | 'scanning' | 'ready';
  scanJobId: string | null;
  cleanJobId: string | null;
  scanError: string | null;
  selected: Set<string>;
  selectedEntries: JunkEntry[];
  selectedBytes: number;
  /** Everything still on disk, measured, across every program. */
  totalBytes: number;
  freedThisSession: number;
  /** Executable names running right now, lower-cased, for the "close it first" hint. */
  runningNames: Set<string>;
  startScan: () => void;
  cancelScan: () => void;
  toggleEntry: (id: string) => void;
  toggleGroup: (app: string) => void;
  selectSafe: () => void;
  clearSelection: () => void;
  /** Queues the cleanup and hands back its job id, or null if nothing was accepted. */
  clean: (ids: string[]) => Promise<string | null>;
}

const JunkContext = createContext<JunkContextValue | null>(null);

/**
 * State behind the Apps tab: the leftovers every installed program keeps,
 * what the user has ticked, and the jobs measuring or emptying them.
 *
 * Mirrors CleanerContext: entries arrive on job events, first unmeasured and
 * then with sizes, and a cleanup marks rows removed as each folder empties.
 */
export function JunkProvider({ children }: {children: React.ReactNode;}) {
  const { jobs, snapshot } = useMachine();

  const [entries, setEntries] = useState<JunkEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [cleanJobId, setCleanJobId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [freedThisSession, setFreed] = useState(0);
  const [started, setStarted] = useState(false);

  const scanJob = useRef<string | null>(null);
  const cleanJob = useRef<string | null>(null);
  scanJob.current = scanJobId;
  cleanJob.current = cleanJobId;

  const scanStatus = useMemo(() => jobs.find((job) => job.id === scanJobId)?.status ?? null, [jobs, scanJobId]);

  // When a scan finishes, the safe entries are ticked so the next click can
  // be "Empty" — the user is still shown exactly what that means first.
  const preselected = useRef<string | null>(null);
  useEffect(() => {
    if (scanStatus !== 'done' || !scanJobId || preselected.current === scanJobId) return;
    preselected.current = scanJobId;
    setSelected(new Set(entries.filter((entry) => entry.safety === 'safe' && !entry.removed && !entry.pending && entry.bytes > 0).map((entry) => entry.id)));
  }, [scanStatus, scanJobId, entries]);
  const phase: JunkContextValue['phase'] = !started ? 'idle' : scanStatus === 'running' || scanStatus === 'queued' ? 'scanning' : 'ready';

  const buffered = useRef(new Map<string, JobEvent[]>());

  const applyEvent = useCallback(({ event, payload }: JobEvent) => {
    if (event === 'junk') {
      const batch = payload as JunkEntry[];
      if (batch.length === 0) return;
      setEntries((current) => {
        const byId = new Map(batch.map((entry) => [entry.id, entry]));
        const next = current.map((entry) => byId.get(entry.id) ?? entry);
        byId.forEach((entry, id) => {
          if (!current.some((existing) => existing.id === id)) next.push(entry);
        });
        return next;
      });
      return;
    }

    if (event === 'removed') {
      const { targetId, bytes } = payload as {targetId: string;bytes: number;};
      setFreed((current) => current + bytes);
      setEntries((current) =>
      current.map((entry) => entry.id === targetId ? { ...entry, removed: true, error: null, bytes: 0, files: 0 } : entry)
      );
      setSelected((current) => {
        const next = new Set(current);
        next.delete(targetId);
        return next;
      });
      return;
    }

    if (event === 'failed') {
      const failure = payload as JunkFailure;
      setFreed((current) => current + failure.bytes);
      // Emptying is partial by nature — the files still open stay. Show what
      // went and keep the row, so it can be tried again once the app closes.
      setEntries((current) =>
      current.map((entry) =>
      entry.id === failure.targetId ?
      { ...entry, error: failure.message, bytes: Math.max(0, entry.bytes - failure.bytes) } :
      entry
      )
      );
      setSelected((current) => {
        const next = new Set(current);
        next.delete(failure.targetId);
        return next;
      });
    }
  }, []);

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
      if (message.jobId === scanJob.current || message.jobId === cleanJob.current) {
        applyEvent(message);
        return;
      }
      // Only this tab's events are worth holding; project scans go elsewhere.
      if (message.event !== 'junk' && message.event !== 'removed' && message.event !== 'failed') return;
      const queued = buffered.current.get(message.jobId) ?? [];
      queued.push(message);
      buffered.current.set(message.jobId, queued);
      if (buffered.current.size > 4) {
        buffered.current.delete(buffered.current.keys().next().value as string);
      }
    });
  }, [applyEvent]);

  const startScan = useCallback(() => {
    const previous = scanJob.current;
    if (previous) void desktop.cancelJob(previous);

    setStarted(true);
    setEntries([]);
    setSelected(new Set());
    setScanError(null);

    // The recycle bin is not a folder; ask for it directly and list it first.
    desktop.
    recycleBin().
    then((info) => {
      if (info.items > 0) setEntries((current) => [recycleBinEntry(info), ...current.filter((entry) => entry.id !== RECYCLE_BIN_ID)]);
    }).
    catch(() => {
      /* no recycle bin reading is not worth an error */
    });

    desktop.
    startAppScan().
    then((jobId) => {
      scanJob.current = jobId;
      setScanJobId(jobId);
      drain(jobId);
    }).
    catch((error: unknown) => {
      setScanError(error instanceof Error ? error.message : String(error));
    });
  }, [drain]);

  const cancelScan = useCallback(() => {
    if (scanJob.current) void desktop.cancelJob(scanJob.current);
  }, []);

  const runningNames = useMemo(
    () => new Set((snapshot?.processes ?? []).map((process) => process.name.toLowerCase())),
    [snapshot]
  );

  const groups = useMemo(() => groupJunk(entries, runningNames), [entries, runningNames]);

  const toggleEntry = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);else
      next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (app: string) => {
      const ids = entries.filter((entry) => entry.app === app && !entry.removed && !entry.pending && entry.bytes > 0).map((entry) => entry.id);
      if (ids.length === 0) return;
      setSelected((current) => {
        const next = new Set(current);
        const all = ids.every((id) => next.has(id));
        ids.forEach((id) => all ? next.delete(id) : next.add(id));
        return next;
      });
    },
    [entries]
  );

  const selectSafe = useCallback(() => {
    setSelected(
      new Set(
        entries.
        filter((entry) => entry.safety === 'safe' && !entry.removed && !entry.pending && entry.bytes > 0).
        map((entry) => entry.id)
      )
    );
  }, [entries]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selected.has(entry.id) && !entry.removed),
    [entries, selected]
  );
  const selectedBytes = useMemo(() => selectedEntries.reduce((sum, entry) => sum + entry.bytes, 0), [selectedEntries]);
  const totalBytes = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.removed ? 0 : entry.bytes), 0),
    [entries]
  );

  const clean = useCallback(
    async (ids: string[]) => {
      const targets = entries.filter((entry) => ids.includes(entry.id) && !entry.removed);
      if (targets.length === 0) return null;
      const jobId = await desktop.startAppClean(
        targets.map((entry) => ({ id: entry.id, path: entry.path, bytes: entry.bytes, files: entry.files }))
      );
      if (!jobId) return null;
      cleanJob.current = jobId;
      setCleanJobId(jobId);
      drain(jobId);
      return jobId;
    },
    [entries, drain]
  );

  const value: JunkContextValue = {
    entries,
    groups,
    phase,
    scanJobId,
    cleanJobId,
    scanError,
    selected,
    selectedEntries,
    selectedBytes,
    totalBytes,
    freedThisSession,
    runningNames,
    startScan,
    cancelScan,
    toggleEntry,
    toggleGroup,
    selectSafe,
    clearSelection,
    clean
  };

  return <JunkContext.Provider value={value}>{children}</JunkContext.Provider>;
}

export function useJunk(): JunkContextValue {
  const context = useContext(JunkContext);
  if (!context) {
    throw new Error('useJunk must be used inside a JunkProvider');
  }
  return context;
}
