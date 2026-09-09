import { memo, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CpuIcon, SearchIcon, SquareIcon, TerminalIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useMachine, useMachineWatch } from '../contexts/MachineContext';
import type { PriorityClass, ProcessGroup, ProcessInfo } from '../types/system';
import { PRIORITY_CHOICES } from '../types/system';
import { formatBytes, formatCount, formatPercent } from '../utils/format';
import { cn } from '../utils/cn';
import { usePref, type ProcessSort as SortKey } from '../utils/prefs';

const GROUP_ORDER: ProcessGroup[] = ['node', 'build', 'editor', 'browser', 'security', 'system', 'other'];

interface GroupTotals {
  id: ProcessGroup | 'all';
  label: string;
  count: number;
  cpu: number;
  memory: number;
}

function ProcessRowBase({ process }: {process: ProcessInfo;}) {
  const { killProcess, setProcessPriority } = useMachine();
  const [busy, setBusy] = useState(false);

  const label = process.title || process.name;
  const detail = process.commandLine || (process.title ? process.name : process.groupLabel);

  async function handleKill() {
    setBusy(true);
    const result = await killProcess(process.pid);
    setBusy(false);
    if (result.ok) toast.success(`Ended ${process.name}`, { description: `pid ${process.pid}` });else
    toast.error(`Could not end ${process.name}`, { description: result.message });
  }

  async function handlePriority(priority: PriorityClass) {
    setBusy(true);
    const result = await setProcessPriority(process.pid, priority);
    setBusy(false);
    if (result.ok) toast.success(`${process.name} now runs at ${priority.toLowerCase()} priority`);else
    toast.error(`Could not change ${process.name}`, { description: result.message });
  }

  return (
    <tr className="border-b border-line/50 transition-colors duration-150 ease-swift hover:bg-raised/50">
      <td className="py-2.5 pl-5 pr-4">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-ink" title={label}>
            {label}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-faint">{process.pid}</span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[10.5px] leading-tight text-faint" title={detail}>
          {detail}
        </p>
      </td>

      <td className="w-[132px] px-4 py-2.5 align-middle">
        <div className="flex items-center gap-2">
          <span className="w-[42px] shrink-0 text-right font-mono text-[12px] tabular-nums text-ink">
            {process.cpu.toFixed(1)}
          </span>
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full bg-accent"
              animate={{ width: `${Math.min(100, process.cpu)}%` }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }} />

          </div>
        </div>
      </td>

      <td className="w-[104px] px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted">
        {formatBytes(process.memoryBytes)}
      </td>

      <td className="w-[168px] px-4 py-2.5">
        <select
          aria-label={`Priority for ${process.name}`}
          disabled={busy || process.protected}
          value={PRIORITY_CHOICES.some((choice) => choice.value === process.priority) ? process.priority : 'Normal'}
          onChange={(event) => void handlePriority(event.target.value as PriorityClass)}
          className="w-full rounded-md border border-line bg-raised px-2 py-1 text-[11.5px] text-muted outline-none transition-colors duration-150 ease-swift hover:text-ink focus:border-accent/50 disabled:cursor-not-allowed disabled:opacity-35">

          {PRIORITY_CHOICES.map((choice) =>
          <option key={choice.value} value={choice.value} title={choice.hint}>
              {choice.label}
            </option>
          )}
        </select>
      </td>

      <td className="w-[92px] py-2.5 pl-4 pr-5 text-right">
        <button
          type="button"
          disabled={busy || process.protected}
          onClick={() => void handleKill()}
          title={process.protected ? 'Windows and this app itself are off limits' : `End ${process.name}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11.5px] font-medium text-muted transition-colors duration-150 ease-swift hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:border-line disabled:hover:text-muted">

          <SquareIcon className="h-3 w-3" strokeWidth={2.4} />
          End
        </button>
      </td>
    </tr>);

}

/**
 * A snapshot rebuilds every process object, so without this the whole table
 * reconciles every three seconds. Most rows sit at 0% and never really change.
 */
const ProcessRow = memo(
  ProcessRowBase,
  (before, after) =>
  before.process.pid === after.process.pid &&
  before.process.cpu === after.process.cpu &&
  before.process.memoryBytes === after.process.memoryBytes &&
  before.process.priority === after.process.priority &&
  before.process.protected === after.process.protected &&
  before.process.title === after.process.title
);

function Headline({
  label,
  value,
  sub,
  ratio,
  tone




}: {label: string;value: string;sub: string;ratio?: number;tone?: 'warn' | 'danger';}) {
  return (
    <div className="min-w-[150px] max-w-[260px] flex-1">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[19px] font-semibold leading-none tracking-tight text-ink">{value}</span>
        <span className="text-[11.5px] text-muted">{sub}</span>
      </p>
      {ratio !== undefined &&
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
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

export function ProcessesTab() {
  useMachineWatch();
  const { snapshot, snapshotError, isNative } = useMachine();
  const [group, setGroup] = usePref('processGroup');
  const [sort, setSort] = usePref('processSort');
  const [query, setQuery] = useState('');

  const groups = useMemo<GroupTotals[]>(() => {
    if (!snapshot) return [];
    const totals = new Map<ProcessGroup, GroupTotals>();
    let allCpu = 0;
    let allMemory = 0;

    snapshot.processes.forEach((process) => {
      const entry =
      totals.get(process.group) ??
      { id: process.group, label: process.groupLabel, count: 0, cpu: 0, memory: 0 };
      entry.count += 1;
      entry.cpu += process.cpu;
      entry.memory += process.memoryBytes;
      totals.set(process.group, entry);
      allCpu += process.cpu;
      allMemory += process.memoryBytes;
    });

    const ordered = GROUP_ORDER.map((id) => totals.get(id)).filter(Boolean) as GroupTotals[];
    return [
    { id: 'all', label: 'Everything', count: snapshot.processes.length, cpu: allCpu, memory: allMemory },
    ...ordered];

  }, [snapshot]);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    const needle = query.trim().toLowerCase();
    const filtered = snapshot.processes.filter((process) => {
      if (group !== 'all' && process.group !== group) return false;
      if (!needle) return true;
      return (
        process.name.toLowerCase().includes(needle) ||
        process.title.toLowerCase().includes(needle) ||
        process.commandLine.toLowerCase().includes(needle) ||
        String(process.pid).includes(needle));

    });

    return filtered.sort((a, b) => {
      if (sort === 'memory') return b.memoryBytes - a.memoryBytes;
      if (sort === 'name') return a.name.localeCompare(b.name) || b.cpu - a.cpu;
      return b.cpu - a.cpu || b.memoryBytes - a.memoryBytes;
    });
  }, [snapshot, group, query, sort]);

  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <CpuIcon className="h-4 w-4 animate-pulse" strokeWidth={1.8} />
          Reading the process table…
        </p>
      </div>);

  }

  const memoryRatio = snapshot.memory.usedBytes / snapshot.memory.totalBytes;
  // The rail's bars compare groups against the busiest one, not against 100%,
  // so a quiet machine still shows where its work is going.
  const peak = groups.length > 1 ? Math.max(...groups.slice(1).map((entry) => entry.cpu), 1) : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!isNative &&
      <p className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-5 py-2 text-[11.5px] text-muted">
          <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
          Simulated numbers — run the desktop app to see the real process table and to end or re-prioritise anything
          on it.
        </p>
      }

      <div className="flex shrink-0 items-start gap-8 border-b border-line px-5 py-3.5">
        <Headline
          label="CPU"
          value={formatPercent(snapshot.cpuPercent, 0)}
          sub={`of ${snapshot.cores} cores`}
          ratio={snapshot.cpuPercent / 100}
          tone={snapshot.cpuPercent > 85 ? 'danger' : snapshot.cpuPercent > 60 ? 'warn' : undefined} />

        <Headline
          label="Memory"
          value={formatBytes(snapshot.memory.usedBytes)}
          sub={`of ${formatBytes(snapshot.memory.totalBytes)}`}
          ratio={memoryRatio}
          tone={memoryRatio > 0.85 ? 'danger' : memoryRatio > 0.7 ? 'warn' : undefined} />

        <Headline label="Running" value={formatCount(snapshot.processes.length)} sub="processes" />
      </div>

      {snapshotError &&
      <p className="shrink-0 border-b border-danger/30 bg-danger/5 px-5 py-2 text-[12px] text-danger">
          {snapshotError}
        </p>
      }

      <div className="flex min-h-0 flex-1">
        <aside className="w-[248px] shrink-0 overflow-y-auto border-r border-line scroll-slim">
          {groups.map((entry) => {
            const active = group === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setGroup(entry.id)}
                className={cn(
                  'block w-full border-b border-line/50 px-4 py-3 text-left transition-colors duration-150 ease-swift',
                  active ? 'bg-accent/10' : 'hover:bg-raised/60'
                )}>

                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn('truncate text-[12.5px] font-medium', active ? 'text-accent' : 'text-ink')}>
                    {entry.label}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                    {formatPercent(entry.cpu, 1)}
                  </span>
                </span>
                <span className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-faint">
                  <span>{formatCount(entry.count)} processes</span>
                  <span className="font-mono tabular-nums">{formatBytes(entry.memory)}</span>
                </span>
                {entry.id !== 'all' &&
                <span className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full bg-line">
                    <motion.span
                    className={cn('block h-full rounded-full', active ? 'bg-accent' : 'bg-muted/40')}
                    animate={{ width: `${Math.min(100, entry.cpu / peak * 100)}%` }}
                    transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }} />

                  </span>
                }
              </button>);

          })}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5">
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name, pid or command line"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint" />

            </div>
            <select
              aria-label="Sort processes"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="shrink-0 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] text-muted outline-none focus:border-accent/50">

              <option value="cpu">Busiest first</option>
              <option value="memory">Most memory</option>
              <option value="name">Name</option>
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
            <table className="w-full table-fixed">
              <thead className="sticky top-0 z-10 bg-canvas">
                <tr className="border-b border-line text-[10.5px] font-medium uppercase tracking-wide text-faint">
                  <th className="py-2 pl-5 pr-4 text-left">Process</th>
                  <th className="w-[132px] px-4 py-2 text-left">CPU %</th>
                  <th className="w-[104px] px-4 py-2 text-right">Memory</th>
                  <th className="w-[168px] px-4 py-2 text-left">Priority</th>
                  <th className="w-[92px] py-2 pl-4 pr-5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((process) => <ProcessRow key={process.pid} process={process} />)}
              </tbody>
            </table>

            {rows.length === 0 &&
            <p className="px-5 py-10 text-center text-[13px] text-faint">Nothing matches that filter.</p>
            }
          </div>
        </div>
      </div>
    </div>);

}
