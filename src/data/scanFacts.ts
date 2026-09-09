/**
 * What the scan deck shows while a page is still counting: a shuffle of
 * things worth knowing about the section, the app, and the machine itself.
 * Live facts are built by each page from what it has found so far.
 */

export type FactSection = 'apps' | 'projects' | 'drives' | 'general';

export interface Fact {
  id: string;
  /** Short label above the card text, e.g. "Did you know". */
  kicker: string;
  title: string;
  body: string;
  /** `live` cards come from the scan itself; `progress` is the remaining-work card. */
  kind: 'fact' | 'live' | 'progress';
}

const APPS: Fact[] = [
  { id: 'apps-1', kicker: 'Did you know', title: 'Every Chromium app keeps the same five caches', body: 'Claude, VS Code, Discord, Slack and the browsers all keep a Cache, a Code Cache, a GPU shader cache, logs and crash reports under their profile. Rocket finds them by shape, so new apps are covered without a code change.', kind: 'fact' },
  { id: 'apps-2', kicker: 'Why it is safe', title: 'A cache is a copy, never the original', body: 'Everything here is something the app fetched, compiled or drew once and kept to save a moment next time. Empty it and the app just spends that moment again.', kind: 'fact' },
  { id: 'apps-3', kicker: 'Rule of the house', title: 'Folders are emptied, never removed', body: 'Some apps refuse to start if their cache folder is missing. Rocket takes what is inside and leaves the folder standing, exactly as the app saw it on first run.', kind: 'fact' },
  { id: 'apps-4', kicker: 'Did you know', title: 'Chrome keeps one cache per profile', body: 'Every person and every "Profile 7" you ever created has its own web cache and compiled-script cache. Twenty profiles can quietly hold gigabytes.', kind: 'fact' },
  { id: 'apps-5', kicker: 'Careful with', title: 'Package caches are worth the download', body: 'npm, Yarn, pip and Gradle caches are safe to empty, but the next install re-downloads every package. Those rows are marked slow to rebuild and are never ticked by Select all safe.', kind: 'fact' },
  { id: 'apps-6', kicker: 'Did you know', title: 'The Windows Temp folder is where installers go to die', body: 'Most installers unpack themselves into Temp and never tidy up. Anything still in use is skipped, so emptying it mid-install is harmless.', kind: 'fact' },
  { id: 'apps-7', kicker: 'Under the hood', title: 'Two guards before a single file goes', body: 'A path from the screen is re-discovered by the catalogue in the main process, then checked again by the worker that deletes. A path the catalogue would not find is refused.', kind: 'fact' },
  { id: 'apps-8', kicker: 'Did you know', title: 'GPU shader caches rebuild themselves', body: 'DirectX, NVIDIA and AMD keep compiled shaders per game and app. Empty them and the first launch of each takes a moment longer, then the cache is back.', kind: 'fact' },
]

const PROJECTS: Fact[] = [
  { id: 'proj-1', kicker: 'Did you know', title: 'A fresh Next.js app is about 40,000 files', body: 'Almost all of them are in node_modules, and every one is rebuilt by a single npm install. That is why it is the first thing Rocket looks for.', kind: 'fact' },
  { id: 'proj-2', kicker: 'How it works', title: 'The walk stops at the first package.json', body: 'Once a folder is a project, nothing below it is searched again, so a monorepo with fifty packages counts as one project and measures in one pass.', kind: 'fact' },
  { id: 'proj-3', kicker: 'Did you know', title: 'Sizes are measured, never estimated', body: 'Every folder is walked file by file before it is shown. It takes longer than a guess, and it is the number that actually comes back when you delete.', kind: 'fact' },
  { id: 'proj-4', kicker: 'Moving projects', title: 'A move carries the source and leaves the build', body: 'Move a project to another drive and node_modules, dist, .gradle and the rest stay behind and are deleted; git history, .env files and code travel intact. Run one install at the new place.', kind: 'fact' },
  { id: 'proj-5', kicker: 'Did you know', title: 'Gradle keeps a cache inside every Android project', body: '.gradle and .cxx folders next to your app can outweigh the app itself. Both are rebuilt on the next sync; the NDK one is slow, so it is marked caution.', kind: 'fact' },
  { id: 'proj-6', kicker: 'Under the hood', title: 'Deleting is guarded by a name list', body: 'Only folders whose last name is on the rebuildable list — node_modules, dist, .next, .gradle and friends — can be deleted, and only three levels deep or more. Your source folder is refused by design.', kind: 'fact' },
  { id: 'proj-7', kicker: 'Did you know', title: 'Whole drives are walked six levels deep', body: 'Projects live further down a drive than a chosen folder, so a drive scan goes deeper and skips Windows, Program Files and app data on the way.', kind: 'fact' },
]

