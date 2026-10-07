# Rocket (native)

Rocket rewritten as a small native Windows app (WPF, .NET 9), replacing the Electron version
for one job: getting disk space back on a developer's machine, fast.

| Page | What it does |
|---|---|
| **Overview** | Reclaimable space, the CPU clock against its rating, memory — and alerts that lead to the page that fixes them |
| **Quick clean** | Temp, Windows Update, crash dumps, shader caches, Recycle Bin, hibernation file; npm / Yarn / pnpm / pip / uv / NuGet / Gradle / Maven / Cargo / Go caches; old Android NDK, build-tools, platforms; VS Code-family caches and replaced extensions; Chromium and Electron app caches; old app versions, downloaded updates; old installers |
| **Projects** | `node_modules`, `.next`, `dist`/`build` (when git-ignored), `target`, `bin`/`obj`, Gradle and Flutter builds, `__pycache__`, virtualenvs — and moving a whole project to another drive without what its tools rebuild |
| **AI models** | Hugging Face hub, Ollama (shared blobs kept), LM Studio, GPT4All, torch/whisper caches, loose model files |
| **Programs** | Add/Remove and Store apps by size; uninstall with the program's own uninstaller (command read fresh), remove dead entries, then sweep the folders left behind |
| **Space map** | A whole drive, biggest first, filling in live; delete or move any folder (Windows and Program Files are fenced off) |
| **Startup** | The Run keys and Startup folders, switched through StartupApproved — the same switch as Task Manager |
| **Processes** | Live CPU and memory, findings, programs grouped by kind, dev servers one by one with their command line, priority and end task |
| **Tune-up** | Live clock; eight CPU & power tweaks with a one-time backup and Restore; SysMain and Search indexing; Defender exclusions for dev caches |
| **This PC** | Specs from CIM and upgrade advice: free RAM slots, the best CPU for the socket, GPU class, NVMe |
| **History** | Every clean-up, move and setting change |

Anything that needs administrator rights runs through one UAC prompt and is checked afterwards.

Rows marked *check first* are never ticked by default. Everything is deleted for good — the
Recycle Bin would keep the space taken. Junctions and symlinks are unlinked, never followed;
system and profile folders are refused by `Core/Guard.cs` whatever the catalog says.

## Build

```powershell
& "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe" build native\Rocket\Rocket.csproj
powershell -ExecutionPolicy Bypass -File native\tools\make-installer.ps1   # dist\Rocket-Setup-<v>.exe
```

## Checks without a window

```
Rocket.exe --report out.txt                 # everything it would find, measured; deletes nothing
Rocket.exe --selftest <scratch dir> out.txt # the delete engine's promises, in a scratch folder
Rocket.exe --shot out.png clean,projects 90 # renders pages off-screen after 90 s of scanning
Rocket.exe --movetest <scratch> <scratch on another drive> out.txt   # a fake project, moved and checked
```
