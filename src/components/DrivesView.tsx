import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  HardDriveIcon,
  LockIcon,
  RefreshCwIcon,
  Trash2Icon,
  UndoDotIcon,
  XIcon } from
'lucide-react';
import { toast } from 'sonner';
import { useMachine } from '../contexts/MachineContext';
import { Checkbox } from './Checkbox';
import { Fog, ScanStrip } from './ScanDeck';
import { useJobProgress } from '../hooks/useJobProgress';
import type { DriveFolder, DriveInfo } from '../types/drives';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, formatCount, formatDuration, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

function crumbs(dir: string): {label: string;path: string;}[] {
  const parts = dir.replace(/[\\/]+$/, '').split('\\');
  const list: {label: string;path: string;}[] = [];
  parts.forEach((part, index) => {
    const path = index === 0 ? `${part}\\` : `${parts.slice(0, index + 1).join('\\')}`;
    list.push({ label: index === 0 ? `${part}\\` : part, path });
  });
  return list;
}

/**
 * What is taking the space on each drive: the folders directly under a path,
 * biggest first, drill in by clicking. A tree is measured once, all the way
 * down; every folder opened after that is answered from memory, so moving
 * around costs nothing. Anything Windows or an installer owns is shown with
 * a lock; everything else can be deleted from here with the usual review
 * and grace window.
 */
