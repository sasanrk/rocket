/** Shapes behind the Apps tab: data programs leave behind that they can live without. */

export type JunkCategory = 'cache' | 'logs' | 'crash' | 'installer' | 'temp' | 'dev' | 'bin';

export const CATEGORY_LABELS: Record<JunkCategory, string> = {
  cache: 'Cache',
  logs: 'Logs',
  crash: 'Crash reports',
  installer: 'Installers',
  temp: 'Temp files',
  dev: 'Package cache',
  bin: 'Recycle Bin'
};

export interface JunkEntry {
  /** The lower-cased path, which is also what the main process checks against. */
  id: string;
  /** Groups rows under one program, e.g. `app:claude`, `browser:chrome`, `devtools`. */
  app: string;
  appLabel: string;
  category: JunkCategory;
  label: string;
  path: string;
  /** What actually happens once it is emptied. */
  note: string;
  /** `caution` marks a folder whose contents take real time to come back. */
  safety: 'safe' | 'caution';
  /** Lower-cased executable names (without .exe) that hold this data open. */
  processNames: string[];
  bytes: number;
  files: number;
  /** Listed by discovery but not measured yet. */
  pending: boolean;
  removed: boolean;
  /** Why the last attempt could not empty it, if it could not. */
  error?: string | null;
}

/** The recycle bin has no folder path; the main process handles it by id. */
export const RECYCLE_BIN_ID = 'special:recycle-bin';

export interface RecycleBinInfo {
  items: number;
  bytes: number;
}

export function recycleBinEntry(info: RecycleBinInfo): JunkEntry {
  return {
    id: RECYCLE_BIN_ID,
    app: 'windows',
    appLabel: 'Windows',
    category: 'bin',
    label: 'Recycle Bin',
    path: '',
    note: `${info.items} item${info.items === 1 ? '' : 's'} waiting to be emptied; gone for good once they are`,
    safety: 'safe',
    processNames: [],
    bytes: info.bytes,
    files: info.items,
    pending: false,
    removed: false
  };
}

export interface JunkGroup {
  app: string;
  label: string;
  entries: JunkEntry[];
  bytes: number;
  /** True when one of the owning programs is running right now. */
  running: boolean;
}

/** Groups entries by program, biggest first, with the running flag resolved. */
export function groupJunk(entries: JunkEntry[], runningNames: Set<string>): JunkGroup[] {
  const groups = new Map<string, JunkGroup>();
  entries.forEach((entry) => {
    const group = groups.get(entry.app) ?? { app: entry.app, label: entry.appLabel, entries: [], bytes: 0, running: false };
    group.entries.push(entry);
    if (!entry.removed) group.bytes += entry.bytes;
    if (entry.processNames.some((name) => runningNames.has(name))) group.running = true;
    groups.set(entry.app, group);
  });
  return [...groups.values()].
  map((group) => ({ ...group, entries: [...group.entries].sort((a, b) => b.bytes - a.bytes) })).
  sort((a, b) => b.bytes - a.bytes);
}
