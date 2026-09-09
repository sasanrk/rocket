import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PowerIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldIcon,
  TriangleAlertIcon,
  UndoDotIcon } from
'lucide-react';
import { toast } from 'sonner';
import { BRAND } from '../brand';
import type { DefenderInfo, DevCachePath, ProcessInfo } from '../types/system';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, formatPercent, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

/** Quotes a Windows path for PowerShell, where a single-quoted string is literal. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function CopyBlock({ command, label }: {command: string;label: string;}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mt-2">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-line bg-canvas p-2.5">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted">
          {command}
        </code>
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
      </div>
    </div>);

}

interface ExclusionRowProps {
  entry: DevCachePath;
  /** Path being applied right now, 'all' during a batch, or null when idle. */
  busy: string | null;
  onExclude: () => void;
  onRestore: () => void;
}

function ExclusionRow({ entry, busy, onExclude, onRestore }: ExclusionRowProps) {
  const working = busy === entry.path || busy === 'all';

  return (
    <li className="flex items-center justify-between gap-3 bg-raised/40 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-[12px] text-ink" title={entry.path}>
          {entry.label}
        </span>
        <span className="block truncate font-mono text-[10.5px] text-faint" title={entry.path}>
          {entry.path}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[10.5px] font-medium',
            entry.covered ? 'bg-accent/10 text-accent' : 'bg-node/10 text-node'
          )}>

          {entry.covered ? 'excluded' : 'scanned'}
        </span>

        <button
          type="button"
          disabled={busy !== null}
          onClick={entry.covered ? onRestore : onExclude}
          title={
          entry.covered ?
          'Put this folder back under real-time scanning' :
          'Stop Defender inspecting every file written here'
          }
          className={cn(
            'inline-flex w-[104px] items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors duration-150 ease-swift disabled:opacity-40',
            entry.covered ?
            'border-line text-muted hover:text-ink' :
            'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20'
          )}>

          {working ?
          <>
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
              Waiting
            </> :
          entry.covered ?
          <>
              <UndoDotIcon className="h-3.5 w-3.5" strokeWidth={2} />
              Undo
            </> :

          <>
              <ShieldCheckIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
              Exclude
            </>
          }
        </button>
      </span>
    </li>);

}

/**
 * What real-time scanning is costing this machine, and the one change that
 * actually fixes it.
 *
 * The interesting number is not Defender's own CPU — it barely reads anything
 * itself. It is that every file your tooling writes is inspected on the way to
 * disk, so an `npm install` into an unexcluded cache stalls the whole machine
 * on a four-core box. This panel names the folders that are still exposed, and
 * can act on them — Windows raises its own administrator prompt, which is where
 * the real consent happens.
 */
interface DefenderPanelProps {
  defender: DefenderInfo | null;
  engine: ProcessInfo | null;
  /** The live process table, so running programs can be offered for exclusion. */
  processes: ProcessInfo[];
  /** Called with fresh settings after a change, so the tab stays in step. */
  onChanged?: (next: DefenderInfo) => void;
}

/** One running program, collapsed across every pid it has open right now. */
interface RunningProgram {
  exe: string;
  label: string;
  pids: number;
  memoryBytes: number;
}

/**
 * Running programs worth offering for exclusion.
 *
 * Windows itself, Defender, and Reclaim are left out — excluding Windows does
 * nothing useful, and excluding the antivirus's own engine or this app would
 * be a strange thing for this panel to suggest.
 */
function collectRunningPrograms(processes: ProcessInfo[]): RunningProgram[] {
  const byExe = new Map<string, RunningProgram>();
  processes.forEach((process) => {
    if (process.protected || process.isSelf) return;
    if (process.group === 'system' || process.group === 'security') return;
    const exe = `${process.name}.exe`;
    const key = exe.toLowerCase();
    const existing = byExe.get(key);
    if (existing) {
      existing.pids += 1;
      existing.memoryBytes += process.memoryBytes;
      if (process.title && existing.label === existing.exe) existing.label = process.title;
    } else {
      byExe.set(key, { exe, label: process.title || exe, pids: 1, memoryBytes: process.memoryBytes });
    }
  });
  return [...byExe.values()].sort((a, b) => b.memoryBytes - a.memoryBytes);
}

