import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ActivityIcon,
  Trash2Icon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon } from
'lucide-react';
import { toast } from 'sonner';
import { BRAND } from '../brand';
import { useJunk } from '../contexts/JunkContext';
import { useMachine, useMachineWatch } from '../contexts/MachineContext';
import { useJobProgress } from '../hooks/useJobProgress';
import { Checkbox, type CheckState } from './Checkbox';
import { JunkDialog } from './JunkDialog';
import { Fog, ScanStrip } from './ScanDeck';
import { CATEGORY_LABELS, type JunkEntry, type JunkGroup } from '../types/junk';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, formatCount, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

function Stat({ label, value, sub, tone = 'ink' }: {label: string;value: string;sub?: string;tone?: 'ink' | 'accent';}) {
  return (
    <div className="min-w-[132px]">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={cn('mt-1 text-[19px] font-semibold leading-none tracking-tight', tone === 'accent' ? 'text-accent' : 'text-ink')}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11.5px] text-muted">{sub}</p>}
    </div>);

}

function selectable(entry: JunkEntry): boolean {
  return !entry.removed && !entry.pending && entry.bytes > 0;
}

function EntryRow({ entry, checked, onToggle }: {entry: JunkEntry;checked: boolean;onToggle: () => void;}) {
  const disabled = !selectable(entry);

  return (
    <li
      onClick={() => !disabled && onToggle()}
      className={cn(
        'flex items-center gap-3 border-b border-line/50 px-4 py-2 pl-11 transition-colors duration-150 ease-swift last:border-b-0',
        disabled ? 'cursor-default' : 'cursor-pointer hover:bg-raised/60',
        checked && 'bg-accent/5'
      )}>

      <Checkbox state={checked ? 'all' : 'none'} label={entry.label} onChange={onToggle} disabled={disabled} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-[12.5px]', entry.removed ? 'text-faint line-through' : 'text-ink')}>
            {entry.label}
          </span>
          <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-medium text-faint">
            {CATEGORY_LABELS[entry.category]}
          </span>
          {entry.safety === 'caution' && !entry.removed &&
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-node/10 px-1.5 py-0.5 text-[10px] font-medium text-node">
              <TriangleAlertIcon className="h-3 w-3" strokeWidth={2.4} />
              slow to rebuild
            </span>
          }
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted" title={entry.note}>
          {entry.removed ? 'Emptied' : entry.error ? entry.error : entry.note}
        </p>
        {entry.path &&
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void desktop.revealInExplorer(entry.path);
          }}
          className="mt-0.5 flex max-w-full items-center gap-1 truncate font-mono text-[10.5px] text-faint transition-colors duration-150 ease-swift hover:text-ink"
          title={`Show ${entry.path} in Explorer`}>

            <FolderOpenIcon className="h-3 w-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{entry.path}</span>
          </button>
        }
      </div>

      <div className="shrink-0 text-right">
        {entry.pending ?
        <span className="flex flex-col items-end gap-1"><Fog className="h-3 w-14" /><Fog className="h-2 w-9" /></span> :
        entry.removed ?
        <CheckCircle2Icon className="ml-auto h-4 w-4 text-accent" strokeWidth={2.2} /> :

        <>
            <p className={cn('font-mono text-[12px] tabular-nums', entry.error ? 'text-danger' : 'text-ink')}>
              {formatBytes(entry.bytes)}
            </p>
            <p className="text-[10.5px] text-faint">{formatCount(entry.files)} files</p>
          </>
        }
      </div>
    </li>);

}

