import type { CleanTarget, Project } from '../types/project';
import { activeTargets } from '../types/project';

export type TargetGroup = 'dependencies' | 'build' | 'cache';

export const groupLabels: Record<TargetGroup, string> = {
  dependencies: 'Dependencies',
  build: 'Build output',
  cache: 'Caches & reports'
};

export const groupColors: Record<TargetGroup, string> = {
  dependencies: 'bg-accent',
  build: 'bg-node',
  cache: 'bg-faint'
};

const CACHE_HINTS = ['.gradle', '.turbo', '.cache', 'coverage', 'captures', '.cxx'];

export function classifyTarget(target: CleanTarget): TargetGroup {
  if (target.folder === 'node_modules') return 'dependencies';
  if (CACHE_HINTS.some((hint) => target.folder.includes(hint))) return 'cache';
  return 'build';
}

export function groupTotals(projects: Project[]): {group: TargetGroup;bytes: number;}[] {
  const totals: Record<TargetGroup, number> = { dependencies: 0, build: 0, cache: 0 };
  projects.forEach((project) => {
    activeTargets(project).forEach((target) => {
      totals[classifyTarget(target)] += target.bytes;
    });
  });
  return (Object.keys(totals) as TargetGroup[]).
  map((group) => ({ group, bytes: totals[group] })).
  filter((entry) => entry.bytes > 0);
}

export function targetPath(project: Project, target: CleanTarget): string {
  const separator = project.path.includes('\\') ? '\\' : '/';
  return `${project.path}${separator}${target.relativePath.replace(/[\\/]/g, separator)}`;
}