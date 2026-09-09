# Rocket

**Free the space. Unleash the CPU.** A tune-up kit for Windows PCs and laptops: it finds the
gigabytes your projects and apps are sitting on, empties what they can rebuild, and makes the
processor run at the speed it was sold at.

The window has no native frame — Windows draws only its minimise / maximise / close buttons
over a plain strip, with no title text. It is a sidebar with three sections — *Free up space*, *Speed up*, *Keep watch* — plus an
Overview page that shows one live number for each and a way in. (The code base is still called
`reclaim` internally; the product name lives in `src/brand.ts` and `electron/main.cjs`.)

Pages:

| Tab             | What it does                                                                              |
| --------------- | ----------------------------------------------------------------------------------------- |
| **Drives**      | What is taking the space on each drive, folder by folder, biggest first — drill in, reveal, delete what is yours |
| **Project folders** *(for developers)* | Scans every drive for projects on its own, plus any folder you include; deletes `node_modules`, `.next`, `dist`, `build`, `.gradle`, `.cxx`… or moves a whole project to another drive without its build output |
| **App junk**    | Finds the caches, logs, crash reports and temp files every installed program leaves behind — Claude, VS Code, the browsers, npm, Windows itself — and empties the ones you pick |
| **Installed programs** | Add/Remove done properly: every program with its real size, search and filters, batch uninstall through each program's own uninstaller, a leftover sweep afterwards, and force removal for broken entries |
| **Processes**   | Live process table grouped by what it is, with per-process priority and an end button       |
| **Performance** | CPU, memory, drives, and the handful of things actually worth acting on right now |
| **CPU & power** | Makes the processor run at the speed it was sold at: power plan, turbo, core parking — with one-click restore |
| **Startup programs** | Task Manager's startup list with the same on/off switch |
| **Background services** | SysMain and Windows Search, reversible |
| **Antivirus**   | Which build folders real-time scanning still inspects, and the exclusions to fix it |
| **This PC**     | Everything in the box — board, CPU socket, memory slots and sticks, GPUs, disks — and the upgrade paths worked out from it: the strongest CPU the socket takes, how much RAM the board accepts and which sticks to swap, whether NVMe is an option |
| **History**     | Every scan and deletion this machine has done, and what each one bought back                |

Everything it removes is something your tooling puts back: `npm install`, a Gradle sync, your
next build, or the app itself the next time it opens.

## Run it

```bash
npm install
```

```bash
npm start
```

Or open `reclaim.code-workspace` in VS Code and pick a task (Ctrl+Shift+B runs the default), or
double-click `run.bat` for a menu. Every command below is available all three ways.

| Command | What it does |
| --- | --- |
| `npm start` | Vite + Electron with hot reload |
| `npm start -- --scan D:\Dev` | Same, but opens straight into a scan |
| `npm run dev` | Browser-only preview on simulated data |
| `npm run dist` | Builds `release/Rocket-Setup-1.2.0.exe` |
| `npm run check` | Typecheck, then lint |
| `npm run selftest` | Sandbox tests for the scanner, deletion and job engine |
| `npm run doctor` | Diagnoses why this machine is slow right now |
| `npm run stop` | Kills stray Vite / Electron / Reclaim processes |
| `npm run menu` | The interactive menu |

`npm run dev` gives you the browser-only version, which runs on simulated data — the filesystem
and the process table are only reachable from Electron.

The packaged app takes the same `--scan` flag: `Reclaim.exe --scan D:\Dev`, which is what you
want on a desktop shortcut.

The six folders you scanned most recently are remembered in `%APPDATA%\Reclaim\recent.json`
and offered on the start screen; entries whose folder no longer exists are dropped on read.

Closing the window sends the app to the notification area so a running scan keeps going. Quit
from the tray menu to actually end it.

## Package a Windows installer

```bash
npm run dist
```

Output lands in `release/Rocket-Setup-1.2.0.exe` (NSIS, per-user install, unsigned).

### Keeping it small

The renderer's whole runtime — React, framer-motion, lucide-react, sonner — is bundled by Vite
into `dist/` (well under 1 MB) and needs nothing from `node_modules` at runtime; the main
process uses only Node/Electron builtins. Because of that, every one of those packages lives in
`devDependencies`, not `dependencies`, and `build.files` in `package.json` excludes
`node_modules` explicitly. Electron-builder's default behaviour is to bundle
`node_modules/<pkg>` for anything listed under `dependencies` — get that classification wrong
and the packaged `app.asar` silently grows from ~550 KB to 40+ MB with code that was already
sitting, unused, right next to the bundle that actually ships. **If you add a package the
renderer imports, it belongs in `devDependencies`, full stop** — only main-process code that
`require()`s a third-party package at runtime would ever justify `dependencies`, and nothing in
this app currently does.

