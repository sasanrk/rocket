import { motion } from 'framer-motion';
import { CheckCircle2Icon, SparklesIcon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import { AnimatedBytes } from './AnimatedBytes';
import { formatBytes, pluralize } from '../utils/format';
import { groupColors, groupLabels, groupTotals } from '../utils/targets';

export function ReclaimSummary() {
  const { totals, projects, freedThisSession } = useCleaner();
  const groups = groupTotals(projects);
  const nothingLeft = totals.reclaimable === 0 && projects.length > 0;

  return (
    <section
      aria-label="Reclaimable space summary"
      className="flex items-end justify-between gap-10 border-b border-line bg-surface px-6 py-6">
      
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-muted">Reclaimable right now</p>
        {nothingLeft ?
        <div className="mt-2 flex items-center gap-2.5">
            <CheckCircle2Icon className="h-7 w-7 text-accent" strokeWidth={1.8} />
            <p className="text-[28px] font-semibold leading-none tracking-tight text-ink">All clean</p>
          </div> :

        <AnimatedBytes
          bytes={totals.reclaimable}
          className="mt-1 block text-[56px] font-semibold leading-none tracking-[-0.03em] text-ink"
          unitClassName="ml-2 text-[22px] font-medium tracking-normal text-muted" />

        }
        <p className="mt-3 text-[13px] text-muted">
          {nothingLeft ?
          <>Nothing left to delete in this folder.</> :

          <>
              across {pluralize(totals.projectsWithSpace, 'project')} of{' '}
              {formatBytes(totals.scannedSize)} scanned
            </>
          }
          {freedThisSession > 0 &&
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="ml-3 inline-flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-[12px] font-medium text-accent">
            
              <SparklesIcon className="h-3.5 w-3.5" strokeWidth={2} />
              {formatBytes(freedThisSession)} freed this session
            </motion.span>
          }
        </p>
      </div>

      {groups.length > 0 &&
      <div className="w-[320px] shrink-0">
          <p className="text-[12px] font-medium text-muted">Where it is hiding</p>
          <div className="mt-3 flex h-2 w-full gap-1 overflow-hidden rounded-full">
            {groups.map(({ group, bytes }) =>
          <motion.span
            key={group}
            initial={{ width: 0 }}
            animate={{ width: `${bytes / totals.reclaimable * 100}%` }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className={`h-full rounded-full ${groupColors[group]}`} />

          )}
          </div>
          <ul className="mt-3 space-y-1.5">
            {groups.map(({ group, bytes }) =>
          <li key={group} className="flex items-center gap-2 text-[12px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${groupColors[group]}`} />
                <span className="flex-1 text-muted">{groupLabels[group]}</span>
                <span className="font-mono tabular-nums text-ink">{formatBytes(bytes)}</span>
              </li>
          )}
          </ul>
        </div>
      }
    </section>);

}