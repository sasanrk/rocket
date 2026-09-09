import { AnimatePresence, motion } from 'framer-motion';
import { FolderXIcon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import { activeTargets, reclaimableBytes } from '../types/project';
import { ProjectRow } from './ProjectRow';
import type { CheckState } from './Checkbox';

interface ProjectListProps {
  isCompact: boolean;
}

export function ProjectList({ isCompact }: ProjectListProps) {
  const { visibleProjects, selected, focusedProject, focusProject, toggleProject, setQuery, setFilter, query } =
  useCleaner();

  const maxReclaimable = visibleProjects.reduce((max, project) => Math.max(max, reclaimableBytes(project)), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[18px_minmax(0,1fr)_104px_112px_176px_16px] items-center gap-4 border-b border-line bg-canvas px-6 py-2 text-[11px] font-medium text-faint">
        <span aria-hidden="true" />
        <span>Project</span>
        <span>Type</span>
        <span>Modified</span>
        <span className="text-right">Reclaimable</span>
        <span aria-hidden="true" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
        {visibleProjects.length === 0 ?
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="flex flex-col items-center justify-center px-6 py-20 text-center">
          
            <FolderXIcon className="h-6 w-6 text-faint" strokeWidth={1.8} />
            <p className="mt-3 text-[13px] font-medium text-ink">No projects match this view</p>
            <p className="mt-1 text-[12px] text-faint">
              {query ? `Nothing named “${query}” in this folder.` : 'Try a different project type.'}
            </p>
            <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
            className="mt-4 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
            
              Reset filters
            </button>
          </motion.div> :

        <ul>
            <AnimatePresence initial={false}>
              {visibleProjects.map((project) => {
              const targets = activeTargets(project);
              const selectedCount = targets.filter((target) => selected.has(target.id)).length;
              const state: CheckState =
              selectedCount === 0 ? 'none' : selectedCount === targets.length ? 'all' : 'some';
              return (
                <ProjectRow
                  key={project.id}
                  project={project}
                  selection={state}
                  isCompact={isCompact}
                  isFocused={focusedProject?.id === project.id}
                  maxReclaimable={maxReclaimable}
                  onToggle={() => toggleProject(project.id)}
                  onOpen={() => focusProject(focusedProject?.id === project.id ? null : project.id)} />);


            })}
            </AnimatePresence>
          </ul>
        }
      </div>
    </div>);

}