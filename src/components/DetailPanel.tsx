import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRightLeftIcon, CheckCircle2Icon, ExternalLinkIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { MoveDialog } from './MoveDialog';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Project } from '../types/project';
import { activeTargets, freedBytes, reclaimableBytes } from '../types/project';
import { Checkbox } from './Checkbox';
import { useCleaner } from '../contexts/CleanerContext';
import { formatBytes, formatCount } from '../utils/format';
import { desktop } from '../utils/desktopBridge';
import { classifyTarget, groupLabels, targetPath } from '../utils/targets';
import { cn } from '../utils/cn';

interface DetailPanelProps {
  project: Project;
  onRequestClean: (targetIds: string[]) => void;
}

export function DetailPanel({ project, onRequestClean }: DetailPanelProps) {
  const { focusProject, selected, toggleTarget } = useCleaner();
  const [moving, setMoving] = useState(false);
  const targets = activeTargets(project);
  const removed = project.targets.filter((target) => target.removed);
  const reclaimable = reclaimableBytes(project);
  const selectedIds = targets.filter((target) => selected.has(target.id)).map((target) => target.id);
  const cleanIds = selectedIds.length > 0 ? selectedIds : targets.map((target) => target.id);
  const cleanBytes = targets.
  filter((target) => cleanIds.includes(target.id)).
  reduce((sum, target) => sum + target.bytes, 0);

  return (
    <motion.aside
      aria-label={`${project.name} details`}
      initial={{ x: 28, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 28, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      className="flex w-[372px] shrink-0 flex-col border-l border-line bg-surface">
      
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{project.name}</h2>
          <button
            type="button"
            onClick={() => desktop.revealInExplorer(project.path)}
            className="mt-1 flex max-w-full items-center gap-1.5 truncate font-mono text-[11px] text-faint transition-colors duration-150 ease-swift hover:text-accent"
            title={project.path}>
            
            <span className="truncate">{project.path}</span>
            <ExternalLinkIcon className="h-3 w-3 shrink-0" strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={() => focusProject(null)}
          className="rounded-md p-1.5 text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
          
          <XIcon className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <dl className="grid grid-cols-3 gap-px border-b border-line bg-line">
        <div className="bg-surface px-5 py-3">
          <dt className="text-[11px] text-faint">On disk</dt>
          <dd className="mt-1 font-mono text-[13px] tabular-nums text-ink">{formatBytes(project.totalBytes)}</dd>
        </div>
        <div className="bg-surface px-3 py-3">
          <dt className="text-[11px] text-faint">Reclaimable</dt>
          <dd className="mt-1 font-mono text-[13px] font-medium tabular-nums text-accent">
            {formatBytes(reclaimable)}
          </dd>
        </div>
        <div className="bg-surface px-3 py-3">
          <dt className="text-[11px] text-faint">Modified</dt>
          <dd className="mt-1 text-[12px] text-muted">
            {formatDistanceToNowStrict(new Date(project.lastModified), { addSuffix: true })}
          </dd>
        </div>
      </dl>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-5 py-4">
        <p className="text-[12px] font-medium text-muted">Cleanable folders</p>

        {targets.length === 0 ?
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-line bg-raised px-3 py-3">
            <CheckCircle2Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
            <p className="text-[12px] leading-relaxed text-muted">
              Nothing left to delete here. Only source files and version control remain.
            </p>
          </div> :

        <ul className="mt-3 space-y-2">
            {targets.map((target) => {
            const isSelected = selected.has(target.id);
            return (
              <li key={target.id}>
                  <div
                  className={cn(
                    'rounded-lg border px-3 py-2.5 transition-colors duration-150 ease-swift',
                    isSelected ? 'border-accent/40 bg-accent/5' : 'border-line bg-raised'
                  )}>
                  
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                      state={isSelected ? 'all' : 'none'}
                      label={`Select ${target.folder}`}
                      onChange={() => toggleTarget(target.id)}
                      className="mt-0.5" />
                    
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate font-mono text-[12px] font-medium text-ink">{target.relativePath}</p>
                          <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink">
                            {formatBytes(target.bytes)}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-faint">
                          {groupLabels[classifyTarget(target)]} · {formatCount(target.files)} files
                        </p>
                        <p
                        className={cn(
                          'mt-1.5 flex items-center gap-1.5 text-[11px]',
                          target.safety === 'caution' ? 'text-danger' : 'text-muted'
                        )}>
                        
                          {target.safety === 'caution' &&
                        <TriangleAlertIcon className="h-3 w-3 shrink-0" strokeWidth={2.2} />
                        }
                          {target.restoredBy}
                        </p>
                      </div>
                    </div>
                  </div>
                </li>);

          })}
          </ul>
        }

        {removed.length > 0 &&
        <div className="mt-6">
            <p className="text-[12px] font-medium text-muted">Freed in this session</p>
            <ul className="mt-2 space-y-1.5">
              {removed.map((target) =>
            <li key={target.id} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="truncate font-mono text-faint line-through">{target.relativePath}</span>
                  <span className="shrink-0 font-mono tabular-nums text-accent">−{formatBytes(target.bytes)}</span>
                </li>
            )}
            </ul>
            <p className="mt-2 font-mono text-[11px] text-accent">
              {formatBytes(freedBytes(project))} recovered from this project
            </p>
          </div>
        }
      </div>

      <div className="border-t border-line px-5 py-4">
        <button
          type="button"
          onClick={() => setMoving(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-[12.5px] font-medium text-muted transition-colors duration-150 ease-swift hover:border-accent/40 hover:text-ink">

          <ArrowRightLeftIcon className="h-4 w-4" strokeWidth={2} />
          Move to another drive…
        </button>
        <p className="mt-1.5 text-center text-[10.5px] text-faint">Source, git and settings travel; build output stays and is deleted.</p>
      </div>

      <AnimatePresence>
        {moving && <MoveDialog project={project} onClose={() => setMoving(false)} />}
      </AnimatePresence>

      {targets.length > 0 &&
      <div className="border-t border-line px-5 py-4">
          <motion.button
          type="button"
          whileTap={{ scale: 0.985 }}
          transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
          onClick={() => onRequestClean(cleanIds)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90">
          
            Clean {formatBytes(cleanBytes)}
            <span className="text-[12px] font-medium opacity-70">
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : `${targets.length} folders`}
            </span>
          </motion.button>
          <p className="mt-2 text-center font-mono text-[10px] text-faint">
            {targetPath(project, targets[0]).
          split('\\').
          slice(-2).
          join('\\')}
            {targets.length > 1 && ` +${targets.length - 1} more`}
          </p>
        </div>
      }
    </motion.aside>);

}