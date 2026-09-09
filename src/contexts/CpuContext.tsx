import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CpuInfo, CpuLive, CpuResult, ServiceState, StartupEntry } from '../types/system';
import { desktop } from '../utils/desktopBridge';
import { pluralize } from '../utils/format';

/** How often the clock reading refreshes while a view that shows it is open. */
const LIVE_MS = 2500;

interface CpuContextValue {
  cpu: CpuInfo | null;
  live: CpuLive | null;
  error: string | null;
  /** The full reading: hardware, plan values, services, tweak states. Slow-ish. */
  refresh: () => Promise<void>;
  /** Reference-counted polling of the cheap clock reading. */
  watchLive: () => () => void;
  /** Which action is waiting on Windows right now, or null. */
  busy: string | null;
  applyTweaks: (ids: string[]) => Promise<CpuResult>;
  restore: () => Promise<CpuResult>;
  toggleService: (service: ServiceState, enabled: boolean) => Promise<CpuResult>;
  startup: StartupEntry[];
  startupBusy: string | null;
  refreshStartup: () => Promise<void>;
  toggleStartup: (entry: StartupEntry, enabled: boolean) => Promise<void>;
  /** Tweaks that could still be applied on this machine. */
  pendingTweakIds: string[];
  isNative: boolean;
}

const CpuContext = createContext<CpuContextValue | null>(null);

/**
 * Everything the speed-up views share: the processor reading, the power-plan
 * changes, startup programs and background services. Kept in one place so
 * the Overview page and the three views never disagree about the machine.
 */
export function CpuProvider({ children }: {children: React.ReactNode;}) {
  const [cpu, setCpu] = useState<CpuInfo | null>(null);
  const [live, setLive] = useState<CpuLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [startupBusy, setStartupBusy] = useState<string | null>(null);

  const watchers = useRef(0);
  const timer = useRef<number | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await desktop.cpuInfo();
      setCpu(next);
      setLive(next.live);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const refreshStartup = useCallback(async () => {
    try {
      setStartup(await desktop.startupList());
    } catch {
      setStartup([]);
    }
  }, []);

  // The first reading is taken once, lazily, by whichever view asks first.
  const ensureLoaded = useCallback(() => {
    if (loaded.current) return;
    loaded.current = true;
    void refresh();
    void refreshStartup();
  }, [refresh, refreshStartup]);

  const tick = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    desktop.
    cpuLive().
    then((next) => setLive(next)).
    catch(() => {
      /* a missed reading leaves the last one on screen */
    });
  }, []);

  const watchLive = useCallback(() => {
    ensureLoaded();
    watchers.current += 1;
    if (watchers.current === 1) {
      tick();
      timer.current = window.setInterval(tick, LIVE_MS);
    }
    return () => {
      watchers.current -= 1;
      if (watchers.current === 0 && timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [ensureLoaded, tick]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    []
  );

  function report(result: CpuResult, success: string, failure: string) {
    if (result.cpu) {
      setCpu(result.cpu);
      setLive(result.cpu.live);
    }
    if (result.ok) toast.success(success, { description: result.message });else
    toast.error(failure, { description: result.message });
  }

  const applyTweaks = useCallback(async (ids: string[]) => {
    setBusy('apply');
    const result = await desktop.applyCpuTweaks(ids);
    setBusy(null);
    report(result, `${pluralize(result.changed ?? 0, 'change')} applied`, 'Could not change the power settings');
    return result;
  }, []);

  const restore = useCallback(async () => {
    setBusy('restore');
    const result = await desktop.restoreCpu();
    setBusy(null);
    report(result, 'Original settings restored', 'Could not restore the settings');
    return result;
  }, []);

  const toggleService = useCallback(async (service: ServiceState, enabled: boolean) => {
    setBusy(`service:${service.name}`);
    const result = await desktop.setService(service.name, enabled);
    setBusy(null);
    report(result, enabled ? `${service.label} is back on` : `${service.label} is off`, `Could not change ${service.label}`);
    return result;
  }, []);

  const toggleStartup = useCallback(
    async (entry: StartupEntry, enabled: boolean) => {
      setStartupBusy(entry.id);
      const result = await desktop.setStartup({ source: entry.source, name: entry.name, enabled });
      setStartupBusy(null);
      if (result.ok) {
        setStartup((current) =>
        current.map((row) => row.id === entry.id ? { ...row, enabled: result.enabled ?? enabled } : row)
        );
        toast.success(enabled ? `${entry.name} will start with Windows again` : `${entry.name} will no longer start with Windows`);
      } else {
        toast.error(`Could not change ${entry.name}`, { description: result.message });
      }
      void refreshStartup();
    },
    [refreshStartup]
  );

  const pendingTweakIds = useMemo(
    () => (cpu ? cpu.tweaks.filter((tweak) => tweak.available && tweak.active !== true).map((tweak) => tweak.id) : []),
    [cpu]
  );

  const value: CpuContextValue = useMemo(
    () => ({
      cpu,
      live,
      error,
      refresh,
      watchLive,
      busy,
      applyTweaks,
      restore,
      toggleService,
      startup,
      startupBusy,
      refreshStartup,
      toggleStartup,
      pendingTweakIds,
      isNative: desktop.isNative
    }),
    [cpu, live, error, refresh, watchLive, busy, applyTweaks, restore, toggleService, startup, startupBusy, refreshStartup, toggleStartup, pendingTweakIds]
  );

  return <CpuContext.Provider value={value}>{children}</CpuContext.Provider>;
}

export function useCpu(): CpuContextValue {
  const context = useContext(CpuContext);
  if (!context) {
    throw new Error('useCpu must be used inside a CpuProvider');
  }
  return context;
}

/** Keeps the clock reading live for as long as the calling view is mounted. */
export function useCpuWatch() {
  const { watchLive } = useCpu();
  useEffect(() => watchLive(), [watchLive]);
}
