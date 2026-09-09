import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { FolderPlusIcon, HardDriveIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import { useCpu } from '../contexts/CpuContext';
import { useJunk } from '../contexts/JunkContext';
import { useMachine } from '../contexts/MachineContext';
import { useTheme } from '../contexts/ThemeContext';
import { Sidebar } from './Sidebar';
import { HomeView } from './HomeView';
import { ProjectsTab } from './ProjectsTab';
import { AppsTab } from './AppsTab';
import { ProgramsView } from './ProgramsView';
import { DrivesView } from './DrivesView';
import { SystemView } from './SystemView';
import { desktop } from '../utils/desktopBridge';
import { ProcessesTab } from './ProcessesTab';
import { PerformanceTab } from './PerformanceTab';
import { PowerView } from './PowerView';
import { StartupView } from './StartupView';
import { ServicesView } from './ServicesView';
import { AntivirusView } from './AntivirusView';
import { HistoryTab } from './HistoryTab';
import { CleanDialog } from './CleanDialog';
import { BlockedDialog } from './BlockedDialog';
import { TaskDock } from './TaskDock';
import { VIEW_META, type ViewId } from './views';
import { formatBytes, formatPercent } from '../utils/format';
import { cn } from '../utils/cn';
import { usePref } from '../utils/prefs';

/** What the Projects page is scanning, and the controls for it. */
function ProjectsActions() {
  const { roots, phase, rescan, pickFolder, cancelScan } = useCleaner();
  const isScanning = phase === 'scanning';
  const drives = roots.filter((entry) => entry.kind === 'drive');
  const folders = roots.filter((entry) => entry.kind === 'folder');

  return (
    <div className="flex min-w-0 items-center gap-2">
      {roots.length > 0 &&
      <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[11.5px] text-muted">
          <HardDriveIcon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
          <span className="truncate font-mono">
            {drives.map((entry) => entry.path).join(' ')}
            {folders.length > 0 && <span className="text-faint"> + {folders.length === 1 ? folders[0].path : `${folders.length} folders`}</span>}
          </span>
        </div>
      }
      <button
        type="button"
        onClick={pickFolder}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">

        <FolderPlusIcon className="h-3.5 w-3.5" strokeWidth={2} />
        Include folder
      </button>
      {isScanning ?
      <button
        type="button"
        onClick={cancelScan}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:border-danger/40 hover:text-danger">

          <XIcon className="h-3.5 w-3.5" strokeWidth={2} />
          Stop
        </button> :

      <button
        type="button"
        onClick={rescan}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

          <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={2} />
          Rescan
        </button>
      }
    </div>);

}

interface WorkspaceProps {
  density: 'comfortable' | 'compact';
}

/**
 * The shell: sidebar on the left, a page header and the active page on the
 * right, the task dock along the bottom of the page column.
 */
export function Workspace({ density }: WorkspaceProps) {
  const { root, totals, cleanFailures, dismissFailures } = useCleaner();
  const { snapshot, history, defender, isNative } = useMachine();
  const { totalBytes: junkBytes } = useJunk();
  const { cpu, startup, pendingTweakIds } = useCpu();
  const { theme } = useTheme();
  // The page you left the app on is the page it reopens on.
  const [view, setView] = usePref('view');
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const isCompact = density === 'compact';

  // Roots the app knows about, so the Performance page can tell whether the
  // folders you actually build in are excluded from antivirus scanning.
  const scannedRoots = useMemo(() => {
    const roots = new Set<string>();
    if (root) roots.add(root);
    history.forEach((entry) => {
      if (entry.type === 'scan' && entry.root) roots.add(entry.root);
    });
    return [...roots].slice(0, 4);
  }, [root, history]);

  const exposed = defender ? defender.devPaths.filter((entry) => !entry.covered).length : 0;
  const startupOn = startup.filter((entry) => entry.enabled).length;

  const badges: Partial<Record<ViewId, string>> = {
    projects: totals.reclaimable > 0 ? formatBytes(totals.reclaimable) : undefined,
    apps: junkBytes > 0 ? formatBytes(junkBytes) : undefined,
    power: cpu && pendingTweakIds.length > 0 ? String(pendingTweakIds.length) : undefined,
    startup: startup.length > 0 ? String(startupOn) : undefined,
    processes: snapshot ? formatPercent(snapshot.cpuPercent, 0) : undefined,
    antivirus: exposed > 0 ? String(exposed) : undefined
  };

  const attention: Partial<Record<ViewId, boolean>> = {
    power: pendingTweakIds.length > 0,
    antivirus: exposed > 0,
    processes: Boolean(snapshot && snapshot.cpuPercent > 85)
  };

  const meta = VIEW_META[view];

  // The window has no native frame; Windows draws only its caption buttons,
  // over this strip, in colours that follow the theme.
  useEffect(() => {
    void desktop.setTitleBarTheme(theme);
  }, [theme]);

  return (
    <div className="flex h-full min-h-full w-full flex-col overflow-hidden bg-canvas">
      <div
        className="flex h-9 shrink-0 items-center border-b border-line bg-surface"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <div className="flex min-h-0 flex-1">
      <Sidebar view={view} onSelect={setView} badges={badges} attention={attention} isNative={isNative} />

      <div className="flex min-w-0 flex-1 flex-col">
        {view !== 'home' &&
        <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
            <div className="min-w-0 flex-1 leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight text-ink">{meta.title}</h1>
              <p className="mt-0.5 truncate text-[11.5px] text-faint" title={meta.description}>
                {meta.description}
              </p>
            </div>
            {view === 'projects' && <ProjectsActions />}
          </header>
        }

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            className={cn('flex min-h-0 flex-1 flex-col')}>

            {view === 'home' && <HomeView onOpen={setView} />}
            {view === 'projects' && <ProjectsTab isCompact={isCompact} onRequestClean={setPendingIds} />}
            {view === 'apps' && <AppsTab />}
            {view === 'programs' && <ProgramsView />}
            {view === 'drives' && <DrivesView />}
            {view === 'power' && <PowerView />}
            {view === 'startup' && <StartupView />}
            {view === 'services' && <ServicesView />}
            {view === 'performance' && <PerformanceTab scannedRoots={scannedRoots} onOpen={setView} />}
            {view === 'processes' && <ProcessesTab />}
            {view === 'antivirus' && <AntivirusView />}
            {view === 'system' && <SystemView />}
            {view === 'history' && <HistoryTab />}
          </motion.div>
        </AnimatePresence>

        <TaskDock />
      </div>
      </div>

      <AnimatePresence>
        {cleanFailures.length > 0 &&
        <BlockedDialog failures={cleanFailures} onClose={dismissFailures} />
        }
      </AnimatePresence>

      <AnimatePresence>
        {pendingIds &&
        <CleanDialog
          targetIds={pendingIds}
          onClose={() => setPendingIds(null)}
          onQueued={() => {
            toast('Deletion queued', {
              description: 'You can still call it off from the task bar for a few seconds.'
            });
          }} />

        }
      </AnimatePresence>

      <Toaster
        theme={theme}
        position="bottom-right"
        offset={16}
        toastOptions={{
          style: {
            background: 'rgb(var(--surface))',
            border: '1px solid rgb(var(--line))',
            color: 'rgb(var(--ink))',
            fontFamily: 'Inter, sans-serif'
          }
        }} />

    </div>);

}
