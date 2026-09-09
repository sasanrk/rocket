import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TriangleAlertIcon, UndoDotIcon, XIcon } from 'lucide-react';
import { useJunk } from '../contexts/JunkContext';
import type { JunkEntry } from '../types/junk';
import { formatBytes, pluralize } from '../utils/format';

interface JunkDialogProps {
  ids: string[];
  onClose: () => void;
  onQueued: (jobId: string) => void;
  onRefused: () => void;
}

/**
 * Confirmation for emptying app folders. Like the project one, this closes
 * the moment the job is queued and the task dock takes over, undo window
 * included.
 */
export function JunkDialog({ ids, onClose, onQueued, onRefused }: JunkDialogProps) {
  const { entries, clean, runningNames } = useJunk();
  const [queueing, setQueueing] = useState(false);

  const [list] = useState<JunkEntry[]>(() =>
  entries.filter((entry) => ids.includes(entry.id) && !entry.removed).sort((a, b) => b.bytes - a.bytes)
  );

  const totalBytes = useMemo(() => list.reduce((sum, entry) => sum + entry.bytes, 0), [list]);
  const cautionCount = list.filter((entry) => entry.safety === 'caution').length;
  const runningApps = useMemo(() => {
    const names = new Set<string>();
    list.forEach((entry) => {
      if (entry.processNames.some((name) => runningNames.has(name))) names.add(entry.appLabel);
    });
    return [...names];
  }, [list, runningNames]);
  const appCount = new Set(list.map((entry) => entry.app)).size;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !queueing) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queueing, onClose]);

  async function handleConfirm() {
    setQueueing(true);
    const jobId = await clean(list.map((entry) => entry.id));
    if (jobId) onQueued(jobId);else
    onRefused();
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      onClick={onClose}>

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm cleanup"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-panel">

        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Empty {pluralize(list.length, 'folder')}?
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              Frees {formatBytes(totalBytes)} across {pluralize(appCount, 'program')}. The folders stay; only what is
              inside goes.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onClose}
            className="rounded-md p-1.5 text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

            <XIcon className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <ul className="max-h-[248px] overflow-y-auto scroll-slim px-6 py-3">
          {list.map((entry) =>
          <li key={entry.id} className="flex items-center justify-between gap-4 border-b border-line/60 py-2 last:border-b-0">
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-ink">
                  {entry.appLabel} · {entry.label}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-faint" title={entry.path}>
                  {entry.path || 'Recycle Bin'}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink">{formatBytes(entry.bytes)}</span>
            </li>
          )}
        </ul>

        <div className="border-t border-line px-6 py-4">
          {cautionCount > 0 &&
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-node/30 bg-node/5 px-3 py-2 text-[11px] leading-relaxed text-node">
              <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              {pluralize(cautionCount, 'folder')} in this batch takes real time to come back — package caches and IDE
              indexes are rebuilt by downloading or re-indexing everything.
            </p>
          }
          {runningApps.length > 0 &&
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[11px] leading-relaxed text-muted">
              <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2.2} />
              {runningApps.join(', ')} {runningApps.length === 1 ? 'is' : 'are'} running. Files they hold open stay behind;
              close them first for a complete sweep.
            </p>
          }
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-faint">
            <UndoDotIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
            <span>
              Nothing is touched straight away — the cleanup waits a few seconds in the task bar below, and you can
              call it off in that window.
            </span>
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

              Cancel
            </button>
            <motion.button
              type="button"
              autoFocus
              disabled={queueing}
              whileTap={{ scale: 0.985 }}
              transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
              onClick={handleConfirm}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-60">

              Empty {formatBytes(totalBytes)}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>);

}