`build.electronLanguages` keeps only `en-US` and `fa` out of Chromium's ~55 locale packs
(41 MB → 1.4 MB), and `build.compression: "maximum"` squeezes the NSIS installer harder. The
rest of the unpacked size — `Reclaim.exe` itself, `icudtl.dat`, the ANGLE/SwiftShader graphics
DLLs, `ffmpeg.dll` — is the Chromium/Electron runtime and isn't something app config can prune;
the GPU fallback libraries in particular matter more, not less, on the older/weaker hardware
this app targets, so they're left alone.

## Layout

| Path                         | What it is                                                      |
| ---------------------------- | --------------------------------------------------------------- |
| `src/`                       | The React renderer — no Node access, talks over the bridge only  |
| `src/brand.ts`               | The product name, tagline and positioning line — rename it here      |
| `src/components/Sidebar.tsx` | The left rail: three sections, badges, theme toggle               |
| `src/components/HomeView.tsx`| The Overview page: what the app is, one live number per section    |
| `src/contexts/`              | Machine, cleaner, app-junk and CPU state shared across pages       |
| `src/utils/desktopBridge.ts` | The one seam between UI and machine, plus the browser simulation |
| `src/utils/prefs.ts`         | What the app remembers between runs, kept in one localStorage key |
| `electron/main.cjs`          | Window, IPC handlers, job wiring                                  |
| `electron/preload.cjs`       | `contextBridge` surface exposed as `window.reclaim`               |
| `electron/scanner.cjs`       | Project discovery, measurement, and guarded deletion              |
| `electron/appJunk.cjs`       | The app-cache catalogue: discovery, the allow-list guard, emptying |
| `electron/jobs.cjs`          | Background job queue: grace window, pause, cancel, throttle        |
| `electron/system.cjs`        | Process table, priorities, Defender, disks                        |
| `electron/agent.ps1`         | Long-lived PowerShell helper the system module talks JSON to      |
| `electron/history.cjs`       | The append-only log behind the History tab                        |

`contextIsolation` is on and `nodeIntegration` is off — the renderer never touches Node.

## Work runs in the background

Scans and cleanups are **jobs**, not blocking calls. `startScan` and `startClean` return a job
id straight away; progress, discovered projects and per-folder results arrive on broadcast
channels afterwards. Closing a panel or switching tabs never stops anything, and the task dock
along the bottom of the window shows what is running.

| Renderer call (`desktopBridge.ts`) | IPC channel             | Main process                                  |
| ---------------------------------- | ----------------------- | --------------------------------------------- |
| `startScan(root)`                  | `reclaim:startScan`     | Queues a scan job, returns its id              |
| `startClean(targets, graceMs)`     | `reclaim:startClean`    | Queues a deletion behind a grace window        |
| `startAppScan()`                   | `reclaim:startAppScan`  | Queues a scan of app caches; entries stream on `junk` events |
| `startAppClean(targets, graceMs)`  | `reclaim:startAppClean` | Re-checks every path against the catalogue, then queues the emptying |
| `cpuInfo()` / `cpuLive()`          | `reclaim:cpuInfo`       | Processor, power plan values, clock and load    |
| `applyCpuTweaks(ids)`              | `reclaim:applyCpuTweaks`| One elevated batch of `powercfg` changes; originals saved first |
| `restoreCpu()`                     | `reclaim:restoreCpu`    | Puts back exactly what the backup recorded     |
| `startupList()` / `setStartup()`   | `reclaim:startupList`   | Task Manager's Startup tab, readable and writable |
| `setService(name, enabled)`        | `reclaim:setService`    | SysMain and Windows Search only                |
| `cancelJob(id)`                    | `reclaim:jobCancel`     | Undo inside the window; stop at a checkpoint after |
| `pauseJob(id, paused)`             | `reclaim:jobPause`      | Holds the job at its next batch boundary       |
| `throttle(level)`                  | `reclaim:throttle`      | Gentle / balanced / fast, applied mid-job      |
| `systemSnapshot()`                 | `reclaim:systemSnapshot`| One reading of CPU, memory, disks, processes   |
| `killProcess(pid)`                 | `reclaim:killProcess`   | Refuses protected processes and Reclaim itself |
| `setProcessPriority(pid, class)`   | `reclaim:setPriority`   | Idle → High; realtime is deliberately absent   |
| `history()` / `historyTotals()`    | `reclaim:history`       | Reads `%APPDATA%\Reclaim\history.json`          |
| `chooseFolder()`                   | `reclaim:chooseFolder`  | Native directory picker                        |
| `recentFolders()`                  | `reclaim:recentFolders` | Reads `recent.json`, dropping dead folders     |
| `initialRoot()`                    | `reclaim:initialRoot`   | The `--scan` folder, validated                 |
| `revealInExplorer(path)`           | `reclaim:reveal`        | `shell.showItemInFolder`                       |