export function DrivesView() {
  const { jobs, isNative } = useMachine();
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [dir, setDir] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loose, setLoose] = useState<{bytes: number;files: number;} | null>(null);
  const [measuredAt, setMeasuredAt] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentJob = useRef<string | null>(null);
  const currentDir = useRef<string | null>(null);
  currentJob.current = jobId;
  currentDir.current = dir;

  const job = useMemo(() => jobs.find((entry) => entry.id === jobId) ?? null, [jobs, jobId]);
  const scanning = Boolean(job && (job.status === 'running' || job.status === 'queued'));
  const progress = useJobProgress(jobId);

  useEffect(() => {
    desktop.
    drives().
    then((list) => {
      setDrives(list);
      if (list.length > 0) setDir((current) => current ?? list.find((drive) => !drive.system)?.root ?? list[0].root);
    }).
    catch(() => setDrives([]));
  }, []);

  useEffect(() => {
    return desktop.onJobEvent((message) => {
      if (message.event !== 'folders' || message.jobId !== currentJob.current) return;
      const { dir: scanned, items } = message.payload as {dir: string;items: DriveFolder[];};
      if (currentDir.current && scanned.toLowerCase().replace(/\\$/, '') !== currentDir.current.toLowerCase().replace(/\\$/, '')) return;
      setFolders((current) => {
        const byPath = new Map(current.map((folder) => [folder.path.toLowerCase(), folder]));
        items.forEach((folder) => byPath.set(folder.path.toLowerCase(), folder));
        return [...byPath.values()].sort((a, b) => b.bytes - a.bytes);
      });
    });
  }, []);

  useEffect(() => {
    if (!job) return;
    if (job.status === 'failed' && job.error) setError(job.error);
    if (job.status === 'done') setMeasuredAt(job.finishedAt ?? Date.now());
  }, [job]);

  /** Opens a folder: from memory when it has been measured, otherwise a job measures it. */
  const open = useCallback(async (target: string, force = false) => {
    if (currentJob.current) void desktop.cancelJob(currentJob.current);
    setJobId(null);
    setDir(target);
    setFolders([]);
    setLoose(null);
    setMeasuredAt(null);
    setSelected(new Set());
    setError(null);
    const started = await desktop.startDriveScan(target, force);
    if (!started) {
      setError(`Cannot read ${target}`);
      return;
    }
    if ('folders' in started) {
      setFolders(started.folders);
      setLoose({ bytes: started.looseBytes, files: started.looseFiles });
      setMeasuredAt(started.measuredAt);
      return;
    }
    setJobId(started.jobId);
  }, []);

  useEffect(() => {
    if (dir && jobId === null && folders.length === 0 && measuredAt === null && !error) void open(dir);
    // Only the first paint of a chosen drive; later opens go through `open` directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  const drive = drives.find((entry) => dir?.toUpperCase().startsWith(entry.root.toUpperCase())) ?? null;
  const measured = folders.reduce((sum, folder) => sum + folder.bytes, 0) + (loose?.bytes ?? 0);
  const selectedFolders = folders.filter((folder) => selected.has(folder.path));
  const selectedBytes = selectedFolders.reduce((sum, folder) => sum + folder.bytes, 0);
  const biggest = folders[0]?.bytes ?? 1;
  const age = measuredAt ? Date.now() - measuredAt : null;

  async function remove() {
    setConfirming(false);
    const id = await desktop.deleteFolders(selectedFolders);
    if (id) {
      toast('Deletion queued', { description: 'You can still call it off from the task bar for a few seconds.' });
      const gone = new Set(selectedFolders.map((folder) => folder.path.toLowerCase()));
      setFolders((current) => current.filter((folder) => !gone.has(folder.path.toLowerCase())));
      setSelected(new Set());
    } else {
      toast.error('Nothing was accepted', { description: isNative ? 'Measure the folder again and retry.' : 'Deleting needs the desktop app.' });
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        {drives.map((entry) => {
          const usedRatio = 1 - entry.freeBytes / entry.totalBytes;
          const active = dir?.toUpperCase().startsWith(entry.root.toUpperCase());
          return (
            <button
              key={entry.root}
              type="button"
              onClick={() => void open(entry.root)}
              className={cn(
                'flex min-w-[168px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-150 ease-swift',
                active ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface hover:border-faint'
              )}>

              <HardDriveIcon className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-faint')} strokeWidth={2} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12.5px] text-ink">{entry.root}{entry.system && <span className="ml-1 text-[10px] text-faint">Windows</span>}</span>
                  <span className="font-mono text-[10.5px] tabular-nums text-muted">{formatBytes(entry.freeBytes)} free</span>
                </span>
                <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-line">
                  <span className={cn('block h-full rounded-full', usedRatio > 0.9 ? 'bg-danger' : usedRatio > 0.8 ? 'bg-node' : 'bg-accent')} style={{ width: `${usedRatio * 100}%` }} />
                </span>
              </span>
            </button>);

        })}
        {drives.length === 0 && <span className="text-[12px] text-faint">Reading the drives…</span>}
      </div>

      {dir &&
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-5 py-2.5">
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[12.5px]">
            {crumbs(dir).map((crumb, index, list) =>
          <span key={crumb.path} className="flex shrink-0 items-center gap-1">
                {index > 0 && <ChevronRightIcon className="h-3.5 w-3.5 text-faint" strokeWidth={2} />}
                <button
              type="button"
              onClick={() => index < list.length - 1 && void open(crumb.path)}
              className={cn('rounded-md px-1.5 py-0.5 font-mono', index === list.length - 1 ? 'text-ink' : 'text-muted hover:bg-raised hover:text-ink')}>

                  {crumb.label}
                </button>
              </span>
          )}
          </nav>
          <span className="shrink-0 text-[11.5px] text-faint">
            {scanning ?
          `${pluralize(folders.length, 'folder')} so far` :
          `${pluralize(folders.length, 'folder')} · ${formatBytes(measured)}${age !== null ? ` · measured ${age < 60_000 ? 'just now' : `${formatDuration(age)} ago`}` : ''}`}
          </span>
          <button type="button" onClick={() => void desktop.revealInExplorer(dir)} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">
            <FolderOpenIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Explorer
          </button>
          <button
          type="button"
          onClick={() => scanning && jobId ? void desktop.cancelJob(jobId) : void open(dir, true)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink"
          title={scanning ? 'Stop measuring' : 'Walk this folder again from scratch'}>

            {scanning ? <XIcon className="h-3.5 w-3.5" strokeWidth={2} /> : <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={2} />}
            {scanning ? 'Stop' : 'Measure again'}
          </button>
          <button
          type="button"
          disabled={selectedFolders.length === 0 || !isNative}
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-40">

            <Trash2Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
            Delete {selectedFolders.length > 0 ? formatBytes(selectedBytes) : 'selected'}
          </button>
        </div>
      }

      {scanning &&
      <ScanStrip
        label={`Measuring ${dir ?? 'the drive'}`}
        progress={{ done: progress.done, total: progress.total, currentPath: progress.currentPath, startedAt: progress.startedAt }} />
      }

      {error && <p className="shrink-0 border-b border-danger/30 bg-danger/5 px-5 py-2 text-[11.5px] text-danger">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
        <ul>
          <AnimatePresence initial={false}>
            {folders.map((folder) =>
            <motion.li
              key={folder.path}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={cn('flex items-center gap-3 border-b border-line/50 px-5 py-2', selected.has(folder.path) && 'bg-accent/5')}>

                <Checkbox
                state={selected.has(folder.path) ? 'all' : 'none'}
                label={folder.name}
                disabled={folder.protected}
                onChange={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(folder.path)) next.delete(folder.path);else
                  next.add(folder.path);
                  return next;
                })
                } />

                <button
                type="button"
                onClick={() => void open(folder.path)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                title={`Open ${folder.path}`}>

                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-raised', folder.protected ? 'text-faint' : 'text-node')}>
                    {folder.protected ? <LockIcon className="h-3.5 w-3.5" strokeWidth={2} /> : <FolderIcon className="h-3.5 w-3.5" strokeWidth={2} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">{folder.name}</span>
                      {folder.protected && <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-medium text-faint">Windows owns this</span>}
                    </span>
                    <span className="mt-1 flex items-center gap-3">
                      <span className="h-1 w-full max-w-[320px] overflow-hidden rounded-full bg-line">
                        <motion.span className="block h-full rounded-full bg-accent/70" initial={{ width: 0 }} animate={{ width: `${Math.max(1, folder.bytes / biggest * 100)}%` }} transition={{ duration: 0.3 }} />
                      </span>
                      <span className="shrink-0 text-[10.5px] text-faint">{formatCount(folder.files)} files</span>
                    </span>
                  </span>
                  <span className="w-[88px] shrink-0 text-right font-mono text-[12.5px] tabular-nums text-ink">{formatBytes(folder.bytes)}</span>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} />
                </button>
              </motion.li>
            )}
          </AnimatePresence>
          {scanning &&
          [0, 1, 2].map((slot) =>
          <li key={`fog-${slot}`} className="flex items-center gap-3 border-b border-line/50 px-5 py-2.5" aria-hidden="true">
                <span className="h-[18px] w-[18px] rounded-[5px] border border-line" />
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-raised"><Fog className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1"><Fog className="block h-3 w-40" /><Fog className="mt-2 block h-1 w-64 max-w-[320px]" /></span>
                <Fog className="h-3 w-16" />
              </li>
          )
          }
          {loose && loose.files > 0 && !scanning &&
          <li className="flex items-center justify-between gap-3 px-5 py-2.5 text-[11.5px] text-faint">
              <span>{formatCount(loose.files)} loose file{loose.files === 1 ? '' : 's'} directly in this folder</span>
              <span className="font-mono tabular-nums">{formatBytes(loose.bytes)}</span>
            </li>
          }
          {folders.length === 0 && !scanning &&
          <li className="px-6 py-12 text-center text-[12.5px] text-faint">{dir ? 'No folders here.' : 'Pick a drive.'}</li>
          }
        </ul>
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-5 py-2.5">
        <p className="flex items-center gap-2 text-[11.5px] leading-relaxed text-faint">
          <UndoDotIcon className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
          A drive is measured once, all the way down; opening folders after that is instant. Deleting from here removes the
          folder and everything in it — it waits a few seconds so it can be called off. Folders Windows or an installer
          owns cannot be deleted from here.
          {!isNative && ' The browser preview cannot read drives.'}
        </p>
      </div>

      <AnimatePresence>
        {confirming &&
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
          onClick={() => setConfirming(false)}>

            <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-panel">

              <div className="border-b border-line px-6 py-4">
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">Delete {pluralize(selectedFolders.length, 'folder')}?</h2>
                <p className="mt-1 text-[12px] text-muted">Frees {formatBytes(selectedBytes)} on {drive?.root ?? 'this drive'}. These are not caches — whatever is inside is gone for good.</p>
              </div>
              <ul className="max-h-[240px] overflow-y-auto scroll-slim px-6 py-3">
                {selectedFolders.map((folder) =>
              <li key={folder.path} className="flex items-center justify-between gap-4 border-b border-line/60 py-2 last:border-b-0">
                    <span className="truncate font-mono text-[11.5px] text-ink" title={folder.path}>{folder.path}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{formatBytes(folder.bytes)}</span>
                  </li>
              )}
              </ul>
              <div className="border-t border-line px-6 py-4">
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-faint">
                  <UndoDotIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
                  Nothing is touched straight away — the deletion waits a few seconds in the task bar below, and you can call it off in that window.
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">Cancel</button>
                  <motion.button type="button" autoFocus whileTap={{ scale: 0.985 }} onClick={() => void remove()} className="rounded-lg bg-danger px-4 py-2 text-[13px] font-semibold text-white transition-opacity duration-150 ease-swift hover:opacity-90">
                    Delete {formatBytes(selectedBytes)}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        }
      </AnimatePresence>
    </main>);

}
