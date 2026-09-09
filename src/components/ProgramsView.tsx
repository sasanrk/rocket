import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownUpIcon,
  CheckCircle2Icon,
  FolderOpenIcon,
  Loader2Icon,
  PackageIcon,
  PackageMinusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldAlertIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UndoDotIcon,
  XIcon } from
'lucide-react';
import { toast } from 'sonner';
import { useMachine } from '../contexts/MachineContext';
import { Checkbox, type CheckState } from './Checkbox';
import { initials, tileHue, type InstalledProgram, type Leftover, type ProgramFilter, type ProgramSort } from '../types/programs';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, formatCount, pluralize } from '../utils/format';
import { cn } from '../utils/cn';
import { usePref } from '../utils/prefs';

const LARGE_BYTES = 500 * 1024 * 1024;
const RECENT_DAYS = 30;

const FILTERS: {id: ProgramFilter;label: string;}[] = [
{ id: 'all', label: 'All' },
{ id: 'desktop', label: 'Desktop' },
{ id: 'store', label: 'Store' },
{ id: 'large', label: 'Over 500 MB' },
{ id: 'recent', label: 'Installed recently' },
{ id: 'broken', label: 'No uninstaller' }];


const SORTS: {id: ProgramSort;label: string;}[] = [
{ id: 'size', label: 'Biggest first' },
{ id: 'name', label: 'Name' },
{ id: 'date', label: 'Newest first' },
{ id: 'publisher', label: 'Publisher' }];


function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Tile({ name }: {name: string;}) {
  const hue = tileHue(name);
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold"
      style={{ background: `hsl(${hue} 45% 22% / 0.9)`, color: `hsl(${hue} 80% 78%)` }}>

      {initials(name)}
    </span>);

}

type RowStatus = 'idle' | 'running' | 'removed' | 'failed';

interface Outcome {
  status: RowStatus;
  message?: string;
  canForce?: boolean;
  leftovers?: Leftover[];
}

interface UninstallDialogProps {
  programs: InstalledProgram[];
  onClose: () => void;
  onConfirm: (quiet: boolean) => void;
}

