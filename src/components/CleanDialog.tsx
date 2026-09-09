import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TriangleAlertIcon, UndoDotIcon, XIcon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import { activeTargets } from '../types/project';
import type { CleanTarget, Project } from '../types/project';
import { formatBytes, pluralize } from '../utils/format';
import { targetPath } from '../utils/targets';

interface CleanDialogProps {
  targetIds: string[];
  onClose: () => void;
  /** Called once the deletion has been handed to the task dock. */
  onQueued: (jobId: string) => void;
}

/**
 * Confirmation only. The deletion itself runs as a background job, so this
 * closes the moment it is queued and the task dock takes over — including the
 * few seconds in which the whole thing can still be called off.
 */
export function CleanDialog({ targetIds, onClose, onQueued }: CleanDialogProps) {
  const { projects, cleanTargets } = useCleaner();
  const [queueing, setQueueing] = useState(false);

  // Snapshot the selection before anything is removed from state.
  const [entries] = useState<{project: Project;target: CleanTarget;}[]>(() => {
    const list: {project: Project;target: CleanTarget;}[] = [];
    projects.forEach((project) => {
      activeTargets(project).forEach((target) => {
        if (targetIds.includes(target.id)) list.push({ project, target });
      });
    });
    return list.sort((a, b) => b.target.bytes - a.target.bytes);
  });

  const totalBytes = useMemo(() => entries.reduce((sum, entry) => sum + entry.target.bytes, 0), [entries]);
  const cautionCount = entries.filter((entry) => entry.target.safety === 'caution').length;
  const projectCount = new Set(entries.map((entry) => entry.project.id)).size;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !queueing) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queueing, onClose]);

  async function handleConfirm() {
    setQueueing(true);
    const jobId = await cleanTargets(entries.map((entry) => entry.target.id));
    if (jobId) onQueued(jobId);
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
              Delete {pluralize(entries.length, 'folder')}?
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              Frees {formatBytes(totalBytes)} across {pluralize(projectCount, 'project')}.
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
          {entries.map(({ project, target }) =>
          <li
            key={target.id}
            className="flex items-center justify-between gap-4 border-b border-line/60 py-2 last:border-b-0">

              <span
              className="min-w-0 truncate font-mono text-[11px] text-muted"
              title={targetPath(project, target)}>

                {`${project.name}\\${target.relativePath}`}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink">
                {formatBytes(target.bytes)}
              </span>
            </li>
          )}
        </ul>

        <div className="border-t border-line px-6 py-4">
          {cautionCount > 0 &&
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger">
              <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              {pluralize(cautionCount, 'folder')} in this batch is slow to rebuild — native NDK output and profiler
              captures are not regenerated automatically.
            </p>
          }
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-faint">
            <UndoDotIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
            <span>
              Nothing is touched straight away — the deletion waits a few seconds in the task bar below, and you can
              call it off in that window. After that it runs in the background while you carry on.
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

              Delete {formatBytes(totalBytes)}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>);

}
