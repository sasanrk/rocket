import { motion } from 'framer-motion';
import { Trash2Icon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import { formatBytes, pluralize } from '../utils/format';

interface SelectionBarProps {
  onRequestClean: (targetIds: string[]) => void;
}

export function SelectionBar({ onRequestClean }: SelectionBarProps) {
  const { selectedTargets, selectedBytes, clearSelection } = useCleaner();
  const projectCount = new Set(selectedTargets.map((entry) => entry.project.id)).size;

  return (
    <motion.div
      initial={{ y: 56, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 56, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      className="flex shrink-0 items-center gap-4 border-t border-line bg-surface px-6 py-3">
      
      <p className="text-[13px] text-muted">
        <span className="font-medium text-ink">{pluralize(selectedTargets.length, 'folder')}</span> in{' '}
        {pluralize(projectCount, 'project')}
      </p>
      <span className="h-4 w-px bg-line" />
      <p className="font-mono text-[13px] font-medium tabular-nums text-accent">{formatBytes(selectedBytes)}</p>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={clearSelection}
          className="rounded-lg px-3 py-2 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
          
          Clear
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.985 }}
          transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
          onClick={() => onRequestClean(selectedTargets.map((entry) => entry.target.id))}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90">
          
          <Trash2Icon className="h-4 w-4" strokeWidth={2.1} />
          Clean {formatBytes(selectedBytes)}
        </motion.button>
      </div>
    </motion.div>);

}