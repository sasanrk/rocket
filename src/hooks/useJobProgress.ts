import { useEffect, useState } from 'react';
import type { JobProgress } from '../types/system';
import { desktop } from '../utils/desktopBridge';

const EMPTY: JobProgress = { done: 0, total: 0, currentPath: '' };

/**
 * Live progress for one job, held locally by whoever displays it.
 *
 * Progress ticks several times a second. Putting it in a context would re-render
 * every consumer of that context on every tick — which is what used to make the
 * window unusable during a scan — so each component that needs it subscribes
 * for itself and re-renders alone.
 */
export function useJobProgress(jobId: string | null): JobProgress {
  const [progress, setProgress] = useState<JobProgress>(EMPTY);

  useEffect(() => {
    if (!jobId) {
      setProgress(EMPTY);
      return;
    }
    setProgress(EMPTY);
    return desktop.onJobProgress((event) => {
      if (event.jobId !== jobId) return;
      setProgress(event.progress);
    });
  }, [jobId]);

  return progress;
}

/** The same, for every job at once — used by the task dock. */
export function useAllJobProgress(): Record<string, JobProgress> {
  const [byJob, setByJob] = useState<Record<string, JobProgress>>({});

  useEffect(
    () =>
    desktop.onJobProgress((event) => {
      setByJob((current) => ({ ...current, [event.jobId]: event.progress }));
    }),
    []
  );

  return byJob;
}
