import { useMemo } from 'react';
import { useCleaner } from '../contexts/CleanerContext';
import { useJobProgress } from '../hooks/useJobProgress';
import { ScanDeck } from './ScanDeck';
import { factsFor, type Fact } from '../data/scanFacts';
import { reclaimableBytes } from '../types/project';
import { formatBytes, pluralize } from '../utils/format';

/** While drives are being walked: progress, and a deck of things worth knowing. */
export function ScanProgressBand() {
  const { scanJobId, projects, totals, roots } = useCleaner();
  const progress = useJobProgress(scanJobId);
  const facts = useMemo(() => factsFor('projects'), []);
  const startedAt = useMemo(() => Date.now(), []);

  const live = useMemo<Fact[]>(() => {
    const measured = projects.filter((project) => !project.pending);
    const biggest = [...measured].sort((a, b) => reclaimableBytes(b) - reclaimableBytes(a))[0];
    const list: Fact[] = [];
    if (biggest && reclaimableBytes(biggest) > 0) {
      list.push({ id: 'live-biggest', kicker: 'Biggest so far', title: biggest.name, body: `${formatBytes(reclaimableBytes(biggest))} of rebuildable folders inside ${biggest.path}. ${biggest.framework}.`, kind: 'live' });
    }
    if (projects.length > 0) {
      const scanning = roots.filter((root) => root.status === 'running').map((root) => root.path);
      list.push({ id: 'live-count', kicker: 'Found so far', title: `${pluralize(projects.length, 'project')} across ${pluralize(roots.length, 'place')}`, body: `${formatBytes(totals.reclaimable)} could come back already.${scanning.length > 0 ? ` Still walking ${scanning.join(', ')}.` : ''}`, kind: 'live' });
    }
    return list;
  }, [projects, roots, totals.reclaimable]);

  const pending = projects.filter((project) => project.pending).length;
  const total = progress.total > 0 ? progress.total : projects.length;
  const done = progress.total > 0 ? progress.done : projects.length - pending;

  return (
    <ScanDeck
      label={`Scanning ${roots.filter((root) => root.status === 'running').map((root) => root.path).join(', ') || 'for projects'}`}
      facts={facts}
      live={live}
      unit="project"
      progress={{ done, total, currentPath: progress.currentPath, startedAt }} />);

}