function GroupBlock({ group, selected, open, onOpen, onToggleEntry, onToggleGroup }: {group: JunkGroup;selected: Set<string>;open: boolean;onOpen: (open: boolean) => void;onToggleEntry: (id: string) => void;onToggleGroup: () => void;}) {
  const choosable = group.entries.filter(selectable);
  const chosen = choosable.filter((entry) => selected.has(entry.id));
  const state: CheckState = chosen.length === 0 ? 'none' : chosen.length === choosable.length ? 'all' : 'some';
  const pending = group.entries.some((entry) => entry.pending);
  const allEmpty = group.entries.every((entry) => entry.removed);

  return (
    <section className="border-b border-line">
      <header
        onClick={() => onOpen(!open)}
        className="sticky top-0 z-10 flex cursor-pointer items-center gap-3 bg-surface px-4 py-2.5 transition-colors duration-150 ease-swift hover:bg-raised/60">

        <Checkbox state={state} label={group.label} onChange={onToggleGroup} disabled={choosable.length === 0} />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{group.label}</span>
          <span className="shrink-0 text-[11px] text-faint">
            {pluralize(group.entries.length, 'folder')}
            {chosen.length > 0 && <span className="text-accent"> · {chosen.length} selected</span>}
          </span>
          {group.running &&
          <span
            className="flex shrink-0 items-center gap-1 rounded-md bg-node/10 px-1.5 py-0.5 text-[10px] font-medium text-node"
            title="Files it holds open will stay behind. Close it first for a complete sweep.">

              <ActivityIcon className="h-3 w-3" strokeWidth={2.4} />
              running
            </span>
          }
          {allEmpty &&
          <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">emptied</span>
          }
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {pending && group.bytes === 0 ? '…' : formatBytes(group.bytes)}
          </span>
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.18 }} className="flex text-faint">
            <ChevronDownIcon className="h-3.5 w-3.5" strokeWidth={2} />
          </motion.span>
        </span>
      </header>

      <AnimatePresence initial={false}>
        {open &&
        <motion.ul
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="overflow-hidden">

            {group.entries.map((entry) =>
          <EntryRow key={entry.id} entry={entry} checked={selected.has(entry.id)} onToggle={() => onToggleEntry(entry.id)} />
          )}
          </motion.ul>
        }
      </AnimatePresence>
    </section>);

}

/**
 * Data other programs leave behind — Claude, VS Code, the browsers, package
 * managers, Windows itself — that they rebuild on demand. Found automatically,
 * measured in the background, emptied in a batch you can still call off.
 */