function UninstallDialog({ programs, onClose, onConfirm }: UninstallDialogProps) {
  const [quiet, setQuiet] = useState(true);
  const dependencies = programs.filter((program) => program.dependency);
  const machineWide = programs.filter((program) => program.scope === 'machine').length;
  const totalBytes = programs.reduce((sum, program) => sum + program.sizeBytes, 0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      onClick={onClose}>

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm uninstall"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-panel">

        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Uninstall {pluralize(programs.length, 'program')}?
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              {totalBytes > 0 ? `About ${formatBytes(totalBytes)} on disk. ` : ''}Each program runs its own uninstaller, one after
              another.
            </p>
          </div>
          <button type="button" aria-label="Cancel" onClick={onClose} className="rounded-md p-1.5 text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
            <XIcon className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <ul className="max-h-[240px] overflow-y-auto scroll-slim px-6 py-3">
          {programs.map((program) =>
          <li key={program.id} className="flex items-center justify-between gap-4 border-b border-line/60 py-2 last:border-b-0">
              <span className="flex min-w-0 items-center gap-2.5">
                <Tile name={program.name} />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-ink">{program.name}</span>
                  <span className="block truncate text-[10.5px] text-faint">{program.publisher || program.kind}</span>
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{program.sizeBytes > 0 ? formatBytes(program.sizeBytes) : '—'}</span>
            </li>
          )}
        </ul>

        <div className="border-t border-line px-6 py-4">
          {dependencies.length > 0 &&
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger">
              <ShieldAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              {dependencies.map((program) => program.name).join(', ')} {dependencies.length === 1 ? 'is' : 'are'} a runtime or
              driver other software may depend on. Programs that need it will stop working until it is reinstalled.
            </p>
          }
          <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-muted">
            <Checkbox state={quiet ? 'all' : 'none'} label="Quiet where possible" onChange={() => setQuiet((current) => !current)} className="mt-0.5" />
            <span>
              <span className="font-medium text-ink">Quiet where possible.</span> Uses the silent uninstall command when a
              program registered one, so fewer wizards to click through. Programs without one open their own window
              either way.
            </span>
          </label>
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-faint">
            <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-node" strokeWidth={2} />
            <span>
              {machineWide > 0 ? 'Windows will ask for administrator permission once per program. ' : ''}Uninstalling starts
              straight away — there is no undo window, because the program's own uninstaller does the work. Anything it
              leaves behind is offered afterwards, and that step does have one.
            </span>
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
              Cancel
            </button>
            <motion.button
              type="button"
              autoFocus
              whileTap={{ scale: 0.985 }}
              onClick={() => onConfirm(quiet)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-[13px] font-semibold text-white transition-opacity duration-150 ease-swift hover:opacity-90">

              <PackageMinusIcon className="h-4 w-4" strokeWidth={2.2} />
              Uninstall {programs.length > 1 ? programs.length : ''}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>);

}

/** What an uninstalled program left behind, ticked for deletion. */
function LeftoverCard({ program, leftovers, onDone }: {program: InstalledProgram;leftovers: Leftover[];onDone: () => void;}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(leftovers.map((entry) => entry.path)));
  const [busy, setBusy] = useState(false);
  const selected = leftovers.filter((entry) => chosen.has(entry.path));
  const bytes = selected.reduce((sum, entry) => sum + entry.bytes, 0);

  async function remove() {
    setBusy(true);
    const jobId = await desktop.deleteLeftovers(program.id, program.name, selected);
    setBusy(false);
    if (jobId) {
      toast('Leftover cleanup queued', { description: 'You can still call it off from the task bar for a few seconds.' });
      onDone();
    } else {
      toast.error('Nothing was accepted', { description: 'The folders no longer match what was found. Uninstall again to re-check.' });
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-xl border border-node/30 bg-node/5">

      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">
            {program.name} left {pluralize(leftovers.length, 'folder')} behind
            <span className="text-muted"> · {formatBytes(leftovers.reduce((sum, entry) => sum + entry.bytes, 0))}</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Settings, caches and data the uninstaller did not touch. Deleting them is what a fresh reinstall would want;
            keep any you would rather carry over.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onDone} className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">
            Keep all
          </button>
          <button
            type="button"
            disabled={busy || selected.length === 0}
            onClick={() => void remove()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-50">

            {busy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> : <Trash2Icon className="h-3.5 w-3.5" strokeWidth={2.2} />}
            Delete {formatBytes(bytes)}
          </button>
        </div>
      </header>
      <ul className="divide-y divide-line/60 border-t border-node/20">
        {leftovers.map((entry) =>
        <li
          key={entry.path}
          onClick={() =>
          setChosen((current) => {
            const next = new Set(current);
            if (next.has(entry.path)) next.delete(entry.path);else
            next.add(entry.path);
            return next;
          })
          }
          className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-raised/40">

            <Checkbox
            state={chosen.has(entry.path) ? 'all' : 'none'}
            label={entry.path}
            onChange={() =>
            setChosen((current) => {
              const next = new Set(current);
              if (next.has(entry.path)) next.delete(entry.path);else
              next.add(entry.path);
              return next;
            })
            } />

            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[11.5px] text-ink" title={entry.path}>{entry.path}</span>
              <span className="block text-[10.5px] text-faint">{entry.reason} · {formatCount(entry.files)} files</span>
            </span>
            <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted">{formatBytes(entry.bytes)}</span>
          </li>
        )}
      </ul>
    </motion.section>);

}

function ProgramRow({ program, checked, outcome, busy, onToggle, onUninstall, onForce }: {program: InstalledProgram;checked: boolean;outcome?: Outcome;busy: boolean;onToggle: () => void;onUninstall: () => void;onForce: () => void;}) {
  const [open, setOpen] = useState(false);
  const status = outcome?.status ?? 'idle';
  const gone = status === 'removed';

  return (
    <li className={cn('border-b border-line/50 transition-colors duration-150 ease-swift', checked && 'bg-accent/5', gone && 'opacity-60')}>
      <div
        onClick={() => !gone && setOpen((current) => !current)}
        className={cn('flex items-center gap-3 px-4 py-2.5', !gone && 'cursor-pointer hover:bg-raised/50')}>

        <Checkbox state={checked ? 'all' : 'none'} label={program.name} onChange={onToggle} disabled={gone || status === 'running'} />
        <Tile name={program.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-[13px] font-medium', gone ? 'text-faint line-through' : 'text-ink')}>{program.name}</span>
            {program.kind === 'store' && <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-medium text-faint">Store</span>}
            {program.scope === 'machine' && program.kind === 'desktop' &&
            <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-medium text-faint" title="Installed for every account; uninstalling needs an administrator prompt">all users</span>
            }
            {program.dependency &&
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-node/10 px-1.5 py-0.5 text-[10px] font-medium text-node" title="Other software or hardware may depend on this">
                <ShieldAlertIcon className="h-3 w-3" strokeWidth={2.4} />
                dependency
              </span>
            }
            {!program.hasUninstaller &&
            <span className="shrink-0 rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger">no uninstaller</span>
            }
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted">
            {program.publisher || 'Unknown publisher'}
            {program.version && <span className="text-faint"> · {program.version}</span>}
            {outcome?.message && <span className={cn(' · ', status === 'failed' ? 'text-danger' : 'text-muted')}>{outcome.message}</span>}
          </p>
        </div>
        <span className="hidden w-[104px] shrink-0 text-right text-[11.5px] text-muted lg:block">{formatDate(program.installDate)}</span>
        <span className="w-[84px] shrink-0 text-right font-mono text-[12px] tabular-nums text-ink">
          {program.sizeBytes > 0 ? formatBytes(program.sizeBytes) : <span className="text-faint">—</span>}
        </span>
        <span className="flex w-[112px] shrink-0 justify-end">
          {status === 'running' ?
          <span className="flex items-center gap-1.5 text-[11.5px] text-accent">
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
              Uninstalling
            </span> :
          gone ?
          <span className="flex items-center gap-1.5 text-[11.5px] text-accent">
              <CheckCircle2Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              Removed
            </span> :
          status === 'failed' && outcome?.canForce ?
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onForce();
            }}
            className="rounded-md border border-danger/40 px-2 py-1 text-[11.5px] font-medium text-danger transition-colors duration-150 ease-swift hover:bg-danger/10 disabled:opacity-40">

              Force remove
            </button> :

          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              if (program.hasUninstaller) onUninstall();else
              onForce();
            }}
            className="rounded-md border border-line px-2 py-1 text-[11.5px] font-medium text-muted transition-colors duration-150 ease-swift hover:border-danger/40 hover:text-danger disabled:opacity-40">

              {program.hasUninstaller ? 'Uninstall' : 'Force remove'}
            </button>
          }
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open && !gone &&
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden">

            <dl className="grid gap-x-6 gap-y-1.5 border-t border-line/40 bg-raised/30 px-4 py-3 pl-[76px] text-[11.5px] sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-faint">Install folder</dt>
                <dd className="mt-0.5 truncate font-mono text-muted" title={program.installLocation || undefined}>
                  {program.installLocation ?
                <button type="button" onClick={() => void desktop.revealInExplorer(program.installLocation)} className="inline-flex max-w-full items-center gap-1 truncate hover:text-ink">
                      <FolderOpenIcon className="h-3 w-3 shrink-0" strokeWidth={2} />
                      <span className="truncate">{program.installLocation}</span>
                    </button> :
                '—'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-faint">{program.kind === 'store' ? 'Package' : 'Registry entry'}</dt>
                <dd className="mt-0.5 truncate font-mono text-muted" title={program.keyPath || program.keyName}>{program.keyPath || program.keyName}</dd>
              </div>
              <div>
                <dt className="text-faint">Uninstaller</dt>
                <dd className="mt-0.5 text-muted">
                  {program.kind === 'store' ? 'Windows Store' : program.isMsi ? 'Windows Installer (msiexec)' : program.hasUninstaller ? "The program's own" : 'None registered — only force removal is possible'}
                </dd>
              </div>
              <div>
                <dt className="text-faint">Force removal</dt>
                <dd className="mt-0.5 text-muted">
                  Takes the entry off this list without running anything, then offers its folders as leftovers.{' '}
                  <button type="button" onClick={onForce} disabled={busy} className="font-medium text-danger hover:underline disabled:opacity-40">
                    Force remove
                  </button>
                </dd>
              </div>
            </dl>
          </motion.div>
        }
      </AnimatePresence>
    </li>);

}

