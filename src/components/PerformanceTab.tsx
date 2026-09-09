import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ActivityIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  GaugeIcon,
  HardDriveIcon,
  ShieldIcon,
  TriangleAlertIcon } from
'lucide-react';
import { useMachine, useMachineWatch } from '../contexts/MachineContext';
import type { ViewId } from './views';
import type { ProcessInfo, SystemSnapshot } from '../types/system';
import { formatBytes, formatDuration, formatPercent, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

/** Every panel on this tab shares one frame, so the grid stays legible. */
function Panel({ title, icon, children, className }: {title: string;icon?: React.ReactNode;children: React.ReactNode;className?: string;}) {
  return (
    <section className={cn('flex flex-col rounded-xl border border-line bg-surface', className)}>
      <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
        {icon}
        {title}
      </h2>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>);

}

function Stat({
  icon,
  label,
  value,
  sub,
  ratio,
  tone = 'accent'






}: {icon: React.ReactNode;label: string;value: string;sub: string;ratio?: number;tone?: 'accent' | 'warn' | 'danger';}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      <p className="mt-1.5 text-[11.5px] text-muted">{sub}</p>
      {ratio !== undefined &&
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
          <motion.div
          className={cn(
            'h-full rounded-full',
            tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-node' : 'bg-accent'
          )}
          animate={{ width: `${Math.min(100, ratio * 100)}%` }}
          transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }} />

        </div>
      }
    </div>);

}

function CopyCommand({ command }: {command: string;}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-canvas p-2.5">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-muted">{command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => setCopied(true));
        }}
        className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">

        {copied ?
        <CheckIcon className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} /> :

        <CopyIcon className="h-3.5 w-3.5" strokeWidth={2} />
        }
      </button>
    </div>);

}

interface Finding {
  id: string;
  tone: 'info' | 'warn' | 'danger';
  title: string;
  body: string;
  command?: string;
}

/** Turns the raw reading into the handful of things actually worth acting on. */
function buildFindings(
snapshot: SystemSnapshot,
defenderExclusions: string[] | null,
defenderBusy: boolean,
scannedRoots: string[])
: Finding[] {
  const findings: Finding[] = [];
  const memoryRatio = snapshot.memory.usedBytes / snapshot.memory.totalBytes;

  const byGroup = new Map<string, {label: string;cpu: number;memory: number;count: number;}>();
  snapshot.processes.forEach((process) => {
    const entry = byGroup.get(process.group) ?? { label: process.groupLabel, cpu: 0, memory: 0, count: 0 };
    entry.cpu += process.cpu;
    entry.memory += process.memoryBytes;
    entry.count += 1;
    byGroup.set(process.group, entry);
  });

  const heaviest = [...byGroup.values()].sort((a, b) => b.memory - a.memory)[0];

  if (memoryRatio > 0.85) {
    findings.push({
      id: 'memory',
      tone: 'danger',
      title: `Memory is ${formatPercent(memoryRatio * 100)} full`,
      body: heaviest ?
      `Once Windows starts swapping, every app feels slow at once and closing one rarely fixes it. ${heaviest.label} is holding the most: ${formatBytes(heaviest.memory)} across ${pluralize(heaviest.count, 'process', 'processes')}. Closing that group buys back the most headroom.` :
      'Once Windows starts swapping, every app feels slow at once. Close what you are not using.'
    });
  } else if (memoryRatio > 0.7 && heaviest) {
    findings.push({
      id: 'memory-warn',
      tone: 'warn',
      title: `${heaviest.label} is holding ${formatBytes(heaviest.memory)}`,
      body: `${pluralize(heaviest.count, 'process', 'processes')} in that group. There is still headroom, but this is the group to close first when things get tight.`
    });
  }

  if (snapshot.uptimeSeconds > 24 * 3600 && memoryRatio > 0.7) {
    findings.push({
      id: 'uptime',
      tone: 'warn',
      title: `Up for ${formatDuration(snapshot.uptimeSeconds * 1000)} with memory this full`,
      body: 'This is the state a restart actually fixes — leaked handles and fragmented memory that ending single processes will not recover. Ending the heaviest group first is worth trying before you reboot.'
    });
  }

  const busiest = [...snapshot.processes].sort((a, b) => b.cpu - a.cpu)[0];
  if (busiest && busiest.cpu > 25 && !busiest.protected) {
    findings.push({
      id: 'cpu',
      tone: 'warn',
      title: `${busiest.title || busiest.name} is using ${formatPercent(busiest.cpu, 0)} of the CPU`,
      body: 'If it is a build you need, leave it. If it is background work you do not, drop it to below-normal priority on the Processes tab — it keeps running but stops fighting whatever you are typing into.'
    });
  }

  if (defenderBusy) {
    const covered = scannedRoots.filter((root) =>
    (defenderExclusions ?? []).some((exclusion) => root.toLowerCase().startsWith(exclusion.toLowerCase()))
    );
    const uncovered = scannedRoots.filter((root) => !covered.includes(root));

    if (uncovered.length > 0) {
      findings.push({
        id: 'defender',
        tone: 'info',
        title: 'Defender is scanning your project folders as they change',
        body: `Real-time scanning inspects every file npm, Gradle and your bundler writes, which is why disk usage spikes and stays high during installs and builds. Excluding a folder you only ever build in removes that cost — it also means Defender stops checking files there, so only do it for folders whose contents you trust. Run this in an elevated PowerShell for ${uncovered.join(', ')}:`,
        command: uncovered.map((root) => `Add-MpPreference -ExclusionPath '${root}'`).join('; ')
      });
    } else if (scannedRoots.length > 0) {
      findings.push({
        id: 'defender-ok',
        tone: 'info',
        title: 'Your project folders are already excluded from Defender',
        body: `${scannedRoots.join(', ')} ${scannedRoots.length === 1 ? 'is' : 'are'} on the exclusion list, so installs and builds there are not being scanned file by file.`
      });
    }
  }

  snapshot.disks.forEach((disk) => {
    const freeRatio = disk.freeBytes / disk.totalBytes;
    if (freeRatio < 0.1) {
      findings.push({
        id: `disk-${disk.root}`,
        tone: freeRatio < 0.05 ? 'danger' : 'warn',
        title: `${disk.root} has ${formatBytes(disk.freeBytes)} left`,
        body: `That is ${formatPercent(freeRatio * 100, 1)} of the drive. Windows needs room to page and to write update files; below about 10% the whole machine gets slower. Point the Projects tab at this drive — rebuildable folders are usually where the space went.`
      });
    }
  });

  return findings;
}

