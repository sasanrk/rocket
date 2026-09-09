import { useMemo } from 'react';
import { useCleaner } from '../contexts/CleanerContext';
import { useJobProgress } from '../hooks/useJobProgress';
import { ScanStrip } from './ScanDeck';

/** One line while drives are being walked: where it is, how much is left. */
export function ScanProgressBand() {
  const { scanJobId, projects, roots } = useCleaner();
  const progress = useJobProgress(scanJobId);
  const startedAt = useMemo(() => Date.now(), []);
  const pending = projects.filter((project) => project.pending).length;
  const total = progress.total > 0 ? progress.total : projects.length;
  const done = progress.total > 0 ? progress.done : projects.length - pending;
  const walking = roots.filter((root) => root.status === 'running').map((root) => root.path);

  return (
    <ScanStrip
      label={`Scanning ${walking.join(', ') || 'for projects'}`}
      unit="project"
      progress={{ done, total, currentPath: progress.currentPath, startedAt }} />);

}
