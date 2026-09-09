import { motion } from 'framer-motion';
import { RadarIcon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import { useJobProgress } from '../hooks/useJobProgress';
import { formatBytes, pluralize } from '../utils/format';

export function ScanProgressBand() {
  const { scanJobId, projects, totals } = useCleaner();
  const progress = useJobProgress(scanJobId);
  const ratio = progress.total > 0 ? Math.min(progress.done / progress.total, 1) : 0;

  return (
    <section aria-label="Scan progress" className="border-b border-line bg-surface px-6 py-5">
      <div className="flex items-center gap-3">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, ease: 'linear', repeat: Infinity }}
          className="flex h-6 w-6 items-center justify-center text-accent">
          
          <RadarIcon className="h-5 w-5" strokeWidth={1.9} />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">Scanning for reclaimable folders…</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{progress.currentPath || '—'}</p>
        </div>
        <p className="shrink-0 text-right text-[12px] text-muted">
          {pluralize(projects.length, 'project')} found ·{' '}
          <span className="font-medium text-accent">{formatBytes(totals.reclaimable)}</span> so far
        </p>
      </div>

      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-raised">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={{ width: 0 }}
          animate={{ width: `${ratio * 100}%` }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }} />
        
      </div>
    </section>);

}