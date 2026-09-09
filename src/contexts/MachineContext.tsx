import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DefenderInfo,
  HistoryEntry,
  HistoryTotals,
  Job,
  PriorityClass,
  SystemSnapshot,
  ThrottleLevel } from
'../types/system';
import { desktop } from '../utils/desktopBridge';

/** How often the Processes and Performance tabs take a fresh reading. */
const POLL_MS = 3000;

interface MachineContextValue {
  jobs: Job[];
  activeJobs: Job[];
  /** The deletion still inside its undo window, if there is one. */
  graceJob: Job | null;
  cancelJob: (id: string) => Promise<{ok: boolean;undone: boolean;}>;
  pauseJob: (id: string, paused: boolean) => Promise<void>;
  clearFinishedJobs: () => Promise<void>;

  throttle: string;
  throttleLevels: ThrottleLevel[];
  setThrottle: (level: string) => Promise<void>;

  snapshot: SystemSnapshot | null;
  snapshotError: string | null;
  /** Reference-counted: polling runs only while a tab that needs it is open. */
  watchMachine: () => () => void;
  refreshSnapshot: () => Promise<void>;

  defender: DefenderInfo | null;
  refreshDefender: () => Promise<void>;
  /** Accepts settings already read back by a change, avoiding a second probe. */
  setDefender: (next: DefenderInfo) => void;

  killProcess: (pid: number) => Promise<{ok: boolean;message?: string;}>;
  setProcessPriority: (pid: number, priority: PriorityClass) => Promise<{ok: boolean;message?: string;}>;

  history: HistoryEntry[];
  historyTotals: HistoryTotals | null;
  refreshHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;

  isNative: boolean;
}

const MachineContext = createContext<MachineContextValue | null>(null);

export function MachineProvider({ children }: {children: React.ReactNode;}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [throttle, setThrottleState] = useState('balanced');
  const [throttleLevels, setThrottleLevels] = useState<ThrottleLevel[]>([]);
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [defender, setDefender] = useState<DefenderInfo | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyTotals, setHistoryTotals] = useState<HistoryTotals | null>(null);

  const watchers = useRef(0);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    desktop.listJobs().then((list) => live && setJobs(list)).catch(() => {
      /* a first read before the app is ready is not worth reporting */
    });
    desktop.
    throttle().
    then((state) => {
      if (!live) return;
      setThrottleState(state.level);
      setThrottleLevels(state.levels);
    }).
    catch(() => {
      /* a first read before the app is ready is not worth reporting */
    });

    const off = desktop.onJobs((list) => setJobs(list));
    return () => {
      live = false;
      off();
    };
  }, []);

  const refreshHistory = useCallback(async () => {
    const [entries, totals] = await Promise.all([desktop.history(), desktop.historyTotals()]);
    setHistory(entries);
    setHistoryTotals(totals);
  }, []);

  useEffect(() => {
    refreshHistory().catch(() => {
      /* a first read before the app is ready is not worth reporting */
    });
    // A finished job is exactly when the history file gains an entry.
    const off = desktop.onJobFinished(() => {
      refreshHistory().catch(() => {
      /* a first read before the app is ready is not worth reporting */
    });
    });
    return off;
  }, [refreshHistory]);

  const refreshSnapshot = useCallback(async () => {
    // Snapshots take ~100ms but can queue behind a cold PowerShell start; one
    // at a time keeps the app from stacking them up.
    if (inFlight.current) return;
    // Hidden in the tray is exactly when the app should cost nothing.
    if (typeof document !== 'undefined' && document.hidden) return;
    inFlight.current = true;
    try {
      const next = await desktop.systemSnapshot();
      setSnapshot(next);
      setSnapshotError(null);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
    }
  }, []);

  const watchMachine = useCallback(() => {
    watchers.current += 1;
    if (watchers.current === 1) {
      void refreshSnapshot();
      timer.current = window.setInterval(() => void refreshSnapshot(), POLL_MS);
    }
    return () => {
      watchers.current -= 1;
      if (watchers.current === 0 && timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [refreshSnapshot]);

  useEffect(() => {
    // Coming back from the tray should show a current reading, not the one
    // from before it was hidden.
    const onVisible = () => {
      if (!document.hidden && watchers.current > 0) void refreshSnapshot();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [refreshSnapshot]);

  const refreshDefender = useCallback(async () => {
    try {
      setDefender(await desktop.defenderInfo());
    } catch {
      setDefender(null);
    }
  }, []);

  const setThrottle = useCallback(async (level: string) => {
    const state = await desktop.throttle(level);
    setThrottleState(state.level);
    setThrottleLevels(state.levels);
  }, []);

  const cancelJob = useCallback(async (id: string) => desktop.cancelJob(id), []);

  const pauseJob = useCallback(async (id: string, paused: boolean) => {
    await desktop.pauseJob(id, paused);
  }, []);

  const clearFinishedJobs = useCallback(async () => {
    setJobs(await desktop.clearFinishedJobs());
  }, []);

  const killProcess = useCallback(
    async (pid: number) => {
      const result = await desktop.killProcess(pid);
      if (result.ok) await refreshSnapshot();
      return result;
    },
    [refreshSnapshot]
  );

  const setProcessPriority = useCallback(
    async (pid: number, priority: PriorityClass) => {
      const result = await desktop.setProcessPriority(pid, priority);
      if (result.ok) await refreshSnapshot();
      return result;
    },
    [refreshSnapshot]
  );

  const clearHistory = useCallback(async () => {
    await desktop.clearHistory();
    await refreshHistory();
  }, [refreshHistory]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'running' || job.status === 'queued' || job.status === 'grace'),
    [jobs]
  );

  const graceJob = useMemo(() => jobs.find((job) => job.status === 'grace') ?? null, [jobs]);

  const value: MachineContextValue = useMemo(
    () => ({
    jobs,
    activeJobs,
    graceJob,
    cancelJob,
    pauseJob,
    clearFinishedJobs,
    throttle,
    throttleLevels,
    setThrottle,
    snapshot,
    snapshotError,
    watchMachine,
    refreshSnapshot,
    defender,
    refreshDefender,
    setDefender,
    killProcess,
    setProcessPriority,
    history,
    historyTotals,
    refreshHistory,
    clearHistory,
    isNative: desktop.isNative
    }),
    [
    jobs,
    activeJobs,
    graceJob,
    cancelJob,
    pauseJob,
    clearFinishedJobs,
    throttle,
    throttleLevels,
    setThrottle,
    snapshot,
    snapshotError,
    watchMachine,
    refreshSnapshot,
    defender,
    refreshDefender,
    setDefender,
    killProcess,
    setProcessPriority,
    history,
    historyTotals,
    refreshHistory,
    clearHistory]

  );

  return <MachineContext.Provider value={value}>{children}</MachineContext.Provider>;
}

export function useMachine(): MachineContextValue {
  const context = useContext(MachineContext);
  if (!context) {
    throw new Error('useMachine must be used inside a MachineProvider');
  }
  return context;
}

/** Turns live polling on for as long as the calling component is mounted. */
export function useMachineWatch() {
  const { watchMachine } = useMachine();
  useEffect(() => watchMachine(), [watchMachine]);
}
