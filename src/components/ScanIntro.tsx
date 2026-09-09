import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, FolderSearchIcon, HistoryIcon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import { BRAND } from '../brand';
import { desktop } from '../utils/desktopBridge';
import { readPref } from '../utils/prefs';
import { cn } from '../utils/cn';

const WATCHED = ['node_modules', '.next', 'dist', 'build', 'app/build', '.gradle', '.turbo', '.cxx', 'coverage'];

export function ScanIntro() {
  const { pickFolder, startScan } = useCleaner();
  const [isDragging, setDragging] = useState(false);
  // The folder this machine last scanned, remembered locally, is offered
  // until the main process has a scan history of its own to hand back.
  const [recent, setRecent] = useState<string[]>(() => {
    const last = readPref('lastRoot');
    return last ? [last] : [];
  });

  useEffect(() => {
    let live = true;
    desktop.
    recentFolders().
    then((folders) => {
      if (live && folders.length > 0) setRecent(folders);
    }).
    catch(() => {

      /* an app that has never scanned simply has no history */});
    return () => {live = false;};
  }, []);

  function handleDrop(files: FileList) {
    const dropped = files.item(0);
    const resolved = dropped && desktop.pathForFile ? desktop.pathForFile(dropped) : '';
    // A browser drop carries no real path, so fall back to the picker.
    if (resolved) startScan(resolved);else
    pickFolder();
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-8 py-12 scroll-slim">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-2xl">
        
        <h2 className="text-[32px] font-semibold leading-tight tracking-tight text-ink">
          Get back the space your projects are sitting on.
        </h2>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
          Point {BRAND.name} at the folder where you keep your code. It measures every project, ranks them by how much
          you can free right now, and deletes only what your tooling can rebuild.
        </p>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            handleDrop(event.dataTransfer.files);
          }}
          className={cn(
            'mt-8 rounded-xl border border-dashed p-8 text-center transition-colors duration-200 ease-swift',
            isDragging ? 'border-accent bg-accent/5' : 'border-line bg-surface'
          )}>
          
          <motion.span
            animate={{ y: isDragging ? -4 : 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-raised text-accent">
            
            <FolderSearchIcon className="h-5 w-5" strokeWidth={1.9} />
          </motion.span>
          <p className="mt-4 text-[14px] font-medium text-ink">Drop a projects folder here</p>
          <p className="mt-1 text-[13px] text-faint">or browse for one — nothing is deleted without your review</p>
          <motion.button
            type="button"
            onClick={pickFolder}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90">
            
            Choose folder
            <ArrowRightIcon className="h-4 w-4" strokeWidth={2.2} />
          </motion.button>
        </div>

        <div className="mt-8 grid grid-cols-[1fr_auto] items-start gap-8 border-t border-line pt-6">
          <div>
            <p className="text-[12px] font-medium text-muted">What {BRAND.name} looks for</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {WATCHED.map((folder) =>
              <li
                key={folder}
                className="rounded-md border border-line bg-raised px-2 py-1 font-mono text-[11px] text-muted">
                
                  {folder}
                </li>
              )}
            </ul>
          </div>
          {recent.length > 0 &&
          <div className="min-w-[220px]">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                <HistoryIcon className="h-3.5 w-3.5 text-faint" strokeWidth={2} />
                Recent
              </p>
              <ul className="mt-3 space-y-1">
                {recent.map((path) =>
              <li key={path}>
                    <button
                  type="button"
                  onClick={() => startScan(path)}
                  className="w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11px] text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
                  
                      {path}
                    </button>
                  </li>
              )}
              </ul>
            </div>
          }
        </div>
      </motion.div>
    </div>);

}