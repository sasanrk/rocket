import { useEffect, useState } from 'react';
import type { ViewId } from '../components/views';
import type { KindFilter, SortKey as ProjectSort } from '../types/project';
import type { ProcessGroup } from '../types/system';
import type { ProgramFilter, ProgramSort } from '../types/programs';

/**
 * The handful of choices the app remembers between runs: the theme, which page
 * you were on, and the filters you left each list in. Everything here is a
 * preference — nothing the machine reports and nothing that costs a scan.
 *
 * All of it lives under one key so a single read on boot brings the lot in.
 */
export const PREFS_KEY = 'rocket.prefs.v1';

export type Theme = 'dark' | 'light';
export type Density = 'comfortable' | 'compact';
export type ProcessSort = 'cpu' | 'memory' | 'name';

interface Field<T> {
  /** What the app uses until the user chooses otherwise. */
  fallback: T;
  /** Turns whatever was on disk into a value, or undefined if it is not one. */
  read: (raw: unknown) => T | undefined;
}

function field<T>(fallback: T, read: (raw: unknown) => T | undefined): Field<T> {
  return { fallback, read };
}

/** Accepts a stored string only if it is still one of the options we offer. */
function oneOf<T extends string>(...allowed: T[]): (raw: unknown) => T | undefined {
  return (raw) => (typeof raw === 'string' && (allowed as string[]).includes(raw) ? raw as T : undefined);
}

function text(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

const SCHEMA = {
  /** Dark or light, applied before the first paint by the boot script in index.html. */
  theme: field<Theme>('dark', oneOf<Theme>('dark', 'light')),
  /** Row height of the project table, for dense project folders. */
  density: field<Density>('comfortable', oneOf<Density>('comfortable', 'compact')),
  /** The page the sidebar reopens on. */
  view: field<ViewId>(
    'home',
    oneOf<ViewId>(
      'home', 'projects', 'apps', 'programs', 'drives', 'power',
      'startup', 'services', 'performance', 'processes', 'antivirus', 'history'
    )
  ),
  /** Last folder scanned for project junk, offered again on the next launch. */
  lastRoot: field<string | null>(null, text),
  /** Folders the user added to the project scan on top of the drives. */
  includedFolders: field<string[]>([], (raw) =>
  Array.isArray(raw) && raw.every((entry) => typeof entry === 'string') ? (raw as string[]) : undefined
  ),
  projectFilter: field<KindFilter>('all', oneOf<KindFilter>('all', 'node', 'android')),
  projectSort: field<ProjectSort>('reclaimable', oneOf<ProjectSort>('reclaimable', 'total', 'recent', 'name')),
  processGroup: field<ProcessGroup | 'all'>(
    'all',
    oneOf<ProcessGroup | 'all'>('all', 'node', 'build', 'editor', 'browser', 'security', 'system', 'other')
  ),
  processSort: field<ProcessSort>('cpu', oneOf<ProcessSort>('cpu', 'memory', 'name')),
  programFilter: field<ProgramFilter>(
    'all',
    oneOf<ProgramFilter>('all', 'desktop', 'store', 'large', 'recent', 'broken')
  ),
  programSort: field<ProgramSort>('size', oneOf<ProgramSort>('name', 'size', 'date', 'publisher'))
} satisfies Record<string, Field<unknown>>;

export type PrefKey = keyof typeof SCHEMA;
export type PrefValue<K extends PrefKey> = typeof SCHEMA[K] extends Field<infer T> ? T : never;
export type Prefs = {[K in PrefKey]: PrefValue<K>};

type StoredPrefs = Partial<Record<PrefKey, unknown>>;

/** Parsed once per run: every later read is a property lookup, not a parse. */
let cache: StoredPrefs | null = null;
/** Goes false the moment the browser refuses us storage, so we stop asking. */
let writable = true;

function load(): StoredPrefs {
  if (cache) return cache;
  cache = {};

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFS_KEY);
  } catch {
    // A private window or a locked-down profile: the app runs on defaults
    // rather than failing to start.
    writable = false;
    return cache;
  }

  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cache = parsed as StoredPrefs;
    }
  } catch {
    /* Something else wrote nonsense here; the next change overwrites it. */
  }
  return cache;
}

function save(): void {
  if (!writable || !cache) return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(cache));
  } catch {
    // Out of quota or storage pulled away mid-run. The session keeps its
    // choices in memory; they simply will not outlive it.
    writable = false;
  }
}

/**
 * What was actually stored, or undefined when this machine has never chosen —
 * for the callers that have a starting value of their own to fall back on.
 */
export function storedPref<K extends PrefKey>(key: K): PrefValue<K> | undefined {
  const spec = SCHEMA[key] as Field<PrefValue<K>>;
  return spec.read(load()[key]);
}

/** One preference, falling back to its default when unset or unreadable. */
export function readPref<K extends PrefKey>(key: K): PrefValue<K> {
  return storedPref(key) ?? (SCHEMA[key] as Field<PrefValue<K>>).fallback;
}

/** Every preference at once, for a first render that needs the whole set. */
export function readPrefs(): Prefs {
  const keys = Object.keys(SCHEMA) as PrefKey[];
  return Object.fromEntries(keys.map((key) => [key, readPref(key)])) as Prefs;
}

export function writePref<K extends PrefKey>(key: K, value: PrefValue<K>): void {
  const store = load();
  if (store[key] === value) return;
  store[key] = value;
  save();
}

/** Forgets every remembered choice; the next read hands back the defaults. */
export function resetPrefs(): void {
  cache = {};
  try {
    window.localStorage.removeItem(PREFS_KEY);
  } catch {
    writable = false;
  }
}

/**
 * `useState` for a remembered choice: same shape, except the starting value
 * comes from the last run and every change is written back.
 */
export function usePref<K extends PrefKey>(key: K) {
  const state = useState<PrefValue<K>>(() => readPref(key));
  const value = state[0];

  useEffect(() => {
    writePref(key, value);
  }, [key, value]);

  return state;
}
