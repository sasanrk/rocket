import { useEffect, useMemo, useState } from 'react';
import {
  CircleSlashIcon,
  FolderSearchIcon,
  ArrowRightLeftIcon,
  HistoryIcon,
  PackageMinusIcon,
  Trash2Icon,
  TriangleAlertIcon } from
'lucide-react';
import { useMachine } from '../contexts/MachineContext';
import type { HistoryEntry } from '../types/system';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, formatDuration, formatTime, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

function Stat({ label, value, sub }: {label: string;value: string;sub?: string;}) {
  return (
    <div className="min-w-[132px]">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 text-[19px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-1 text-[11.5px] text-muted">{sub}</p>}
    </div>);

}

function EntryButton({ entry, active, onSelect }: {entry: HistoryEntry;active: boolean;onSelect: () => void;}) {
  const isClean = entry.type === 'clean';
  const isUninstall = entry.type === 'uninstall';
  const isMove = entry.type === 'move';
  const failures = entry.failures ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 border-b border-line/50 px-4 py-3 text-left transition-colors duration-150 ease-swift',
        active ? 'bg-accent/10' : 'hover:bg-raised/60'
      )}>

      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
          isClean ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line bg-raised text-muted'
        )}>

        {isMove ?
        <ArrowRightLeftIcon className="h-3.5 w-3.5" strokeWidth={2} /> :
        isUninstall ?
        <PackageMinusIcon className="h-3.5 w-3.5" strokeWidth={2} /> :
        isClean ?
        <Trash2Icon className="h-3.5 w-3.5" strokeWidth={2} /> :

        <FolderSearchIcon className="h-3.5 w-3.5" strokeWidth={2} />
        }
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[13px] font-medium', active ? 'text-accent' : 'text-ink')}>
            {isMove ? `${(entry.root ?? '').split('\\').filter(Boolean).pop() ?? 'Project'} moved` : isUninstall ? `${entry.program ?? 'A program'} uninstalled` : isClean ? `${formatBytes(entry.bytes ?? 0)} freed` : `${pluralize(entry.projects ?? 0, 'project')} scanned`}
          </span>
          <span className="shrink-0 text-[11px] text-faint">{formatTime(entry.at)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="truncate">
            {isMove ?
            `${formatBytes(entry.moved ?? 0)} moved · ${formatBytes(entry.bytes ?? 0)} freed` :
            isUninstall ?
            `${entry.forced ? 'removed from the list' : 'its own uninstaller'}${entry.publisher ? ` · ${entry.publisher}` : ''}` :
            isClean ?
            `${pluralize(entry.folders ?? 0, 'folder')}${entry.scope === 'apps' ? ' · app caches' : entry.scope === 'leftovers' ? ' · leftovers' : entry.scope === 'drive' ? ' · from a drive' : ''}` :
            `${formatBytes(entry.reclaimable ?? 0)} reclaimable`}
          </span>
          {entry.cancelled &&
          <span className="flex shrink-0 items-center gap-1 text-faint">
              <CircleSlashIcon className="h-3 w-3" strokeWidth={2} />
              stopped
            </span>
          }
          {failures > 0 &&
          <span className="flex shrink-0 items-center gap-1 text-danger">
              <TriangleAlertIcon className="h-3 w-3" strokeWidth={2} />
              {failures}
            </span>
          }
        </span>
      </span>
    </button>);

}

