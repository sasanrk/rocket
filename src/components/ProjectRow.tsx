import { motion } from 'framer-motion';
import { ChevronRightIcon, SmartphoneIcon, TriangleAlertIcon } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Project } from '../types/project';
import { activeTargets, freedBytes, reclaimableBytes } from '../types/project';
import { Checkbox, type CheckState } from './Checkbox';
import { formatBytes } from '../utils/format';
import { cn } from '../utils/cn';

interface ProjectRowProps {
  project: Project;
  selection: CheckState;
  isFocused: boolean;
  isCompact: boolean;
  maxReclaimable: number;
  onToggle: () => void;
  onOpen: () => void;
}

function NodeMark() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-raised font-mono text-[10px] font-medium text-node">
      JS
    </span>);

}

function AndroidMark() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-raised text-android">
      <SmartphoneIcon className="h-3.5 w-3.5" strokeWidth={2} />
    </span>);

}

export function ProjectRow({
  project,
  selection,
  isFocused,
  isCompact,
  maxReclaimable,
  onToggle,
  onOpen
}: ProjectRowProps) {
  const reclaimable = reclaimableBytes(project);
  const freed = freedBytes(project);
  const remaining = activeTargets(project);
  const hasCaution = remaining.some((target) => target.safety === 'caution');
  const ratio = maxReclaimable > 0 ? reclaimable / maxReclaimable : 0;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="border-b border-line/70 last:border-b-0">
      
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open details for ${project.name}`}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          'grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_104px_112px_176px_16px] items-center gap-4 px-6 outline-none transition-colors duration-150 ease-swift',
          isCompact ? 'py-2' : 'py-3',
          isFocused ? 'bg-raised' : 'hover:bg-raised/60',
          'focus-visible:bg-raised focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent',
          reclaimable === 0 && 'opacity-60'
        )}>
        
        <Checkbox
          state={selection}
          label={`Select cleanable folders in ${project.name}`}
          disabled={remaining.length === 0}
          onChange={onToggle} />
        

        <div className="flex min-w-0 items-center gap-3">
          {project.kind === 'node' ? <NodeMark /> : <AndroidMark />}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-ink">{project.name}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] leading-tight text-faint">
              {project.framework} · {formatBytes(project.totalBytes)} on disk
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
              project.kind === 'node' ? 'border-node/30 text-node' : 'border-android/30 text-android'
            )}>
            
            {project.kind === 'node' ? 'Node' : 'Android'}
          </span>
          {hasCaution &&
          <span title="Contains folders that are slow to rebuild">
              <TriangleAlertIcon className="h-3.5 w-3.5 text-danger" strokeWidth={2} />
            </span>
          }
        </div>

        <p className="truncate text-[12px] text-faint">
          {formatDistanceToNowStrict(new Date(project.lastModified), { addSuffix: true })}
        </p>

        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
            <motion.span
              className={cn('block h-full rounded-full', reclaimable > 0 ? 'bg-accent' : 'bg-line')}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(ratio * 100, reclaimable > 0 ? 4 : 0)}%` }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }} />
            
          </div>
          {reclaimable > 0 ?
          <span className="w-[68px] shrink-0 text-right font-mono text-[12px] font-medium tabular-nums text-ink">
              {formatBytes(reclaimable)}
            </span> :

          <span className="w-[68px] shrink-0 text-right font-mono text-[11px] tabular-nums text-accent">
              {freed > 0 ? `−${formatBytes(freed)}` : 'clean'}
            </span>
          }
        </div>

        <ChevronRightIcon className="h-4 w-4 text-faint" strokeWidth={2} />
      </div>
    </motion.li>);

}