export function AppsTab() {
  useMachineWatch();
  const { isNative } = useMachine();
  const {
    groups,
    entries,
    phase,
    scanJobId,
    scanError,
    selected,
    selectedEntries,
    selectedBytes,
    totalBytes,
    freedThisSession,
    startScan,
    cancelScan,
    toggleEntry,
    toggleGroup,
    selectSafe,
    clearSelection
  } = useJunk();
  const progress = useJobProgress(scanJobId);
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  // Groups start collapsed: thirty programs is a list to skim, not to read.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups.
    map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) =>
        group.label.toLowerCase().includes(needle) ||
        entry.label.toLowerCase().includes(needle) ||
        entry.path.toLowerCase().includes(needle)
      )
    })).
    filter((group) => group.entries.length > 0);
  }, [groups, query]);

  const allOpen = visibleGroups.length > 0 && visibleGroups.every((group) => openGroups.has(group.app) || query.trim() !== '');

  function setAllOpen(open: boolean) {
    setOpenGroups(open ? new Set(visibleGroups.map((group) => group.app)) : new Set());
  }

  // The first visit scans on its own: there is no folder to choose here.
  useEffect(() => {
    if (phase === 'idle') startScan();
  }, [phase, startScan]);

  const measured = useMemo(() => entries.filter((entry) => !entry.pending).length, [entries]);
  const scanStartedAt = useMemo(() => (phase === 'scanning' ? Date.now() : undefined), [phase]);
  const cautionSelected = selectedEntries.filter((entry) => entry.safety === 'caution').length;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-6 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap gap-8">
          <Stat
            label="Can be emptied"
            value={formatBytes(totalBytes)}
            sub={phase === 'scanning' ? `${measured} of ${entries.length} folders measured` : `${pluralize(entries.length, 'folder')} across ${pluralize(groups.length, 'program')}`} />

          <Stat
            label="Selected"
            value={formatBytes(selectedBytes)}
            sub={pluralize(selectedEntries.length, 'folder')}
            tone={selectedBytes > 0 ? 'accent' : 'ink'} />

          {freedThisSession > 0 && <Stat label="Freed this session" value={formatBytes(freedThisSession)} />}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex w-56 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter programs or folders"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint" />

            {query &&
            <button type="button" onClick={() => setQuery('')} aria-label="Clear filter" className="text-faint hover:text-ink">
                <XIcon className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            }
          </div>
          <button
            type="button"
            disabled={visibleGroups.length === 0}
            onClick={() => setAllOpen(!allOpen)}
            title={allOpen ? 'Collapse every program' : 'Expand every program'}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink disabled:opacity-40">

            {allOpen ? <ChevronsDownUpIcon className="h-3.5 w-3.5" strokeWidth={2} /> : <ChevronsUpDownIcon className="h-3.5 w-3.5" strokeWidth={2} />}
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
          {phase === 'scanning' ?
          <button
            type="button"
            onClick={cancelScan}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:border-danger/40 hover:text-danger">

              <XIcon className="h-3.5 w-3.5" strokeWidth={2} />
              Stop
            </button> :

          <button
            type="button"
            onClick={startScan}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">

              <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={2} />
              Rescan
            </button>
          }
          {selected.size > 0 ?
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">

              Clear
            </button> :

          <button
            type="button"
            disabled={phase === 'scanning' || measured === 0}
            onClick={selectSafe}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink disabled:opacity-40">

              Select all safe
            </button>
          }
          <motion.button
            type="button"
            disabled={selectedEntries.length === 0}
            whileTap={{ scale: 0.985 }}
            onClick={() => setPendingIds(selectedEntries.map((entry) => entry.id))}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-40">

            <Trash2Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
            Empty {selectedEntries.length > 0 ? formatBytes(selectedBytes) : 'selected'}
          </motion.button>
        </div>
      </div>

      {phase === 'scanning' &&
      <ScanStrip
        label="Measuring app caches"
        progress={{ done: progress.done, total: progress.total, currentPath: progress.currentPath, startedAt: progress.startedAt ?? scanStartedAt }} />
      }

      {cautionSelected > 0 &&
      <p className="flex shrink-0 items-center gap-2 border-b border-node/30 bg-node/5 px-5 py-2 text-[11.5px] text-node">
          <TriangleAlertIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          {pluralize(cautionSelected, 'selected folder')} {cautionSelected === 1 ? 'is' : 'are'} slow to rebuild — package
          caches mean a long download on the next install, IDE indexes mean minutes of re-indexing.
        </p>
      }

      {scanError &&
      <p className="shrink-0 border-b border-danger/30 bg-danger/5 px-5 py-2 text-[11.5px] text-danger">{scanError}</p>
      }

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
        {groups.length === 0 && query.trim() === '' ?
        <div className="flex h-full items-center justify-center px-8">
            <p className="flex items-center gap-2 text-[13px] text-faint">
              {phase === 'scanning' ?
            <>
                  <Loader2Icon className="h-4 w-4 animate-spin" strokeWidth={2} />
                  Looking for app caches…
                </> :

            `Nothing to empty — every cache ${BRAND.name} knows about is already clean.`
            }
            </p>
          </div> :

        visibleGroups.map((group) =>
        <GroupBlock
          key={group.app}
          group={group}
          selected={selected}
          open={openGroups.has(group.app) || query.trim() !== ''}
          onOpen={(open) =>
          setOpenGroups((current) => {
            const next = new Set(current);
            if (open) next.add(group.app);else
            next.delete(group.app);
            return next;
          })
          }
          onToggleEntry={toggleEntry}
          onToggleGroup={() => toggleGroup(group.app)} />

        )
        }
        {groups.length > 0 && visibleGroups.length === 0 &&
        <p className="px-6 py-10 text-center text-[12.5px] text-faint">Nothing matches “{query}”.</p>
        }
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-5 py-2.5">
        <p className="text-[11.5px] leading-relaxed text-faint">
          Every folder here is a cache, log, crash report or temp file its program rebuilds on demand. Folders are
          emptied, never removed, and files an open program still holds are left where they are.
          {!isNative && ' The browser preview shows simulated folders.'}
        </p>
      </div>

      <AnimatePresence>
        {pendingIds &&
        <JunkDialog
          ids={pendingIds}
          onClose={() => setPendingIds(null)}
          onQueued={() => {
            toast('Cleanup queued', { description: 'You can still call it off from the task bar for a few seconds.' });
          }}
          onRefused={() => {
            toast.error('Nothing was accepted', {
              description: isNative ?
              `The folders no longer match what ${BRAND.name} finds on disk. Rescan and try again.` :
              'Emptying app caches needs the desktop app.'
            });
          }} />

        }
      </AnimatePresence>
    </main>);

}
