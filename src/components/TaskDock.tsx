import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2Icon,
  ChevronUpIcon,
  CircleSlashIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  TriangleAlertIcon,
  UndoDotIcon,
  XIcon } from
'lucide-react';
import { useMachine } from '../contexts/MachineContext';
import { useAllJobProgress } from '../hooks/useJobProgress';
import { CleanProgress } from './CleanProgress';
import type { Job, JobProgress } from '../types/system';
import { formatBytes, formatDuration, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

/** Ticks once a second, only while something is actually counting down. */
function useCountdown(target: number | null): number {
  const [remaining, setRemaining] = useState(() => (target ? Math.max(0, target - Date.now()) : 0));

  useEffect(() => {
    if (!target) {
      setRemaining(0);
      return;
    }
    setRemaining(Math.max(0, target - Date.now()));
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, target - Date.now()));
    }, 200);
    return () => window.clearInterval(timer);
  }, [target]);

  return remaining;
}

function statusIcon(job: Job) {
  switch (job.status) {
    case 'done':
      return <CheckCircle2Icon className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} />;
    case 'failed':
      return <TriangleAlertIcon className="h-3.5 w-3.5 text-danger" strokeWidth={2.2} />;
    case 'cancelled':
      return <CircleSlashIcon className="h-3.5 w-3.5 text-faint" strokeWidth={2.2} />;
    case 'queued':
      return <Loader2Icon className="h-3.5 w-3.5 text-faint" strokeWidth={2.2} />;
    default:
      return <Loader2Icon className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2.2} />;
  }
}

function summarise(job: Job, progress: JobProgress): string {
  const result = job.result;
  if (job.status === 'cancelled' && !job.startedAt) return 'Called off — nothing was deleted';
  if (!result) {
    if (progress.total > 0) return `${progress.done} of ${progress.total}`;
    return job.status;
  }
  if (job.type === 'scan') {
    return `${pluralize(result.projects ?? 0, 'project')} · ${formatBytes(result.reclaimable ?? 0)} reclaimable · ${formatDuration(result.durationMs ?? 0)}`;
  }
  if (job.type === 'appscan') {
    return `${pluralize(result.entries ?? 0, 'folder')} · ${formatBytes(result.reclaimable ?? 0)} reclaimable · ${formatDuration(result.durationMs ?? 0)}`;
  }
  if (job.type === 'drivescan') {
    return `${pluralize(result.folders ?? 0, 'folder')} · ${formatBytes(result.bytes ?? 0)} · ${formatDuration(result.durationMs ?? 0)}`;
  }
  if (job.type === 'move') {
    return `${formatBytes(result.moved ?? 0)} moved · ${formatBytes(result.freed ?? 0)} freed · ${formatDuration(result.durationMs ?? 0)}`;
  }
  const failures = result.failures ?? 0;
  const base = `${formatBytes(result.bytes ?? 0)} freed · ${pluralize(result.folders ?? 0, 'folder')}`;
  return failures > 0 ? `${base} · ${pluralize(failures, 'folder')} locked` : base;
}

/** The runway strip: a deletion that has not started and can still be undone. */
function GraceRow({ job }: {job: Job;}) {
  const { cancelJob } = useMachine();
  const remaining = useCountdown(job.graceEndsAt);
  const seconds = Math.ceil(remaining / 1000);
  const total = job.graceEndsAt ? job.graceEndsAt - job.createdAt : 1;
  const ratio = total > 0 ? remaining / total : 0;

  return (
    <div className="relative overflow-hidden border-b border-line bg-raised">
      <motion.div
        className="absolute inset-y-0 left-0 bg-accent/10"
        animate={{ width: `${ratio * 100}%` }}
        transition={{ duration: 0.2, ease: 'linear' }} />

      <div className="relative flex items-center gap-3 px-4 py-2.5">
        <UndoDotIcon className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.2} />
        <p className="min-w-0 flex-1 truncate text-[12px] text-ink">
          <span className="font-medium">{job.label}</span>
          <span className="text-muted"> in {seconds}s — {job.detail}</span>
        </p>
        <button
          type="button"
          onClick={() => void cancelJob(job.id)}
          className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent transition-colors duration-150 ease-swift hover:bg-accent/20">

          {job.undoLabel}
        </button>
      </div>
    </div>);

}

