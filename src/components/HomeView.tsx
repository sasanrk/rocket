import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ActivityIcon,
  ArrowRightIcon,
  FolderTreeIcon,
  HardDriveIcon,
  RocketIcon,
  ShieldIcon,
  TriangleAlertIcon,
  ZapIcon } from
'lucide-react';
import { BRAND } from '../brand';
import { useCleaner } from '../contexts/CleanerContext';
import { useCpu, useCpuWatch } from '../contexts/CpuContext';
import { useJunk } from '../contexts/JunkContext';
import { useMachine, useMachineWatch } from '../contexts/MachineContext';
import type { ViewId } from './views';
import { formatBytes, formatGHz, formatPercent, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

interface PillarProps {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  /** The one number that says how this machine is doing on this front. */
  figure: string;
  figureLabel: string;
  body: string;
  actions: {label: string;view: ViewId;primary?: boolean;}[];
  onOpen: (view: ViewId) => void;
  tone?: 'accent' | 'warn';
  delay: number;
}

function Pillar({ icon, eyebrow, title, figure, figureLabel, body, actions, onOpen, tone = 'accent', delay }: PillarProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col rounded-2xl border border-line bg-surface p-5">

      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            tone === 'warn' ? 'bg-node/10 text-node' : 'bg-accent/10 text-accent'
          )}>

          {icon}
        </span>
        <div className="leading-tight">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{eyebrow}</p>
          <p className="text-[14px] font-semibold tracking-tight text-ink">{title}</p>
        </div>
      </div>

      <p className="mt-5 text-[30px] font-semibold leading-none tracking-tight text-ink">{figure}</p>
      <p className="mt-1.5 text-[11.5px] text-muted">{figureLabel}</p>

      <p className="mt-4 flex-1 text-[12.5px] leading-relaxed text-muted">{body}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {actions.map((action) =>
        <button
          key={action.view}
          type="button"
          onClick={() => onOpen(action.view)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-all duration-150 ease-swift',
            action.primary ?
            'bg-accent text-accent-ink hover:opacity-90' :
            'border border-line text-muted hover:border-faint hover:text-ink'
          )}>

            {action.label}
            {action.primary && <ArrowRightIcon className="h-3.5 w-3.5" strokeWidth={2.4} />}
          </button>
        )}
      </div>
    </motion.section>);

}

/**
 * The front page. Says what the app is in one breath, then shows the three
 * things it does with a live number for each and a way in.
 */