/**
 * Add/Remove Programs done properly: sizes for everything, search and
 * filters that answer "what is big and unused", batch uninstall, a leftover
 * sweep after each one, and force removal for entries whose uninstaller is
 * gone.
 */
export function ProgramsView() {
  const { isNative } = useMachine();
  const [programs, setPrograms] = useState<InstalledProgram[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = usePref('programFilter');
  const [sort, setSort] = usePref('programSort');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [pending, setPending] = useState<InstalledProgram[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [leftoverCards, setLeftoverCards] = useState<{program: InstalledProgram;leftovers: Leftover[];}[]>([]);
  const measured = useRef(new Set<string>());

  const load = useCallback(async (refresh = false) => {
    try {
      const list = await desktop.programs(refresh);
      setPrograms(list);
      setError(null);
      // Sizes the registry did not record are measured from the install folder.
      const unsized = list.filter((program) => program.sizeBytes === 0 && program.installLocation && !measured.current.has(program.id));
      if (unsized.length > 0) {
        unsized.forEach((program) => measured.current.add(program.id));
        const sizes = await desktop.programSizes(unsized.map((program) => program.id));
        setPrograms((current) =>
        current ? current.map((program) => sizes[program.id] !== undefined ? { ...program, sizeBytes: sizes[program.id], sizeMeasured: true } : program) : current
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!programs) return [];
    const needle = query.trim().toLowerCase();
    const cutoff = Date.now() - RECENT_DAYS * 24 * 3600 * 1000;
    const list = programs.filter((program) => {
      if (needle && !`${program.name} ${program.publisher}`.toLowerCase().includes(needle)) return false;
      switch (filter) {
        case 'desktop':
          return program.kind === 'desktop';
        case 'store':
          return program.kind === 'store';
        case 'large':
          return program.sizeBytes >= LARGE_BYTES;
        case 'recent':
          return Boolean(program.installDate) && new Date(program.installDate as string).getTime() >= cutoff;
        case 'broken':
          return !program.hasUninstaller;
        default:
          return true;
      }
    });
    list.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'publisher':
          return (a.publisher || 'zz').localeCompare(b.publisher || 'zz') || a.name.localeCompare(b.name);
        case 'date':
          return (b.installDate ?? '').localeCompare(a.installDate ?? '') || a.name.localeCompare(b.name);
        default:
          return b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name);
      }
    });
    return list;
  }, [programs, query, filter, sort]);

  const selectedPrograms = useMemo(
    () => (programs ?? []).filter((program) => selected.has(program.id) && outcomes[program.id]?.status !== 'removed'),
    [programs, selected, outcomes]
  );
  const totalBytes = useMemo(() => (programs ?? []).reduce((sum, program) => sum + program.sizeBytes, 0), [programs]);
  const storeCount = useMemo(() => (programs ?? []).filter((program) => program.kind === 'store').length, [programs]);
  const brokenCount = useMemo(() => (programs ?? []).filter((program) => !program.hasUninstaller).length, [programs]);

  const visibleSelectable = rows.filter((row) => outcomes[row.id]?.status !== 'removed');
  const allState: CheckState =
  visibleSelectable.length === 0 || visibleSelectable.every((row) => !selected.has(row.id)) ?
  'none' :
  visibleSelectable.every((row) => selected.has(row.id)) ?
  'all' :
  'some';

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allState === 'all') visibleSelectable.forEach((row) => next.delete(row.id));else
      visibleSelectable.forEach((row) => next.add(row.id));
      return next;
    });
  }

  function setOutcome(id: string, outcome: Outcome) {
    setOutcomes((current) => ({ ...current, [id]: outcome }));
  }

  async function runUninstalls(list: InstalledProgram[], quiet: boolean) {
    setPending(null);
    setBusy(true);
    for (const program of list) {
      setOutcome(program.id, { status: 'running', message: program.scope === 'machine' ? 'Approve the administrator prompt; the uninstaller may open its own window' : 'The uninstaller may open its own window' });
      const result = await desktop.uninstallProgram(program.id, quiet);
      if (result.ok && result.removed) {
        setOutcome(program.id, { status: 'removed' });
        setSelected((current) => {
          const next = new Set(current);
          next.delete(program.id);
          return next;
        });
        toast.success(`${program.name} uninstalled`, {
          description: result.leftovers && result.leftovers.length > 0 ? `${pluralize(result.leftovers.length, 'leftover folder')} found` : 'Nothing left behind'
        });
        if (result.leftovers && result.leftovers.length > 0) {
          setLeftoverCards((current) => [{ program, leftovers: result.leftovers as Leftover[] }, ...current]);
        }
      } else {
        setOutcome(program.id, { status: 'failed', message: result.message ?? 'Still listed', canForce: result.canForce ?? !result.ok });
        toast.error(`${program.name} was not removed`, { description: result.message });
      }
    }
    setBusy(false);
    void load(true);
  }

  async function forceRemove(program: InstalledProgram) {
    setBusy(true);
    setOutcome(program.id, { status: 'running', message: program.scope === 'machine' ? 'Approve the administrator prompt' : undefined });
    const result = await desktop.forceRemoveProgram(program.id);
    setBusy(false);
    if (result.ok) {
      setOutcome(program.id, { status: 'removed' });
      toast.success(`${program.name} removed from the list`, {
        description: result.leftovers && result.leftovers.length > 0 ? `${pluralize(result.leftovers.length, 'folder')} of its files found` : 'No files found'
      });
      if (result.leftovers && result.leftovers.length > 0) {
        setLeftoverCards((current) => [{ program, leftovers: result.leftovers as Leftover[] }, ...current]);
      }
      void load(true);
    } else {
      setOutcome(program.id, { status: 'failed', message: result.message, canForce: true });
      toast.error(`Could not remove ${program.name}`, { description: result.message });
    }
  }

  if (!programs) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Loader2Icon className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          {error ? error : 'Reading the installed programs…'}
        </p>
      </div>);

  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap gap-8">
          <div className="min-w-[120px]">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Installed</p>
            <p className="mt-1 text-[19px] font-semibold leading-none tracking-tight text-ink">{programs.length}</p>
            <p className="mt-1 text-[11.5px] text-muted">{storeCount} from the Store{brokenCount > 0 ? ` · ${brokenCount} without an uninstaller` : ''}</p>
          </div>
          <div className="min-w-[120px]">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">On disk</p>
            <p className="mt-1 text-[19px] font-semibold leading-none tracking-tight text-ink">{formatBytes(totalBytes)}</p>
            <p className="mt-1 text-[11.5px] text-muted">where a size is known</p>
          </div>
          {selectedPrograms.length > 0 &&
          <div className="min-w-[120px]">
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Selected</p>
              <p className="mt-1 text-[19px] font-semibold leading-none tracking-tight text-accent">{selectedPrograms.length}</p>
              <p className="mt-1 text-[11.5px] text-muted">{formatBytes(selectedPrograms.reduce((sum, program) => sum + program.sizeBytes, 0))}</p>
            </div>
          }
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex w-60 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search programs or publishers"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint" />

            {query &&
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-faint hover:text-ink">
                <XIcon className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            }
          </div>
          <label className="flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1.5 text-[12px] text-muted">
            <ArrowDownUpIcon className="h-3.5 w-3.5 text-faint" strokeWidth={2} />
            <select value={sort} onChange={(event) => setSort(event.target.value as ProgramSort)} className="bg-transparent text-[12px] text-ink outline-none">
              {SORTS.map((option) =>
              <option key={option.id} value={option.id} className="bg-surface text-ink">{option.label}</option>
              )}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load(true)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink disabled:opacity-40">

            <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Refresh
          </button>
          <motion.button
            type="button"
            disabled={selectedPrograms.length === 0 || busy || !isNative}
            whileTap={{ scale: 0.985 }}
            onClick={() => setPending(selectedPrograms)}
            className="flex items-center gap-1.5 rounded-lg bg-danger px-3.5 py-1.5 text-[12px] font-semibold text-white transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-40">

            <PackageMinusIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
            Uninstall {selectedPrograms.length > 0 ? selectedPrograms.length : 'selected'}
          </motion.button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-5 py-2">
        {FILTERS.map((option) =>
        <button
          key={option.id}
          type="button"
          onClick={() => setFilter(option.id)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150 ease-swift',
            filter === option.id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-raised hover:text-ink'
          )}>

            {option.label}
          </button>
        )}
        <span className="ml-auto text-[11px] text-faint">{pluralize(rows.length, 'program')}</span>
      </div>

      <AnimatePresence initial={false}>
        {leftoverCards.length > 0 &&
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="shrink-0 space-y-3 overflow-hidden border-b border-line px-5 py-3">

            {leftoverCards.map((card) =>
          <LeftoverCard
            key={card.program.id}
            program={card.program}
            leftovers={card.leftovers}
            onDone={() => setLeftoverCards((current) => current.filter((entry) => entry.program.id !== card.program.id))} />

          )}
          </motion.div>
        }
      </AnimatePresence>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-canvas px-4 py-2 text-[10.5px] font-medium uppercase tracking-wide text-faint">
          <Checkbox state={allState} label="Select all shown" onChange={toggleAll} disabled={visibleSelectable.length === 0} />
          <span className="w-8" />
          <span className="flex-1">Program</span>
          <span className="hidden w-[104px] text-right lg:block">Installed</span>
          <span className="w-[84px] text-right">Size</span>
          <span className="w-[112px]" />
        </div>
        <ul>
          {rows.map((program) =>
          <ProgramRow
            key={program.id}
            program={program}
            checked={selected.has(program.id)}
            outcome={outcomes[program.id]}
            busy={busy || !isNative}
            onToggle={() =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(program.id)) next.delete(program.id);else
              next.add(program.id);
              return next;
            })
            }
            onUninstall={() => setPending([program])}
            onForce={() => void forceRemove(program)} />

          )}
          {rows.length === 0 &&
          <li className="px-6 py-12 text-center text-[12.5px] text-faint">
              <PackageIcon className="mx-auto mb-2 h-5 w-5" strokeWidth={1.8} />
              {query ? `Nothing matches “${query}”.` : 'Nothing in this group.'}
            </li>
          }
        </ul>
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-5 py-2.5">
        <p className="flex items-center gap-2 text-[11.5px] leading-relaxed text-faint">
          <UndoDotIcon className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
          Every program is removed by its own uninstaller — the same thing Windows Settings would run. Force removal only
          takes an entry off the list; its files are offered afterwards, with the usual few seconds to change your mind.
          {!isNative && ' The browser preview shows a simulated list; uninstalling needs the desktop app.'}
        </p>
      </div>

      <AnimatePresence>
        {pending &&
        <UninstallDialog programs={pending} onClose={() => setPending(null)} onConfirm={(quiet) => void runUninstalls(pending, quiet)} />
        }
      </AnimatePresence>
    </main>);

}