### The grace window

Confirming a deletion does not delete anything. The job is created in a `grace` state with a
`graceEndsAt` timestamp, and the task dock counts it down. Cancelling in that window means the
work function never ran — no folder was touched. Cancelling after it means the job stops at its
next checkpoint and keeps whatever it already finished; the History tab records exactly that.

Default window: 6 seconds (`DEFAULT_GRACE_MS` in `main.cjs`).

## What the scanner does

The Project folders page scans every fixed drive the moment it opens — six levels deep from a
drive root, five from a folder you include — stopping as soon as it identifies a project and
skipping `node_modules`, `.git`, build output and Windows' own folders on the way down. Included
folders are remembered between runs. One chip per drive or folder filters the list.

### Moving a project to another drive

Pick a project, **Move to another drive…**, choose where. `electron/mover.cjs` measures what
would travel (everything except build output: `node_modules`, `dist`, `build`, `.next`,
`.gradle`, `target`, `venv`… at every depth) and what stays, checks the destination has room,
then copies with `robocopy /E /MT:16 /XD …` — the fastest thing Windows has for tens of
thousands of small files, long paths included — reporting bytes as each file lands. The
destination is measured and must match file-for-file before the original is deleted, build
output and all, which is where the freed space comes from. On the same drive it is a rename.
Git history, `.env` files and everything else travel untouched; run your install once at the
new location.

### The Drives page

`electron/drives.cjs` measures the folders directly under a path, streaming each size as it
lands, biggest first. Click a folder to look inside it. Folders Windows, installers or the user
profile own (`Windows`, `Program Files`, `ProgramData`, `Users
ame`, `AppData`, `$Recycle.Bin`
and so on) show a lock and can never be deleted from here; anything else can, behind the same
review and grace window as every other deletion, and only if the view itself reported it.

