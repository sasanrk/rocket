import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useCleaner } from '../contexts/CleanerContext';
import { ScanProgressBand } from './ScanProgressBand';
import { ReclaimSummary } from './ReclaimSummary';
import { FilterBar } from './FilterBar';
import { ProjectList } from './ProjectList';
import { SelectionBar } from './SelectionBar';
import { DetailPanel } from './DetailPanel';

interface ProjectsTabProps {
  isCompact: boolean;
  onRequestClean: (ids: string[]) => void;
}

export function ProjectsTab({ isCompact, onRequestClean }: ProjectsTabProps) {
  const { phase, focusedProject, selected, scanEverything } = useCleaner();

  // The first visit scans every drive on its own; there is nothing to choose.
  useEffect(() => {
    if (phase === 'idle') scanEverything();
  }, [phase, scanEverything]);

  return (
    <main className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        {phase === 'scanning' ? <ScanProgressBand /> : <ReclaimSummary />}
        <FilterBar />
        <ProjectList isCompact={isCompact} />
        <AnimatePresence>
          {selected.size > 0 && <SelectionBar onRequestClean={onRequestClean} />}
        </AnimatePresence>
      </section>

      <AnimatePresence>
        {focusedProject && <DetailPanel project={focusedProject} onRequestClean={onRequestClean} />}
      </AnimatePresence>
    </main>);

}
