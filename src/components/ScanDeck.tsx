import { motion } from 'framer-motion';
import { RadarIcon } from 'lucide-react';
import { cn } from '../utils/cn';

interface ScanStripProps {
  /** What the page is doing, e.g. "Measuring app caches". */
  label: string;
  progress: {done: number;total: number;currentPath?: string;startedAt?: number;};
  unit?: string;
  /** Shown instead of a count when there is no total to count against. */
  note?: string;
}

/** How much of a count is left, said the way a person would. */
export function remainingPhrase(done: number, total: number, startedAt: number | undefined, unit = 'folder'): {text: string;ratio: number;} {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const left = Math.max(0, total - done);
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  const rate = elapsed > 1500 && done > 0 ? done / (elapsed / 1000) : 0;
  const etaSeconds = rate > 0 ? left / rate : null;
  const eta =
  etaSeconds === null ? null :
  etaSeconds < 8 ? 'a few seconds' :
  etaSeconds < 60 ? `about ${Math.max(10, Math.round(etaSeconds / 10) * 10)} seconds` :
  etaSeconds < 3600 ? `about ${Math.max(1, Math.round(etaSeconds / 60))} min` :
  'a while';

  if (total === 0) return { text: 'looking for things to count', ratio: 0 };
  if (left === 0) return { text: 'finishing up', ratio: 1 };
  const percent = Math.round(ratio * 100);
  if (left <= 3) return { text: `${left} ${unit}${left === 1 ? '' : 's'} to go — the last ones are usually the biggest`, ratio };
  return { text: `${percent}% · ${left} ${unit}s left${eta ? ` · ${eta}` : ''}`, ratio };
}

/**
 * One quiet line while a page counts: what it is doing, where it is, how
 * much is left, and a thin bar. It stays out of the way of the list below.
 */
export function ScanStrip({ label, progress, unit = 'folder', note }: ScanStripProps) {
  const remaining = remainingPhrase(progress.done, progress.total, progress.startedAt, unit);

  return (
    <section aria-label={label} className="shrink-0 border-b border-line bg-surface">
      <div className="flex items-center gap-3 px-5 py-2">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 2.6, ease: 'linear', repeat: Infinity }}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-accent">

          <RadarIcon className="h-4 w-4" strokeWidth={2} />
        </motion.span>
        <p className="min-w-0 flex-1 truncate text-[12px] text-muted">
          <span className="font-medium text-ink">{label}</span>
          {progress.currentPath && <span className="font-mono text-[11px] text-faint"> · {progress.currentPath}</span>}
        </p>
        <p className="shrink-0 text-[11.5px] tabular-nums text-faint">{note ?? remaining.text}</p>
      </div>
      <div className="relative h-[3px] w-full overflow-hidden bg-line">
        {progress.total > 0 ?
        <motion.div
          className="h-full bg-accent"
          animate={{ width: `${Math.max(2, remaining.ratio * 100)}%` }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }} /> :

        <motion.div
          className="absolute inset-y-0 w-1/4 bg-accent"
          animate={{ left: ['-25%', '100%'] }}
          transition={{ duration: 1.6, ease: 'linear', repeat: Infinity }} />
        }
      </div>
    </section>);

}

/**
 * A number that is still being counted: soft, slow-moving fog where it will
 * be. Pure CSS — one gradient, one keyframe — so a list of a few hundred of
 * them costs nothing.
 */
export function Fog({ className }: {className?: string;}) {
  return <span aria-hidden="true" className={cn('fog inline-block rounded-md', className)} />;
}