function TopList({ items, render, max }: {items: ProcessInfo[];render: (process: ProcessInfo) => string;max: number;}) {
  return (
    <ul className="space-y-2.5">
      {items.map((process) => {
        const value = process.cpu;
        return (
          <li key={process.pid}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[12.5px] text-ink" title={process.title || process.name}>
                {process.title || process.name}
              </span>
              <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted">{render(process)}</span>
            </div>
            <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full rounded-full bg-accent/70"
                animate={{ width: `${Math.min(100, (max > 0 ? value / max : 0) * 100)}%` }}
                transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }} />

            </div>
          </li>);

      })}
      {items.length === 0 && <li className="text-[12px] text-faint">Nothing notable</li>}
    </ul>);

}

export function PerformanceTab({ scannedRoots, onOpen }: {scannedRoots: string[];onOpen: (view: ViewId) => void;}) {
  useMachineWatch();
  const { snapshot, defender, refreshDefender, throttle, throttleLevels, setThrottle, isNative } = useMachine();

  useEffect(() => {
    void refreshDefender();
  }, [refreshDefender]);

  const defenderProcess = useMemo(
    () => snapshot?.processes.find((process) => process.name.toLowerCase() === 'msmpeng') ?? null,
    [snapshot]
  );

  const findings = useMemo(() => {
    if (!snapshot) return [];
    return buildFindings(
      snapshot,
      defender?.exclusions ?? null,
      Boolean(defender?.running || defenderProcess),
      scannedRoots
    );
  }, [snapshot, defender, defenderProcess, scannedRoots]);

  const topCpu = useMemo(
    () => (snapshot ? [...snapshot.processes].sort((a, b) => b.cpu - a.cpu).slice(0, 6) : []),
    [snapshot]
  );
  const topMemory = useMemo(
    () => (snapshot ? [...snapshot.processes].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 6) : []),
    [snapshot]
  );

  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <ActivityIcon className="h-4 w-4 animate-pulse" strokeWidth={1.8} />
          Taking a reading…
        </p>
      </div>);

  }

  const memoryRatio = snapshot.memory.usedBytes / snapshot.memory.totalBytes;
  const cpuMax = topCpu[0]?.cpu ?? 1;
  const memoryMax = topMemory[0]?.memoryBytes ?? 1;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<GaugeIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label="CPU"
          value={formatPercent(snapshot.cpuPercent, 0)}
          sub={`across ${snapshot.cores} cores`}
          ratio={snapshot.cpuPercent / 100}
          tone={snapshot.cpuPercent > 85 ? 'danger' : snapshot.cpuPercent > 60 ? 'warn' : 'accent'} />

        <Stat
          icon={<ActivityIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Memory"
          value={formatBytes(snapshot.memory.usedBytes)}
          sub={`of ${formatBytes(snapshot.memory.totalBytes)} · ${formatBytes(snapshot.memory.freeBytes)} free`}
          ratio={memoryRatio}
          tone={memoryRatio > 0.85 ? 'danger' : memoryRatio > 0.7 ? 'warn' : 'accent'} />

        <Stat
          icon={<HardDriveIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Free space"
          value={formatBytes(snapshot.disks.reduce((sum, disk) => sum + disk.freeBytes, 0))}
          sub={`across ${pluralize(snapshot.disks.length, 'drive')}`} />

        <Stat
          icon={<ClockIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Uptime"
          value={formatDuration(snapshot.uptimeSeconds * 1000)}
          sub={`${pluralize(snapshot.processes.length, 'process', 'processes')} running`} />

      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Busiest right now">
          <TopList items={topCpu} max={cpuMax} render={(process) => formatPercent(process.cpu, 1)} />
        </Panel>

        <Panel title="Holding the most memory">
          <ul className="space-y-2.5">
            {topMemory.map((process) =>
            <li key={process.pid}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[12.5px] text-ink" title={process.title || process.name}>
                    {process.title || process.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted">
                    {formatBytes(process.memoryBytes)}
                  </span>
                </div>
                <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-line">
                  <motion.div
                  className="h-full rounded-full bg-node/70"
                  animate={{ width: `${Math.min(100, process.memoryBytes / memoryMax * 100)}%` }}
                  transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }} />

                </div>
              </li>
            )}
          </ul>
        </Panel>

        <Panel title="Drives" icon={<HardDriveIcon className="h-3.5 w-3.5" strokeWidth={2} />}>
          <div className="space-y-3">
            {snapshot.disks.map((disk) => {
              const usedRatio = 1 - disk.freeBytes / disk.totalBytes;
              return (
                <div key={disk.root}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[12px] text-ink">{disk.root}</span>
                    <span className="font-mono text-[11px] tabular-nums text-muted">
                      {formatBytes(disk.freeBytes)} free
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
                    <motion.div
                      className={cn(
                        'h-full rounded-full',
                        usedRatio > 0.9 ? 'bg-danger' : usedRatio > 0.8 ? 'bg-node' : 'bg-accent'
                      )}
                      animate={{ width: `${usedRatio * 100}%` }}
                      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }} />

                  </div>
                </div>);

            })}
          </div>
        </Panel>

      </div>

      {defender && defender.available &&
      <button
        type="button"
        onClick={() => onOpen('antivirus')}
        className="mt-3 flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-colors duration-150 ease-swift hover:bg-raised/60">

          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <ShieldIcon className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">
              {defender.devPaths.filter((entry) => !entry.covered).length > 0 ?
            `Real-time scanning still inspects ${pluralize(defender.devPaths.filter((entry) => !entry.covered).length, 'folder')} your build tools write to` :
            'Every build cache is excluded from real-time scanning'}
            </span>
            <span className="mt-0.5 block text-[11.5px] text-muted">
              {defenderProcess ? `Defender is using ${formatPercent(defenderProcess.cpu, 1)} of the CPU and ${formatBytes(defenderProcess.memoryBytes)}. ` : ''}
              Exclusions, process exclusions and the protection switch live on the Antivirus page.
            </span>
          </span>
          <span className="shrink-0 text-[12px] font-medium text-accent">Open</span>
        </button>
      }

      {isNative &&
      <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-[280px] max-w-2xl flex-1">
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">
                How hard the scanner may push the disk
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                Scanning runs in its own process so the window never blocks. This sets how wide it fans out and what
                priority it runs at — gentle keeps it out of your way while you work, fast finishes sooner but you
                will feel it.
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {throttleLevels.map((level) =>
            <button
              key={level.id}
              type="button"
              onClick={() => void setThrottle(level.id)}
              className={cn(
                'rounded-lg border px-3.5 py-2 text-[12px] font-medium transition-colors duration-150 ease-swift',
                throttle === level.id ?
                'border-accent/40 bg-accent/10 text-accent' :
                'border-line bg-raised text-muted hover:text-ink'
              )}>

                  {level.label}
                </button>
            )}
            </div>
          </div>
        </div>
      }

      <div className="mt-3 grid gap-3 pb-2 xl:grid-cols-2">
        {findings.map((finding) =>
        <div
          key={finding.id}
          className={cn(
            'rounded-xl border p-4',
            finding.tone === 'danger' ?
            'border-danger/30 bg-danger/5' :
            finding.tone === 'warn' ?
            'border-node/30 bg-node/5' :
            'border-line bg-surface'
          )}>

            <p className="flex items-start gap-2 text-[13px] font-medium text-ink">
              {finding.tone !== 'info' &&
            <TriangleAlertIcon
              className={cn('mt-0.5 h-4 w-4 shrink-0', finding.tone === 'danger' ? 'text-danger' : 'text-node')}
              strokeWidth={2.2} />

            }
              {finding.title}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{finding.body}</p>
            {finding.command && <CopyCommand command={finding.command} />}
          </div>
        )}
        {findings.length === 0 &&
        <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[13px] font-medium text-ink">Nothing is obviously wrong right now</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              CPU, memory and disk are all inside comfortable margins. This panel fills up when they are not.
            </p>
          </div>
        }
      </div>
    </div>);

}
