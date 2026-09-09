export type ProjectKind = 'node' | 'android';

export type TargetSafety = 'safe' | 'caution';

export interface CleanTarget {
  /** Globally unique id, formatted as `${projectId}::${folder}` */
  id: string;
  /** Folder name shown to the user, e.g. `node_modules` */
  folder: string;
  /** Path relative to the project root */
  relativePath: string;
  bytes: number;
  files: number;
  safety: TargetSafety;
  /** What removing this costs the user, e.g. "Restored by `npm install`" */
  restoredBy: string;
  removed: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  kind: ProjectKind;
  /** Detected toolchain, e.g. "Next.js 14", "Gradle 8.5" */
  framework: string;
  /** Size of the whole project folder, including clean targets */
  totalBytes: number;
  lastModified: string;
  targets: CleanTarget[];
  /** Listed by discovery but not measured yet — sizes are still unknown. */
  pending?: boolean;
}

/** Placeholder shown between discovery and measurement. */
export function pendingProject(path: string): Project {
  const separator = path.includes('\\') ? '\\' : '/';
  return {
    id: `pending:${path.toLowerCase()}`,
    name: path.split(separator).filter(Boolean).pop() ?? path,
    path,
    kind: 'node',
    framework: 'Measuring…',
    totalBytes: 0,
    lastModified: new Date().toISOString(),
    targets: [],
    pending: true
  };
}

export type ScanPhase = 'idle' | 'scanning' | 'ready' | 'cleaning';

export type KindFilter = 'all' | ProjectKind;

export type SortKey = 'reclaimable' | 'total' | 'recent' | 'name';

export interface ScanProgressState {
  scanned: number;
  total: number;
  currentPath: string;
}

export function activeTargets(project: Project): CleanTarget[] {
  return project.targets.filter((target) => !target.removed);
}

export function reclaimableBytes(project: Project): number {
  return activeTargets(project).reduce((sum, target) => sum + target.bytes, 0);
}

export function freedBytes(project: Project): number {
  return project.targets.
  filter((target) => target.removed).
  reduce((sum, target) => sum + target.bytes, 0);
}