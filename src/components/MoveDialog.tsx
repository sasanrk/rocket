import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, FolderOpenIcon, HardDriveIcon, Loader2Icon, TriangleAlertIcon, UndoDotIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useCleaner } from '../contexts/CleanerContext';
import type { Project } from '../types/project';
import type { MovePlan } from '../types/drives';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, formatCount } from '../utils/format';
import { cn } from '../utils/cn';

interface MoveDialogProps {
  project: Project;
  onClose: () => void;
}

function parentOf(target: string): string {
  const index = target.lastIndexOf('\\');
  return index > 0 ? target.slice(0, index) : target;
}

/**
 * Moves a project to another drive: pick where, see exactly what travels
 * and what stays behind, confirm. The copy goes through robocopy, the
 * original is deleted only once the copy has been measured to match.
 */
export function MoveDialog({ project, onClose }: MoveDialogProps) {
  const { drives, moveProject, isNative } = useCleaner();
  const [destination, setDestination] = useState<string | null>(null);
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [queueing, setQueueing] = useState(false);

  const sourceDrive = project.path.slice(0, 3).toUpperCase();
  const sourceParent = parentOf(project.path);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !queueing) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queueing, onClose]);

  useEffect(() => {
    if (!destination) {
      setPlan(null);
      return;
    }
    let live = true;
    setPlanning(true);
    desktop.
    planMove(project.path, destination).
    then((next) => {
      if (live) setPlan(next);
    }).
    catch((error: unknown) => {
      if (live) setPlan({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }).
    finally(() => {
      if (live) setPlanning(false);
    });
    return () => {live = false;};
  }, [destination, project.path]);

  /** The same relative place on another drive, e.g. D:\Dev\x → E:\Dev. */
  function suggestion(drive: string): string {
    const relative = sourceParent.slice(3);
    return relative ? `${drive}${relative}` : drive;
  }

  async function pick() {
    const chosen = await desktop.chooseFolder({ title: 'Choose where the project should live', buttonLabel: 'Move here', defaultPath: destination ?? undefined });
    if (chosen) setDestination(chosen);
  }

  async function confirm() {
    if (!destination || !plan?.ok) return;
    setQueueing(true);
    const result = await moveProject(project.path, destination);
    setQueueing(false);
    if (result.ok) {
      toast('Move queued', { description: 'You can still call it off from the task bar for a few seconds.' });
      onClose();
    } else {
      toast.error('Could not start the move', { description: result.message });
    }
  }

  const otherDrives = drives.filter((drive) => drive.root.toUpperCase() !== sourceDrive);

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
        aria-label="Move project"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-panel">

        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Move {project.name}</h2>
            <p className="mt-1 truncate font-mono text-[11px] text-faint" title={project.path}>{project.path}</p>
          </div>
          <button type="button" aria-label="Cancel" onClick={onClose} className="rounded-md p-1.5 text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
            <XIcon className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="px-6 py-4">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Where to</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {otherDrives.map((drive) => {
              const target = suggestion(drive.root);
              const active = destination?.toLowerCase() === target.toLowerCase();
              return (
                <button
                  key={drive.root}
                  type="button"
                  onClick={() => setDestination(target)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ease-swift',
                    active ? 'border-accent/50 bg-accent/10' : 'border-line bg-raised hover:border-faint'
                  )}>

                  <HardDriveIcon className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-faint')} strokeWidth={2} />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12px] text-ink">{target}</span>
                    <span className="block text-[10.5px] text-faint">{formatBytes(drive.freeBytes)} free of {formatBytes(drive.totalBytes)}</span>
                  </span>
                </button>);

            })}
            <button
              type="button"
              onClick={() => void pick()}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ease-swift',
                destination && !otherDrives.some((drive) => suggestion(drive.root).toLowerCase() === destination.toLowerCase()) ?
                'border-accent/50 bg-accent/10' :
                'border-dashed border-line hover:border-faint'
              )}>

              <FolderOpenIcon className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} />
              <span className="min-w-0">
                <span className="block text-[12px] text-ink">Choose a folder…</span>
                <span className="block truncate text-[10.5px] text-faint">
                  {destination && !otherDrives.some((drive) => suggestion(drive.root).toLowerCase() === destination.toLowerCase()) ? destination : 'Any folder on any drive'}
                </span>
              </span>
            </button>
          </div>

          <div className="mt-4 min-h-[112px] rounded-lg border border-line bg-raised/50 p-3">
            {!destination ?
            <p className="text-[12px] text-faint">Pick a destination to see what would move.</p> :
            planning ?
            <p className="flex items-center gap-2 text-[12px] text-faint">
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                Measuring what travels and what stays…
              </p> :
            plan && plan.ok ?
            <div>
                <p className="flex items-center gap-2 text-[12.5px] text-ink">
                  <span className="truncate font-mono text-[11.5px] text-muted">{project.path}</span>
                  <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.4} />
                  <span className="truncate font-mono text-[11.5px] text-ink">{plan.destination}</span>
                </p>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-[11.5px]">
                  <div>
                    <dt className="text-faint">Travels</dt>
                    <dd className="mt-0.5 font-mono text-[13px] text-ink">{formatBytes(plan.carriedBytes ?? 0)}</dd>
                    <dd className="text-[10.5px] text-faint">{formatCount(plan.carriedFiles ?? 0)} files</dd>
                  </div>
                  <div>
                    <dt className="text-faint">Stays and is deleted</dt>
                    <dd className="mt-0.5 font-mono text-[13px] text-accent">{formatBytes(plan.leftBehindBytes ?? 0)}</dd>
                    <dd className="text-[10.5px] text-faint">build output, freed on {sourceDrive}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">How</dt>
                    <dd className="mt-0.5 text-[12px] text-ink">{plan.sameDrive ? 'Instant rename' : 'robocopy, then verify'}</dd>
                    <dd className="text-[10.5px] text-faint">{plan.sameDrive ? 'same drive' : `${plan.freeBytes === null || plan.freeBytes === undefined ? '' : formatBytes(plan.freeBytes)} free there`}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[11px] leading-relaxed text-faint">
                  Skipped at every depth: {(plan.excluded ?? []).slice(0, 9).join(', ')} and other build folders. Run your install or
                  build once at the new location. Git history, .env files and everything else travel as they are.
                </p>
              </div> :

            <p className="flex items-start gap-2 text-[12px] text-danger">
                <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                {plan?.message ?? 'That destination will not work.'}
              </p>
            }
          </div>

          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-faint">
            <UndoDotIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
            <span>
              Nothing moves straight away — the job waits a few seconds in the task bar and can be called off. The original
              is only deleted after the copy has been measured and matches; if anything is off, both are kept and you are
              told.
            </span>
          </p>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
              Cancel
            </button>
            <motion.button
              type="button"
              disabled={!plan?.ok || planning || queueing || !isNative}
              whileTap={{ scale: 0.985 }}
              onClick={() => void confirm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-50">

              {queueing ? <Loader2Icon className="h-4 w-4 animate-spin" strokeWidth={2.4} /> : <ArrowRightIcon className="h-4 w-4" strokeWidth={2.2} />}
              Move {plan?.ok ? formatBytes(plan.carriedBytes ?? 0) : ''}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>);

}
