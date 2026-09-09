import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { LockIcon, Loader2Icon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useCleaner, type RemoveFailure } from '../contexts/CleanerContext';
import { useMachine } from '../contexts/MachineContext';
import type { LockerInfo } from '../types/system';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, pluralize } from '../utils/format';

interface BlockedDialogProps {
  failures: RemoveFailure[];
  onClose: () => void;
}

/**
 * Shown when a deletion could not finish because something had the files open.
 *
 * Windows names the culprits through the Restart Manager, so this can say
 * exactly which program to close instead of leaving the user guessing — and,
 * if they say so, close them and try again.
 */
export function BlockedDialog({ failures, onClose }: BlockedDialogProps) {
  const { killProcess } = useMachine();
  const { cleanTargets } = useCleaner();
  const [lockers, setLockers] = useState<LockerInfo[] | null>(null);
  const [working, setWorking] = useState(false);

  const paths = useMemo(() => failures.flatMap((failure) => failure.locked).slice(0, 24), [failures]);
  const partial = failures.reduce((sum, failure) => sum + failure.bytes, 0);

  useEffect(() => {
    let live = true;
    if (paths.length === 0) {
      setLockers([]);
      return;
    }
    desktop.
    findLockers(paths).
    then((found) => {
      if (live) setLockers(found);
    }).
    catch(() => {
      if (live) setLockers([]);
    });
    return () => {live = false;};
  }, [paths]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !working) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [working, onClose]);

  const closable = (lockers ?? []).filter((locker) => !locker.protected);

  async function handleCloseAndRetry() {
    setWorking(true);
    const results = await Promise.all(closable.map((locker) => killProcess(locker.pid)));
    const failed = results.filter((result) => !result.ok);

    if (failed.length > 0) {
      toast.error(`Could not close ${pluralize(failed.length, 'program')}`, { description: failed[0].message });
    }

    // Give Windows a moment to release the handles before trying again.
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    const jobId = await cleanTargets(failures.map((failure) => failure.targetId));
    setWorking(false);
    onClose();

    if (jobId) toast('Trying those folders again', { description: 'Watch the task bar for the result.' });
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      onClick={() => !working && onClose()}>

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Files in use"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-panel">

        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-node/30 bg-node/10 text-node">
              <LockIcon className="h-4 w-4" strokeWidth={2} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                {pluralize(failures.length, 'folder')} could not be deleted
              </h2>
              <p className="mt-1 text-[12px] text-muted">
                Something still had files open in them.
                {partial > 0 && ` ${formatBytes(partial)} did go before they stopped.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={working}
            onClick={onClose}
            className="rounded-md p-1.5 text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink disabled:opacity-40">

            <XIcon className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="px-6 py-4">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Folders</p>
          <ul className="mt-2 max-h-[104px] space-y-1 overflow-y-auto scroll-slim">
            {failures.map((failure) =>
            <li key={failure.targetId} className="truncate font-mono text-[11px] text-muted" title={failure.path}>
                {failure.path}
              </li>
            )}
          </ul>

          <p className="mt-4 text-[10.5px] font-medium uppercase tracking-wide text-faint">Holding them open</p>
          {lockers === null ?
          <p className="mt-2 flex items-center gap-2 text-[12.5px] text-faint">
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Asking Windows which programs have them…
            </p> :
          lockers.length === 0 ?
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              Windows could not name a program. It is often Explorer with the folder open, an antivirus scan still
              running over it, or a terminal sitting inside it. Close what you can and try again.
            </p> :

          <ul className="mt-2 space-y-1.5">
              {lockers.map((locker) =>
            <li
              key={locker.pid}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3 py-2">

                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {locker.title || locker.name}
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-faint">
                      {locker.name} · pid {locker.pid}
                    </span>
                  </span>
                  {locker.protected &&
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
                      <TriangleAlertIcon className="h-3 w-3" strokeWidth={2} />
                      protected
                    </span>
              }
                </li>
            )}
            </ul>
          }
        </div>

        <div className="border-t border-line px-6 py-4">
          {closable.length > 0 &&
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger">
              <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              Closing {pluralize(closable.length, 'program')} ends them immediately — anything unsaved in them is
              lost. Save your work first.
            </p>
          }
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={working}
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink disabled:opacity-40">

              Leave them
            </button>
            <button
              type="button"
              disabled={working || closable.length === 0}
              onClick={() => void handleCloseAndRetry()}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-40">

              {working && <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />}
              Close {closable.length > 0 ? pluralize(closable.length, 'program') : 'them'} and retry
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>);

}