export function HomeView({ onOpen }: {onOpen: (view: ViewId) => void;}) {
  useMachineWatch();
  useCpuWatch();
  const { snapshot, defender } = useMachine();
  const { totals: projectTotals, root } = useCleaner();
  const { totalBytes: junkBytes, phase: junkPhase } = useJunk();
  const { cpu, live, pendingTweakIds } = useCpu();

  const disks = snapshot?.disks ?? [];
  const freeBytes = disks.reduce((sum, disk) => sum + disk.freeBytes, 0);
  const found = projectTotals.reclaimable + junkBytes;
  const memoryRatio = snapshot ? snapshot.memory.usedBytes / snapshot.memory.totalBytes : 0;
  const busiest = useMemo(
    () => (snapshot ? [...snapshot.processes].filter((process) => !process.isSelf).sort((a, b) => b.cpu - a.cpu)[0] ?? null : null),
    [snapshot]
  );
  const perf = live?.perfPercent ?? null;
  const exposed = defender ? defender.devPaths.filter((entry) => !entry.covered).length : 0;
  const tightDisk = disks.find((disk) => disk.freeBytes / disk.totalBytes < 0.1);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
      <div className="relative overflow-hidden border-b border-line bg-surface px-8 pb-8 pt-9">
        <div className="pointer-events-none absolute -right-24 -top-32 h-[360px] w-[360px] rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 h-[300px] w-[300px] rounded-full bg-node/5 blur-3xl" />
        <div className="relative max-w-3xl">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">
            <RocketIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
            {BRAND.name}
          </p>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
            Make this PC fast again.
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">{BRAND.positioning}</p>
        </div>

        {(tightDisk || (perf !== null && perf < 85 && (live?.utilityPercent ?? 0) > 40)) &&
        <div className="relative mt-6 flex flex-wrap gap-2">
            {tightDisk &&
          <button
            type="button"
            onClick={() => onOpen('projects')}
            className="inline-flex items-center gap-2 rounded-lg border border-node/30 bg-node/5 px-3 py-1.5 text-[12px] font-medium text-node transition-colors duration-150 ease-swift hover:bg-node/10">

                <TriangleAlertIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                {tightDisk.root} has only {formatBytes(tightDisk.freeBytes)} left
              </button>
          }
            {perf !== null && perf < 85 && (live?.utilityPercent ?? 0) > 40 &&
          <button
            type="button"
            onClick={() => onOpen('power')}
            className="inline-flex items-center gap-2 rounded-lg border border-node/30 bg-node/5 px-3 py-1.5 text-[12px] font-medium text-node transition-colors duration-150 ease-swift hover:bg-node/10">

                <TriangleAlertIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                The CPU is busy but held to {formatPercent(perf, 0)} of its clock
              </button>
          }
          </div>
        }
      </div>

      <div className="grid gap-4 p-6 xl:grid-cols-3">
        <Pillar
          delay={0.02}
          icon={<FolderTreeIcon className="h-4 w-4" strokeWidth={2.2} />}
          eyebrow="Free up space"
          title="Delete only what comes back"
          figure={found > 0 ? formatBytes(found) : formatBytes(freeBytes)}
          figureLabel={
          found > 0 ?
          `found so far · ${formatBytes(freeBytes)} free across ${pluralize(disks.length, 'drive')}` :
          `free across ${pluralize(disks.length, 'drive')} · nothing scanned yet`
          }
          body={
          root ?
          `Project folders and app caches are measured, not guessed. Everything listed is rebuilt by npm, Gradle, or the app itself the next time it runs.` :
          `See what fills each drive folder by folder, empty what installed apps like Claude, VS Code and Chrome have left behind, uninstall what you no longer use — and, for developers, every drive is scanned for project folders the tooling can rebuild.`
          }
          actions={[
          { label: 'Drives', view: 'drives', primary: true },
          { label: junkPhase === 'idle' ? 'Find app junk' : 'App junk', view: 'apps' },
          { label: 'Uninstall programs', view: 'programs' },
          { label: root ? 'Project folders' : 'Projects (for developers)', view: 'projects' }]
          }
          onOpen={onOpen}
          tone={tightDisk ? 'warn' : 'accent'} />


        <Pillar
          delay={0.08}
          icon={<ZapIcon className="h-4 w-4" strokeWidth={2.2} />}
          eyebrow="Speed up"
          title="Run at the speed you paid for"
          figure={formatGHz(live?.currentMHz ?? null)}
          figureLabel={
          cpu ?
          `${perf === null ? 'reading' : `${formatPercent(perf, 0)} of`} the rated ${formatGHz(cpu.maxMHz)} · ${cpu.activeScheme?.name ?? 'unknown'} plan` :
          'reading the processor…'
          }
          body={
          pendingTweakIds.length > 0 ?
          `${pluralize(pendingTweakIds.length, 'power-plan change')} would let this ${cpu?.isLaptop ? 'laptop' : 'machine'} hold its turbo, stop parking cores and stop idling the clock. One administrator prompt, and one click to put it all back.` :
          `The power plan already lets the processor run flat out. What is left is trimming what starts with Windows and what runs in the background.`
          }
          actions={[
          { label: pendingTweakIds.length > 0 ? `Apply ${pluralize(pendingTweakIds.length, 'change')}` : 'CPU & power', view: 'power', primary: true },
          { label: 'Startup programs', view: 'startup' }]
          }
          onOpen={onOpen}
          tone={perf !== null && perf < 85 && (live?.utilityPercent ?? 0) > 40 ? 'warn' : 'accent'} />


        <Pillar
          delay={0.14}
          icon={<ActivityIcon className="h-4 w-4" strokeWidth={2.2} />}
          eyebrow="Keep watch"
          title="Know what is slowing it down"
          figure={snapshot ? formatPercent(snapshot.cpuPercent, 0) : '—'}
          figureLabel={
          snapshot ?
          `CPU right now · memory ${formatPercent(memoryRatio * 100, 0)} full${busiest && busiest.cpu > 5 ? ` · busiest: ${busiest.title || busiest.name}` : ''}` :
          'taking a reading…'
          }
          body={
          exposed > 0 ?
          `Real-time antivirus is still inspecting ${pluralize(exposed, 'folder')} your build tools write to constantly, which is what stalls an npm install. The rest of the machine is one page away.` :
          `Live process table grouped by what things are, with priority control, plus the drives, memory and the antivirus settings that decide how a build feels.`
          }
          actions={[
          { label: 'Performance', view: 'performance', primary: true },
          { label: 'This PC & upgrades', view: 'system' },
          { label: exposed > 0 ? `Antivirus · ${exposed} exposed` : 'Processes', view: exposed > 0 ? 'antivirus' : 'processes' }]
          }
          onOpen={onOpen}
          tone={exposed > 0 || memoryRatio > 0.85 ? 'warn' : 'accent'} />

      </div>

      {disks.length > 0 &&
      <div className="px-6 pb-6">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
              <HardDriveIcon className="h-3.5 w-3.5" strokeWidth={2} />
              Drives
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {disks.map((disk) => {
              const usedRatio = 1 - disk.freeBytes / disk.totalBytes;
              return (
                <div key={disk.root}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[12.5px] text-ink">{disk.root}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">{formatBytes(disk.freeBytes)} free</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
                      <motion.div
                      className={cn('h-full rounded-full', usedRatio > 0.9 ? 'bg-danger' : usedRatio > 0.8 ? 'bg-node' : 'bg-accent')}
                      initial={{ width: 0 }}
                      animate={{ width: `${usedRatio * 100}%` }}
                      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }} />

                    </div>
                    <p className="mt-1 text-[10.5px] text-faint">{formatBytes(disk.totalBytes)} total</p>
                  </div>);

            })}
            </div>
          </div>
        </div>
      }

      <div className="flex items-center gap-2 px-8 pb-6 text-[11.5px] text-faint">
        <ShieldIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Nothing is deleted or changed without a review, every deletion waits a few seconds so it can be called off, and every
        power-plan change keeps its original for one-click restore.
      </div>
    </div>);

}
