import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PauseIcon, PlayIcon, XIcon } from 'lucide-react';
import { useMachine } from '../contexts/MachineContext';
import type { Job, JobProgress } from '../types/system';
import { formatBytes, formatCount, formatDuration } from '../utils/format';

/**
 * Smooths the throughput reading over a short window.
 *
 * Deleting a folder of tiny files then one of large ones makes the raw rate
 * jump about wildly; a rolling window keeps the number readable without making
 * it lie about the trend.
 */
function useThroughput(bytesDone: number, startedAt: number | undefined) {
  const samples = useRef<{at: number;bytes: number;}[]>([]);
  const [rate, setRate] = useState(0);

  useEffect(() => {
    const now = Date.now();
    samples.current.push({ at: now, bytes: bytesDone });
    // Six seconds of history is enough to smooth a spike, short enough to react.
    samples.current = samples.current.filter((sample) => now - sample.at <= 6000);

    const oldest = samples.current[0];
    const span = now - oldest.at;
    if (span > 900) {
      setRate(((bytesDone - oldest.bytes) / span) * 1000);
    } else if (startedAt && now - startedAt > 900) {
      setRate((bytesDone / (now - startedAt)) * 1000);
    }
  }, [bytesDone, startedAt]);

  return rate;
}

/**
 * The panel a deletion runs behind: how far through it is, how fast it is
 * going, and how long is left.
 */
export function CleanProgress({ job, progress }: {job: Job;progress: JobProgress;}) {
  const { cancelJob, pauseJob } = useMachine();

  const bytesTotal = progress.bytesTotal ?? 0;
  const bytesDone = Math.min(progress.bytesDone ?? 0, bytesTotal);
  const filesDone = progress.filesDone ?? 0;
  const filesTotal = progress.filesTotal ?? 0;

  const ratio = bytesTotal > 0 ? bytesDone / bytesTotal : progress.total > 0 ? progress.done / progress.total : 0;
  const percent = Math.min(100, Math.round(ratio * 100));

  const rate = useThroughput(bytesDone, progress.startedAt);
  const remaining = bytesTotal - bytesDone;
  const etaMs = rate > 0 && remaining > 0 ? (remaining / rate) * 1000 : null;

  return (
    <div className="border-b border-line bg-raised px-5 py-4">
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2">
            <span className="text-[34px] font-semibold leading-none tracking-tight tabular-nums text-ink">
              {percent}
            </span>
            <span className="text-[15px] font-medium text-muted">%</span>
            <span className="ml-2 truncate text-[12.5px] text-muted">
              {job.paused ? 'Paused' : job.type === 'move' ? `Moving ${formatBytes(bytesTotal)}` : `Freeing ${formatBytes(bytesTotal)}`}
            </span>
          </p>
          <p className="mt-1.5 truncate font-mono text-[11px] text-faint" title={progress.currentPath}>
            {progress.currentPath || 'Finishing up…'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-6">
          <div className="text-right">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{job.type === 'move' ? 'Copied' : 'Freed'}</p>
            <p className="mt-0.5 font-mono text-[13px] tabular-nums text-ink">
              {formatBytes(bytesDone)}
              <span className="text-faint"> / {formatBytes(bytesTotal)}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Rate</p>
            <p className="mt-0.5 font-mono text-[13px] tabular-nums text-ink">
              {rate > 0 ? `${formatBytes(rate)}/s` : '—'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Left</p>
            <p className="mt-0.5 font-mono text-[13px] tabular-nums text-ink">
              {job.paused ? 'paused' : etaMs === null ? '—' : formatDuration(etaMs)}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={job.paused ? 'Resume' : 'Pause'}
              onClick={() => void pauseJob(job.id, !job.paused)}
              className="rounded-md border border-line p-1.5 text-muted transition-colors duration-150 ease-swift hover:bg-surface hover:text-ink">

              {job.paused ?
              <PlayIcon className="h-3.5 w-3.5" strokeWidth={2} /> :

              <PauseIcon className="h-3.5 w-3.5" strokeWidth={2} />
              }
            </button>
            <button
              type="button"
              aria-label="Stop"
              onClick={() => void cancelJob(job.id)}
              className="rounded-md border border-line p-1.5 text-muted transition-colors duration-150 ease-swift hover:border-danger/40 hover:text-danger">

              <XIcon className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }} />

        {/* A light sweeping across the filled part, so a slow folder still
            looks like it is moving rather than stuck. */}
        {!job.paused &&
        <motion.div
          className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/25 to-transparent"
          animate={{ left: ['-10%', '110%'] }}
          transition={{ duration: 1.6, ease: 'linear', repeat: Infinity }}
          style={{ maxWidth: `${percent}%` }} />

        }
      </div>

      <p className="mt-2 text-[11px] text-faint">
        {formatCount(filesDone)} of {formatCount(filesTotal)} files ·{' '}
        {formatCount(progress.done)} of {formatCount(progress.total)} folders
      </p>
    </div>);

}