- **Node / React** — any folder with a `package.json`. Framework is read from its dependencies
  (Next.js, React Native, Remix, Astro, Nuxt, Angular, CRA, Vite…). Targets: `node_modules`,
  `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `dist`, `build`, `out`, `coverage`, and the
  `android/` and `ios/` folders a React Native project carries.
- **Android / Gradle** — any folder with `build.gradle[.kts]`, `settings.gradle[.kts]` or
  `gradlew`. Targets: `build`, `.gradle`, `.cxx`, `.kotlin`, `captures`, and the same for every
  module beside it.

Sizes are measured, never estimated, and a folder nested inside an already-claimed target is
skipped so nothing is counted twice.

### Deleting is guarded three times over

1. The UI only ever offers folders the scanner classified as rebuildable.
2. `main.cjs` passes the path to `removeTarget()`, which re-validates it with `isRemovable()`:
   absolute, no `..`, at least three path segments deep, and its last segment must be in the
   removable list. A refusal is reported, not silently swallowed.
3. The size is measured immediately before the delete and again after any failure, so the freed
   figure is what actually went — not the scan-time estimate.

Windows read-only attributes (npm and Gradle set them) are cleared on the retry path, so an
`EPERM` does not end the job.

## What the App junk tab empties

Every Chromium-based app — Claude, VS Code, Cursor, Discord, Slack, Postman, the browsers —
keeps the same handful of folders under its profile: `Cache`, `Code Cache`, `GPUCache`, the
Dawn shader caches, `logs`, `Crashpad`. They are rebuilt on demand, so emptying them costs a
slightly slower first launch and nothing else. `appJunk.cjs` does not hardcode the apps: it
walks `%APPDATA%` and `%LOCALAPPDATA%` and treats any folder with a cache directory next to a
`Local State` or `Preferences` file as Chromium-shaped. New apps are picked up without a code
change.

On top of that comes a curated list: browser profiles (Chrome, Edge, Brave, Vivaldi, Firefox),
package-manager caches (npm, Yarn, pnpm, pip, uv, Composer, NuGet), Gradle and Android SDK
caches, JetBrains and Android Studio caches and logs, Claude Code's MCP logs and shell
snapshots, Telegram's media cache, Windows temp, crash dumps, error reports, GPU driver shader
caches, leftover app-update installers, and the Recycle Bin.

Each entry says what happens once it is gone. Ones that take real time to come back — package
caches, IDE indexes, Electron binary downloads — are marked *caution* and are never ticked by
"Select all safe". Nothing is ever listed from `~/.claude/projects`, sessions, settings, or
anything an app cannot regenerate.

Three rules keep this safe:

1. Only a path the catalogue discovers *right now* can be emptied. The renderer sends paths
   back, but `reclaim:startAppClean` re-runs discovery and drops anything not on the list, and
   the worker re-checks again before unlinking (`isJunkPath`).
2. Folders are emptied, never removed, so an app never finds its cache directory missing.
3. Files an open program still holds are left where they are and reported, not forced.

## Uninstalling programs

`electron/programs.cjs` reads the three Uninstall hives (64-bit, 32-bit, per-user) and the
Store's package list, keeping only packages with a Start-menu tile so runtimes and plumbing
never appear. Sizes the installer did not record are measured from the install folder.
Runtimes, redistributables and drivers are flagged as *dependency* before you remove them.

Uninstalling runs the program's own uninstaller — the quiet variant when it registered one —
`msiexec /x` for Windows Installer packages, and `Remove-AppxPackage` for Store apps. The
command always comes from a fresh registry read, never from the renderer. Machine-wide programs
go through the elevated runner (one UAC prompt each); per-user ones run without a prompt on a
second PowerShell helper so the live process table never waits behind an uninstaller. Whether
the program is gone is decided by re-reading the list, not by the uninstaller's exit code.

Afterwards the program's leftovers are found: its install folder if it survived, and top-level
folders under `%APPDATA%`, `%LOCALAPPDATA%`, `ProgramData`, Program Files and the home
folder's dot-folders whose name matches the program's. Publisher folders shared by many
programs are looked into one level, never offered whole; Windows' own folders are never
offered at all. Deleting leftovers is a normal job with the grace window, and the main process
only accepts paths it offered for that program. **Force remove** deletes the registry entry of
a program whose uninstaller is missing and then offers its files the same way.

## What the CPU boost tab changes

None of it is overclocking. Windows ships every machine on the Balanced plan with the clock
allowed to idle at 5%, cores parked, turbo waiting on a ramp, and — on many laptops — the
maximum processor state capped below 100%, which quietly disables turbo altogether. These are
power-plan values, and `powercfg` can change every one of them:

| Change                    | What it sets                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| High performance plan     | `powercfg /setactive` to High performance (Ultimate if it exists)         |
| Maximum state 100%        | `PROCTHROTTLEMAX` 100 on AC and DC                                        |
| Turbo aggressive          | `PERFBOOSTMODE` 2 on AC (unhidden first)                                  |
| No core parking           | `CPMINCORES` 100 on AC                                                    |
| Minimum state 100%        | `PROCTHROTTLEMIN` 100 on AC only — battery is left alone                  |
| Active cooling            | `SYSCOOLPOL` 1                                                            |
| Best performance mode     | `powercfg /overlaysetactive`, skipped on machines without the slider      |
| Favour the foreground     | `Win32PrioritySeparation` = 0x26                                          |

Everything runs as one elevated batch, so there is one UAC prompt. Before the first change,
`%APPDATA%\Reclaim\cpu-backup.json` records the active plan, the modified plan's original
values, the overlay, the priority separation and the service start types; **Restore original
settings** replays that file and deletes it. On a laptop the plan switch and the pinned minimum
clock are unticked by default because they cost battery and heat.

The reading itself never sleeps: `% Processor Performance` comes from the raw counter class,
diffed between polls, so the clock figure is live at ~30 ms a reading. Over 100% means turbo is
engaged; under 85% while the load is above 40% means something is holding the clock down, and
the tab says so.

The same tab lists startup programs (the Run keys and Startup folders, gated by the
`StartupApproved` values Task Manager writes — 02 enabled, 03 disabled) and two services worth
turning off on some machines: SysMain on a hard disk, Windows Search indexing on a build box.
Both are reversible from the same switch.

## While a scan runs

Every counting page — App junk, Projects, Drives — shows a card deck while it works: a
remaining-work card every few cards ("42% done · 19 folders left · about a minute at this
pace, the big folders always come last"), live cards built from what has been found so far
(biggest folder, programs found, apps still running), and facts about the section and the
machine in between. Cards advance on their own, or by swipe, the arrows, or the arrow keys.
Rows still being counted show a soft fog where the number will be — one CSS gradient and one
keyframe, so a few hundred of them cost nothing.

## What the This PC page knows

`agent.ps1` reads SMBIOS/WMI once (`Win32_ComputerSystem`, `Win32_BaseBoard`, `Win32_BIOS`,
`Win32_Processor`, `Win32_PhysicalMemory` + `PhysicalMemoryArray`, `Win32_VideoController`,
`Get-PhysicalDisk` + partitions, physical network adapters, monitors) and caches it; the first
read takes ~20 s while the providers load, so `main.cjs` takes it quietly ten seconds after
launch. `upgrades.cjs` turns the reading into advice with a table of sockets and their strongest
chips (LGA1155/1150/1151/1200/1700/1851, AM4/AM5), the memory array's slot count and maximum,
and the chipset generation for NVMe. Mobile processors are recognised by suffix and by the
chassis type, and reported as soldered. Every card carries a confidence tag.

## Throttling

Scanning is disk-bound, and on a machine with real-time antivirus every read goes through the
filter driver first. The throttle sets how wide the walk fans out and what priority Reclaim
itself runs at:

| Level    | Files per batch | Directories per batch | Reclaim's priority |
| -------- | --------------- | --------------------- | ------------------ |
| Gentle   | 24              | 3                     | Below normal       |
| Balanced | 128             | 12                    | Normal             |
| Fast     | 320             | 32                    | Above normal       |

It applies to jobs already running — the scanner re-reads it between projects.

## Process control

The Processes tab reads the machine through `agent.ps1`, a PowerShell helper kept alive for the
lifetime of the app. Starting PowerShell costs about a second; every snapshot after that costs
about 100 ms, because CPU time is diffed against the previous reading rather than sampled with
a sleep.

- CPU is reported as a share of the **whole machine**, so four cores at full tilt reads as 100%.
- Processes are grouped — Node & tooling, Builds & Android, Editors, Browsers, Antivirus,
  Windows — and each group shows its own CPU share.
- Command lines are resolved for `node`, `java`, `bun`, `deno` and `python`, so two `node`
  processes are told apart by what they are actually running.
- Windows' own processes, Defender, and Reclaim itself are marked protected: the End button and
  the priority selector are disabled for them.
- Priority runs from Idle to High. Realtime is not offered — it can starve the mouse cursor.

## Why antivirus makes a developer machine crawl

Real-time scanning inspects every file on its way to disk. `MsMpEng` barely reads anything
itself — measured on a four-core desktop it sat at 18% CPU with 7,300 hard page faults a second
while its own I/O read zero, because it was inspecting what *other* programs were writing.

An `npm install` writes tens of thousands of small files into caches that usually sit on `C:`,
so excluding your project folder is not enough on its own. The Performance tab lists the folders
your tooling actually writes to and says which are still being scanned:

| Folder | Why it matters |
| --- | --- |
| `%LOCALAPPDATA%\Temp` | Where npm, electron-builder and most installers stage files |
| `%APPDATA%\npm-cache`, `%LOCALAPPDATA%\npm-cache`, `~/.npm` | Every package ever downloaded |
| `%LOCALAPPDATA%\Yarn\Cache`, `%LOCALAPPDATA%\pnpm` | The same for the other package managers |
| `~/.gradle`, `~/.m2`, `~/.cargo` | Build caches that are rewritten constantly |
| `%APPDATA%\Docker`, `%LOCALAPPDATA%\Docker` | Image layers |
| `~/.vscode\extensions` | Rewritten on every extension update |

Reclaim reads these settings and never changes them. It prints the exact `Add-MpPreference`
commands for you to review and run elevated yourself, because excluding a folder means Defender
stops checking it — that is a security decision, not a performance one.

`npm run doctor` prints the same diagnosis from a terminal, without the app.

## Known limits

- Windows only. The scanner is cross-platform but `agent.ps1`, priorities and the drive list
  are not.
- Pause takes effect at the next batch boundary, not instantly — a single very large directory
  finishes measuring first.
- Defender exclusions are shown, never changed. The Performance tab prints the
  `Add-MpPreference` command for you to review and run elevated yourself; excluding a folder
  means Defender stops checking files in it, which is a trade you should make deliberately.
- A scan of a very large tree still takes minutes on a spinning disk. **Stop** in the task dock
  cancels it mid-walk.