export function DefenderPanel({ defender, engine, processes, onChanged }: DefenderPanelProps) {
  /** Path or process token currently being applied, or 'all' for a batch. */
  const [busy, setBusy] = useState<string | null>(null);
  const [processQuery, setProcessQuery] = useState('');
  /** True once "Turn off protection" has been clicked once, awaiting the second click. */
  const [confirmingRealtime, setConfirmingRealtime] = useState(false);

  const exposed = useMemo(
    () => (defender ? defender.devPaths.filter((entry) => !entry.covered) : []),
    [defender]
  );

  const excludedProcessSet = useMemo(
    () => new Set((defender?.exclusionProcess ?? []).map((name) => name.toLowerCase())),
    [defender]
  );

  const runningPrograms = useMemo(() => collectRunningPrograms(processes), [processes]);

  const programMatches = useMemo(() => {
    const needle = processQuery.trim().toLowerCase();
    return runningPrograms.
    filter((program) => !excludedProcessSet.has(program.exe.toLowerCase())).
    filter((program) => !needle || program.exe.toLowerCase().includes(needle) || program.label.toLowerCase().includes(needle));
  }, [runningPrograms, excludedProcessSet, processQuery]);

  async function apply(paths: string[], remove: boolean, token: string) {
    setBusy(token);
    const result = await desktop.setExclusions(paths, remove);
    setBusy(null);

    if (result.defender) onChanged?.(result.defender);

    if (result.ok) {
      const count = result.changed ?? paths.length;
      toast.success(
        remove ?
        `${pluralize(count, 'folder')} put back under scanning` :
        `${pluralize(count, 'folder')} excluded from scanning`,
        { description: remove ? undefined : 'Installs and builds there will stop being inspected file by file.' }
      );
    } else {
      toast.error(remove ? 'Could not remove the exclusion' : 'Could not add the exclusion', {
        description: result.message
      });
    }
  }

  async function applyProcess(name: string, remove: boolean) {
    const token = `proc:${name}`;
    setBusy(token);
    const result = await desktop.setProcessExclusions([name], remove);
    setBusy(null);

    if (result.defender) onChanged?.(result.defender);

    if (result.ok) {
      toast.success(remove ? `${name} put back under scanning` : `${name} excluded from scanning`, {
        description: remove ? undefined : 'Defender will stop inspecting this program, wherever it runs from.'
      });
    } else {
      toast.error(remove ? 'Could not remove the exclusion' : 'Could not add the exclusion', {
        description: result.message
      });
    }
  }

  async function handleRealtimeToggle(enabled: boolean) {
    setConfirmingRealtime(false);
    setBusy('realtime');
    const result = await desktop.setRealtimeProtection(enabled);
    setBusy(null);

    if (result.defender) onChanged?.(result.defender);

    if (result.ok) {
      toast.success(enabled ? 'Real-time protection is back on' : 'Real-time protection is off', {
        description: enabled ?
        undefined :
        'The whole machine is unprotected until you turn this back on — not just your build folders.'
      });
    } else {
      toast.error(enabled ? 'Could not turn protection back on' : 'Could not turn protection off', {
        description: result.message
      });
    }
  }

  if (!defender) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4">
        <p className="text-[12px] text-faint">Reading antivirus settings…</p>
      </section>);

  }

  if (!defender.available) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
          <ShieldIcon className="h-3.5 w-3.5" strokeWidth={2} />
          Antivirus
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          Microsoft Defender is not answering — another security product is probably in charge here. Whatever it is,
          the same advice applies: exclude the folders your build tools write to.
        </p>
      </section>);

  }

  const pathCommand = exposed.map((entry) => `Add-MpPreference -ExclusionPath ${quote(entry.path)}`).join('\n');

  return (
    <section className="rounded-xl border border-line bg-surface">
      <h2 className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
          <ShieldIcon className="h-3.5 w-3.5" strokeWidth={2} />
          Real-time scanning
        </span>
        <span className="flex items-center gap-3 text-[11px] text-muted">
          {engine &&
          <span className="font-mono tabular-nums">
              {formatPercent(engine.cpu, 1)} · {formatBytes(engine.memoryBytes)}
            </span>
          }
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[10.5px] font-medium',
              defender.realTimeProtection ? 'bg-accent/10 text-accent' : 'bg-raised text-faint'
            )}>

            {defender.realTimeProtection ? 'on' : 'off'}
          </span>
        </span>
      </h2>

      {busy !== null &&
      <p className="flex items-center gap-2 border-b border-line bg-accent/5 px-4 py-2 text-[11.5px] text-accent">
          <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.4} />
          Windows is asking for administrator permission — approve that prompt to apply the change, or dismiss it to
          leave everything as it is.
        </p>
      }

      <div className="p-4">
        {exposed.length === 0 ?
        <>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Every build folder {BRAND.name} knows to look for is already excluded. Installs and builds there are not
              being inspected file by file.
            </p>
            <ul className="mt-3 divide-y divide-line/60 overflow-hidden rounded-lg border border-line">
              {defender.devPaths.map((entry) =>
            <ExclusionRow
              key={entry.path}
              entry={entry}
              busy={busy}
              onExclude={() => void apply([entry.path], false, entry.path)}
              onRestore={() => void apply([entry.path], true, entry.path)} />

            )}
            </ul>
          </> :

        <>
            <p className="flex items-start gap-2 text-[13px] font-medium text-ink">
              <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-node" strokeWidth={2.2} />
              {pluralize(exposed.length, 'folder')} your tools write to constantly {exposed.length === 1 ? 'is' : 'are'}{' '}
              scanned on every write
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Defender itself reads almost nothing — it burns CPU inspecting what <em>other</em> programs write. An{' '}
              <span className="font-mono text-[11.5px]">npm install</span> drops tens of thousands of small files into
              these folders and each one is checked on the way to disk, which is what stalls a four-core machine.
            </p>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[12px] leading-relaxed text-faint">
                Excluding a folder means Defender stops checking files in it. These are caches your own tooling
                generates, so the trade is usually worth it — but it is your call.
              </p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void apply(exposed.map((entry) => entry.path), false, 'all')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-50">

                {busy === 'all' ?
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> :

                <ShieldCheckIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                }
                {busy === 'all' ? 'Waiting for permission…' : `Exclude all ${exposed.length}`}
              </button>
            </div>

            <ul className="mt-3 divide-y divide-line/60 overflow-hidden rounded-lg border border-line">
              {defender.devPaths.map((entry) =>
            <ExclusionRow
              key={entry.path}
              entry={entry}
              busy={busy}
              onExclude={() => void apply([entry.path], false, entry.path)}
              onRestore={() => void apply([entry.path], true, entry.path)} />

            )}
            </ul>

            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              Windows will ask for administrator permission — that prompt is the confirmation, and declining it
              changes nothing. Prefer to do it yourself? The same commands:
            </p>

            <CopyBlock label={`Exclude ${pluralize(exposed.length, 'folder')}`} command={pathCommand} />
          </>
        }

        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Running programs</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            Spare a specific program the same way — useful for something that opens thousands of small files itself,
            like a game launcher or a backup tool, rather than a folder your builds write to.
          </p>

          {defender.exclusionProcess.length > 0 &&
          <ul className="mt-3 divide-y divide-line/60 overflow-hidden rounded-lg border border-line">
              {defender.exclusionProcess.map((name) =>
            <li key={name} className="flex items-center justify-between gap-3 bg-raised/40 px-3 py-2">
                  <span className="truncate font-mono text-[12px] text-ink" title={name}>
                    {name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                      excluded
                    </span>
                    <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void applyProcess(name, true)}
                  className="inline-flex w-[104px] items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11.5px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink disabled:opacity-40">

                      {busy === `proc:${name}` ?
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> :

                  <UndoDotIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  }
                      Undo
                    </button>
                  </span>
                </li>
            )}
            </ul>
          }

          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
            <input
              value={processQuery}
              onChange={(event) => setProcessQuery(event.target.value)}
              placeholder="Filter running programs"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint" />

          </div>

          <ul className="mt-2 max-h-[220px] divide-y divide-line/60 overflow-y-auto scroll-slim rounded-lg border border-line">
            {programMatches.slice(0, 60).map((program) =>
          <li key={program.exe} className="flex items-center justify-between gap-3 bg-raised/40 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-ink" title={program.label}>
                    {program.label}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-faint">
                    {program.exe} · {pluralize(program.pids, 'process', 'processes')} · {formatBytes(program.memoryBytes)}
                  </span>
                </span>
                <button
              type="button"
              disabled={busy !== null}
              onClick={() => void applyProcess(program.exe, false)}
              className="inline-flex w-[104px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11.5px] font-medium text-accent transition-colors duration-150 ease-swift hover:bg-accent/20 disabled:opacity-40">

                  {busy === `proc:${program.exe}` ?
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> :

              <ShieldCheckIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
              }
                  Exclude
                </button>
              </li>
          )}
            {programMatches.length === 0 &&
          <li className="px-3 py-4 text-center text-[12px] text-faint">
                {processQuery ? 'Nothing running matches that.' : 'Nothing left to exclude — or nothing is running.'}
              </li>
          }
          </ul>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3 text-[11.5px] sm:grid-cols-3">
          <div>
            <dt className="text-faint">Scheduled scan CPU cap</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-ink">
              {defender.cpuLoadFactor === null ? '—' : `${defender.cpuLoadFactor}%`}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Scans only when idle</dt>
            <dd className={cn('mt-0.5', defender.onlyWhenIdle ? 'text-ink' : 'text-node')}>
              {defender.onlyWhenIdle === null ? '—' : defender.onlyWhenIdle ? 'yes' : 'no'}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Missed scan reruns at boot</dt>
            <dd className={cn('mt-0.5', defender.catchUpQuick || defender.catchUpFull ? 'text-node' : 'text-ink')}>
              {defender.catchUpQuick || defender.catchUpFull ? 'yes' : 'no'}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Scan running now</dt>
            <dd className={cn('mt-0.5', defender.scanInProgress ? 'text-node' : 'text-ink')}>
              {defender.scanInProgress ? 'yes' : 'no'}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Behaviour monitoring</dt>
            <dd className="mt-0.5 text-ink">{defender.behaviorMonitor ? 'on' : 'off'}</dd>
          </div>
          <div>
            <dt className="text-faint">Folders excluded</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-ink">{defender.exclusions.length}</dd>
          </div>
        </dl>

        {(defender.catchUpQuick || defender.catchUpFull) &&
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 rounded-lg border border-node/30 bg-node/5 px-3 py-2 text-[11.5px] leading-relaxed text-node">

            A scan missed while the machine was off will run as soon as you next boot — which is why the slowness can
            follow you through a restart. Turn that off with{' '}
            <span className="font-mono">Set-MpPreference -DisableCatchupQuickScan $true</span>.
          </motion.p>
        }

        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-danger">
            <PowerIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
            Real-time protection
          </p>

          {defender.tamperProtected ?
          <>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                Tamper Protection is on, which is exactly the setting that stops a program — this one included — from
                switching antivirus protection off on its own. Turn it off in Windows Security first if you want that
                control here.
              </p>
              <button
              type="button"
              onClick={() => void desktop.openWindowsSecurity()}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">

                <ExternalLinkIcon className="h-3.5 w-3.5" strokeWidth={2} />
                Open Windows Security
              </button>
            </> :
          defender.realTimeProtection === false ?
          <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[12.5px] leading-relaxed text-muted">
                Protection is off machine-wide, not just for build folders. Turn it back on when you are done with
                whatever needed it off.
              </p>
              <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleRealtimeToggle(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-50">

                {busy === 'realtime' ?
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> :

              <ShieldCheckIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
              }
                Turn back on
              </button>
            </div> :
          confirmingRealtime ?
          <div className="mt-2">
              <p className="text-[12.5px] font-medium leading-relaxed text-danger">
                This leaves the entire machine unprotected — every folder, not just your build caches — until you
                turn it back on. Prefer excluding specific folders or programs above if that is really all you need.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                type="button"
                onClick={() => setConfirmingRealtime(false)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

                  Cancel
                </button>
                <button
                type="button"
                disabled={busy !== null}
                onClick={() => void handleRealtimeToggle(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-50">

                  {busy === 'realtime' ?
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> :

                <PowerIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                }
                  Yes, turn it off
                </button>
              </div>
            </div> :

          <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[12.5px] leading-relaxed text-muted">
                Off limits to folder and program exclusions — this drops protection everywhere at once. Only worth it
                for something narrower fixes cannot reach.
              </p>
              <button
              type="button"
              onClick={() => setConfirmingRealtime(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-[12px] font-medium text-danger transition-colors duration-150 ease-swift hover:bg-danger/10">

                <PowerIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                Turn off protection
              </button>
            </div>
          }
        </div>
      </div>
    </section>);

}