function JobRow({ job, progress }: {job: Job;progress: JobProgress;}) {
  const { cancelJob, pauseJob } = useMachine();
  const running = job.status === 'running';
  const finished = job.status === 'done' || job.status === 'failed' || job.status === 'cancelled';
  const ratio = progress.total > 0 ? progress.done / progress.total : 0;

  return (
    <div className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-b-0">
      <span className="shrink-0">{statusIcon(job)}</span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-[12px] font-medium text-ink">{job.label}</p>
          <p className="shrink-0 text-[11px] text-faint">{summarise(job, progress)}</p>
        </div>

        {running &&
        <>
            <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint" title={progress.currentPath}>
              {job.paused ? 'Paused' : progress.currentPath || 'Working…'}
            </p>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
              <motion.div
              className={cn('h-full rounded-full', job.paused ? 'bg-faint' : 'bg-accent')}
              animate={{ width: `${Math.min(100, ratio * 100)}%` }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }} />

            </div>
          </>
        }

        {job.error && <p className="mt-0.5 text-[11px] text-danger">{job.error}</p>}
      </div>

      {running &&
      <button
        type="button"
        aria-label={job.paused ? 'Resume' : 'Pause'}
        onClick={() => void pauseJob(job.id, !job.paused)}
        className="shrink-0 rounded-md p-1.5 text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

          {job.paused ?
        <PlayIcon className="h-3.5 w-3.5" strokeWidth={2} /> :

        <PauseIcon className="h-3.5 w-3.5" strokeWidth={2} />
        }
        </button>
      }

      {!finished &&
      <button
        type="button"
        aria-label="Stop"
        onClick={() => void cancelJob(job.id)}
        className="shrink-0 rounded-md p-1.5 text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-danger">

          <XIcon className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      }
    </div>);

}

/**
 * Always-present strip along the bottom of the window: the undo runway, plus
 * every job that is running or has just finished. Collapsed it is one line;
 * expanded it is the task list.
 */
export function TaskDock() {
  const { jobs, activeJobs, graceJob, clearFinishedJobs } = useMachine();
  const progressByJob = useAllJobProgress();
  const [expanded, setExpanded] = useState(false);

  const empty: JobProgress = { done: 0, total: 0, currentPath: '' };
  const finished = jobs.filter((job) => job.finishedAt);
  const running = activeJobs.filter((job) => job.status !== 'grace');
  const hasAnything = jobs.length > 0;
  // A deletion gets the full panel: it is the one thing here worth watching.
  const deleting = running.find((job) => job.type === 'clean' || job.type === 'appclean' || job.type === 'move') ?? null;

  // A new deletion on the runway is the one moment this must not be missed.
  useEffect(() => {
    if (graceJob) setExpanded(true);
  }, [graceJob]);

  if (!hasAnything) return null;

  const headline = running.length > 0 ?
  `${pluralize(running.length, 'task')} running` :
  finished.length > 0 ?
  summarise(finished[0], progressByJob[finished[0].id] ?? empty) :
  'No tasks running';

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <AnimatePresence initial={false}>
        {graceJob && <GraceRow key={graceJob.id} job={graceJob} />}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {deleting &&
        <motion.div
          key={deleting.id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          className="overflow-hidden">

            <CleanProgress job={deleting} progress={progressByJob[deleting.id] ?? empty} />
          </motion.div>
        }
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {expanded &&
        <motion.div
          key="list"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="overflow-hidden">

            <div className="max-h-[220px] overflow-y-auto scroll-slim">
              {jobs.map((job) =>
            <JobRow key={job.id} job={job} progress={progressByJob[job.id] ?? empty} />
            )}
            </div>
          </motion.div>
        }
      </AnimatePresence>

      <div className="flex h-9 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12px] text-muted transition-colors duration-150 ease-swift hover:text-ink">

          <motion.span animate={{ rotate: expanded ? 0 : 180 }} transition={{ duration: 0.2 }} className="flex">
            <ChevronUpIcon className="h-3.5 w-3.5" strokeWidth={2} />
          </motion.span>
          {running.length > 0 &&
          <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2.2} />
          }
          <span className="truncate">{headline}</span>
        </button>

        {finished.length > 0 && running.length === 0 &&
        <button
          type="button"
          onClick={() => void clearFinishedJobs()}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

            Clear
          </button>
        }
      </div>
    </div>);

}