function EntryDetail({ entry }: {entry: HistoryEntry;}) {
  const isClean = entry.type === 'clean';
  const isUninstall = entry.type === 'uninstall';
  const isMove = entry.type === 'move';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-6 py-4">
        <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">
          {isMove ? 'Move' : isUninstall ? 'Uninstall' : isClean ? entry.scope === 'apps' ? 'App cache cleanup' : entry.scope === 'leftovers' ? 'Leftover cleanup' : entry.scope === 'drive' ? 'Drive cleanup' : 'Cleanup' : 'Scan'} · {formatTime(entry.at)}
        </p>
        <div className="mt-3 flex flex-wrap gap-8">
          {isMove ?
          <>
              <Stat label="Moved" value={formatBytes(entry.moved ?? 0)} sub={entry.destination ? `to ${entry.destination}` : undefined} />
              <Stat label="Freed" value={formatBytes(entry.bytes ?? 0)} sub="build output left behind" />
            </> :
          isUninstall ?
          <>
              <Stat label="Program" value={entry.program ?? '—'} sub={entry.publisher || undefined} />
              <Stat label="Size when listed" value={formatBytes(entry.bytes ?? 0)} />
              <Stat label="How" value={entry.forced ? 'Forced' : 'Uninstaller'} />
            </> :
          isClean ?
          <>
              <Stat label="Freed" value={formatBytes(entry.bytes ?? 0)} />
              <Stat
              label="Folders"
              value={String(entry.folders ?? 0)}
              sub={`of ${entry.attempted ?? 0} attempted`} />

              <Stat label="Locked" value={String(entry.failures ?? 0)} />
            </> :

          <>
              <Stat label="Projects" value={String(entry.projects ?? 0)} />
              <Stat label="Reclaimable" value={formatBytes(entry.reclaimable ?? 0)} />
            </>
          }
          {!isUninstall && <Stat label="Took" value={formatDuration(entry.durationMs ?? 0)} />}
        </div>
        {entry.root &&
        <p className="mt-3 truncate font-mono text-[11.5px] text-faint" title={entry.root}>
            {entry.root}
          </p>
        }
      </div>

      {entry.items.length > 0 ?
      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
          <table className="w-full">
            <thead className="sticky top-0 bg-canvas">
              <tr className="border-b border-line text-[10.5px] font-medium uppercase tracking-wide text-faint">
                <th className="py-2 pl-6 pr-4 text-left">Folder</th>
                <th className="w-[120px] py-2 pl-4 pr-6 text-right">Freed</th>
              </tr>
            </thead>
            <tbody>
              {entry.items.map((item) =>
            <tr key={item.path} className="border-b border-line/50">
                  <td className="py-2 pl-6 pr-4">
                    <button
                  type="button"
                  onClick={() => void desktop.revealInExplorer(item.path)}
                  className="block w-full truncate text-left font-mono text-[11.5px] text-muted transition-colors duration-150 ease-swift hover:text-ink"
                  title={item.error ? `${item.path} — ${item.error}` : `Show ${item.path} in Explorer`}>

                      {item.path}
                    </button>
                    {item.error && <p className="mt-0.5 text-[11px] text-danger">{item.error}</p>}
                  </td>
                  <td
                className={cn(
                  'w-[120px] py-2 pl-4 pr-6 text-right font-mono text-[11.5px] tabular-nums',
                  item.ok ? 'text-muted' : 'text-danger'
                )}>

                    {item.ok ? formatBytes(item.bytes) : entry.scope === 'apps' ? 'partly' : 'locked'}
                  </td>
                </tr>
            )}
              {entry.itemsTruncated ?
            <tr>
                  <td colSpan={2} className="py-2 pl-6 pr-6 text-[11px] text-faint">
                    and {pluralize(entry.itemsTruncated, 'more folder')} not listed
                  </td>
                </tr> :
            null}
            </tbody>
          </table>
        </div> :

      <div className="flex flex-1 items-center justify-center px-8">
          <p className="max-w-sm text-center text-[12.5px] leading-relaxed text-faint">
            {isMove ?
            'The project was copied with robocopy, measured to match, and only then removed from where it was.' :
            isUninstall ?
            'The program ran its own uninstaller; anything it left behind was offered separately and shows up here as a leftover cleanup.' :
            'A scan does not change anything, so there is nothing to list here — the numbers above are the whole record.'}
          </p>
        </div>
      }
    </div>);

}

export function HistoryTab() {
  const { history, historyTotals, refreshHistory, clearHistory } = useMachine();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const selected = useMemo(
    () => history.find((entry) => entry.id === selectedId) ?? history[0] ?? null,
    [history, selectedId]
  );

  if (history.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="max-w-sm text-center">
          <HistoryIcon className="mx-auto h-6 w-6 text-faint" strokeWidth={1.8} />
          <p className="mt-3 text-[14px] font-medium text-ink">Nothing here yet</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Every scan and every deletion gets logged here — what went, how much it bought back, and what was locked
            at the time.
          </p>
        </div>
      </div>);

  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-6 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap gap-8">
          <Stat
            label="Reclaimed, all time"
            value={formatBytes(historyTotals?.bytes ?? 0)}
            sub={`${pluralize(historyTotals?.folders ?? 0, 'folder')} deleted`} />

          <Stat
            label="Cleanups"
            value={String(historyTotals?.cleanups ?? 0)}
            sub={`${pluralize(historyTotals?.entries ?? 0, 'entry', 'entries')} logged`} />

        </div>
        <button
          type="button"
          onClick={() => void clearHistory()}
          className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-muted transition-colors duration-150 ease-swift hover:border-danger/40 hover:text-danger">

          Clear log
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-line scroll-slim">
          {history.map((entry) =>
          <EntryButton
            key={entry.id}
            entry={entry}
            active={selected?.id === entry.id}
            onSelect={() => setSelectedId(entry.id)} />

          )}
        </aside>

        {selected && <EntryDetail entry={selected} />}
      </div>
    </div>);

}