const DRIVES: Fact[] = [
  { id: 'drv-1', kicker: 'Did you know', title: 'SSDs slow down below about 10% free', body: 'The controller needs empty blocks to write into. Under 10% free it starts shuffling data before every write, and Windows itself needs room to page and to update.', kind: 'fact' },
  { id: 'drv-2', kicker: 'How it works', title: 'Each folder is measured whole, biggest first', body: 'The view walks every file under each folder so the number is real. Click a folder to measure its children the same way.', kind: 'fact' },
  { id: 'drv-3', kicker: 'Rule of the house', title: 'Windows folders are shown, never offered', body: 'Windows, Program Files, ProgramData, AppData and the profile root itself are locked. Everything else on a drive is yours to look at and, if you decide, delete.', kind: 'fact' },
  { id: 'drv-4', kicker: 'Did you know', title: 'Downloads is usually the forgotten giant', body: 'Installers, ISOs and archives you opened once tend to stay there for years. It is the first folder worth a look on a full drive.', kind: 'fact' },
  { id: 'drv-5', kicker: 'Did you know', title: 'A package store can hold more than your projects', body: 'pnpm and Yarn keep one global store so projects can share packages. That store grows with every version you ever installed.', kind: 'fact' },
]

const GENERAL: Fact[] = [
  { id: 'gen-1', kicker: 'Rule of the house', title: 'Every deletion waits a few seconds', body: 'Nothing is touched straight away. The job sits in the task bar with an undo button; once it starts it can still be stopped at the next checkpoint.', kind: 'fact' },
  { id: 'gen-2', kicker: 'Did you know', title: 'Scans run in their own process', body: 'The window never waits on a walk. Switch pages, start something else, or close to the tray — the count carries on and the result lands when it is done.', kind: 'fact' },
  { id: 'gen-3', kicker: 'Did you know', title: 'Windows keeps the clock at 5% between keystrokes', body: 'On the Balanced plan the CPU idles at a twentieth of its speed and takes a moment to ramp up. The CPU & power page changes that.', kind: 'fact' },
  { id: 'gen-4', kicker: 'Did you know', title: 'Real-time antivirus inspects every file a build writes', body: 'An npm install drops tens of thousands of files, each checked on the way to disk. Excluding your build caches is the single largest speed-up on a four-core machine.', kind: 'fact' },
  { id: 'gen-5', kicker: 'Under the hood', title: 'History remembers what each cleanup bought back', body: 'Every scan, deletion, move and uninstall is logged with what went and what was locked. The History page is the receipt.', kind: 'fact' },
]

const LIBRARY: Record<FactSection, Fact[]> = { apps: APPS, projects: PROJECTS, drives: DRIVES, general: GENERAL };

/** A section's facts with a few general ones mixed in, in a stable shuffled order per session. */
export function factsFor(section: FactSection): Fact[] {
  const own = LIBRARY[section] ?? [];
  const general = LIBRARY.general;
  const mixed: Fact[] = [];
  const longer = Math.max(own.length, general.length);
  for (let index = 0; index < longer; index += 1) {
    if (own[index]) mixed.push(own[index]);
    if (index % 2 === 1 && general[index >> 1]) mixed.push(general[index >> 1]);
  }
  return mixed;
}

/** How much of a count is left, said the way a person would. */
export function remainingPhrase(done: number, total: number, startedAt: number | undefined, unit = 'folder'): {headline: string;detail: string;ratio: number;} {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const left = Math.max(0, total - done);
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  const rate = elapsed > 1500 && done > 0 ? done / (elapsed / 1000) : 0;
  const etaSeconds = rate > 0 ? left / rate : null;

  const eta =
  etaSeconds === null ? null :
  etaSeconds < 8 ? 'a few seconds' :
  etaSeconds < 60 ? `about ${Math.max(10, Math.round(etaSeconds / 10) * 10)} seconds` :
  etaSeconds < 3600 ? `about ${Math.max(1, Math.round(etaSeconds / 60))} minute${Math.round(etaSeconds / 60) === 1 ? '' : 's'}` :
  'a while yet';

  if (total === 0) {
    return { headline: 'Looking for things to count', detail: 'The list fills in as soon as the first folders are found.', ratio: 0 };
  }
  if (left === 0) {
    return { headline: 'Every last one is counted', detail: 'Finishing up.', ratio: 1 };
  }
  const percent = Math.round(ratio * 100);
  if (left <= 3) {
    return { headline: `${left} ${unit}${left === 1 ? '' : 's'} to go`, detail: 'The last ones are usually the biggest — they take a moment.', ratio };
  }
  if (percent < 15) {
    return { headline: `${percent}% counted, ${left} ${unit}s ahead`, detail: eta ? `Should take ${eta}. The number on the left only goes up from here.` : 'Getting a feel for how big this is.', ratio };
  }
  if (percent < 60) {
    return { headline: `${percent}% done · ${left} ${unit}s left`, detail: eta ? `${eta.charAt(0).toUpperCase()}${eta.slice(1)} to go at this pace.` : 'Counting steadily.', ratio };
  }
  return { headline: `${left} ${unit}s still counting`, detail: eta ? `${percent}% there — ${eta} more. The big folders always come last.` : `${percent}% there.`, ratio };
}
