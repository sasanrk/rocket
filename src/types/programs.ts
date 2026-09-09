/** Shapes behind the Installed programs page. */

export interface InstalledProgram {
  /** `scope:arch:registryKey` for desktop programs, `store:packageFullName` for Store apps. */
  id: string;
  kind: 'desktop' | 'store';
  /** Machine-wide programs need an administrator prompt to uninstall. */
  scope: 'machine' | 'user';
  keyPath: string;
  keyName: string;
  name: string;
  publisher: string;
  version: string;
  /** ISO date, when the installer recorded one. */
  installDate: string | null;
  /** From the registry when the installer reported it, else measured from the install folder. */
  sizeBytes: number;
  sizeMeasured: boolean;
  installLocation: string;
  icon: string;
  /** False when the entry has no uninstall command at all; only force removal is left. */
  hasUninstaller: boolean;
  isMsi: boolean;
  /** Runtimes, redistributables, drivers: other software may depend on it. */
  dependency: boolean;
}

export interface Leftover {
  path: string;
  bytes: number;
  files: number;
  /** Why it was matched, e.g. "Roaming app data" or "Install folder the uninstaller left behind". */
  reason: string;
}

export interface UninstallResult {
  ok: boolean;
  /** True when the program is no longer listed after the uninstaller ran. */
  removed?: boolean;
  message?: string;
  /** The uninstaller is missing or broken; the entry can still be taken off the list. */
  canForce?: boolean;
  leftovers?: Leftover[];
}

export type ProgramFilter = 'all' | 'desktop' | 'store' | 'large' | 'recent' | 'broken';
export type ProgramSort = 'name' | 'size' | 'date' | 'publisher';

/** A program's initials for the tile that stands in for an icon. */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** A stable pastel for the tile, so the list is scannable by colour. */
export function tileHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return hash % 360;
}
