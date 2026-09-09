import { useEffect, useMemo, useState } from 'react';
import { PowerIcon, SearchIcon } from 'lucide-react';
import { useCpu } from '../contexts/CpuContext';
import type { StartupEntry } from '../types/system';
import { Toggle } from './Toggle';
import { pluralize } from '../utils/format';
import { cn } from '../utils/cn';

/** A friendlier name than the registry value: the executable, without the path. */
function programName(entry: StartupEntry): string {
  const match = entry.command.match(/([^\\/"]+)\.exe/i);
  return match ? match[1] : entry.name;
}

/**
 * Everything Windows launches at sign-in, the same list Task Manager shows,
 * with the same on/off switch. Nothing is uninstalled; a program turned off
 * here simply stops starting on its own.
 */
export function StartupView() {
  const { startup, startupBusy, toggleStartup, refreshStartup, watchLive, isNative } = useCpu();
  const [query, setQuery] = useState('');

  useEffect(() => watchLive(), [watchLive]);
  useEffect(() => {
    void refreshStartup();
  }, [refreshStartup]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...startup].
    filter((entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.command.toLowerCase().includes(needle)).
    sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  }, [startup, query]);

  const on = startup.filter((entry) => entry.enabled).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">Start with Windows</p>
          <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink">{on}</p>
          <p className="mt-1.5 text-[11.5px] text-muted">of {pluralize(startup.length, 'program')} registered</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3.5 sm:col-span-2">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">What turning one off means</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            The program stays installed and opens normally when you launch it. Windows just stops launching it at
            sign-in, which is what Task Manager does too. Entries marked <span className="font-medium text-ink">all users</span>{' '}
            apply to every account and need an administrator prompt to change.
          </p>
        </div>
      </div>

      <section className="mt-3 rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
            <PowerIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Programs
          </span>
          <div className="ml-auto flex w-64 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint" />

          </div>
        </div>

        <ul className="divide-y divide-line/60">
          {rows.map((entry) =>
          <li key={entry.id} className={cn('flex items-center justify-between gap-4 px-4 py-2.5', !entry.enabled && 'opacity-70')}>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">{programName(entry)}</span>
                  {programName(entry) !== entry.name &&
                <span className="truncate text-[11px] text-faint">{entry.name}</span>
                }
                  {entry.scope === 'machine' &&
                <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-medium text-faint" title="Set for every account on this machine; changing it needs an administrator prompt">
                      all users
                    </span>
                }
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-faint" title={entry.command}>
                  {entry.command}
                </span>
              </span>
              <Toggle
              on={entry.enabled}
              busy={startupBusy === entry.id}
              disabled={startupBusy !== null || !isNative}
              onChange={(next) => void toggleStartup(entry, next)} />

            </li>
          )}
          {rows.length === 0 &&
          <li className="px-4 py-8 text-center text-[12px] text-faint">
              {query ? 'Nothing matches that.' : 'Nothing starts with Windows on this account.'}
            </li>
          }
        </ul>
      </section>
      {!isNative && <p className="mt-3 text-[11.5px] text-faint">The browser preview shows a simulated list; changes need the desktop app.</p>}
    </div>);

}
