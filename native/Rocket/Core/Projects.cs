using System.Collections.Concurrent;
using System.IO;
using System.IO.Enumeration;

namespace Rocket.Core;

/// <summary>A rebuildable folder inside a project: node_modules, target, .next, bin/obj…</summary>
public sealed record Artifact(string Path, string Kind, Risk Risk, string ProjectRoot);

/// <summary>
/// Walks the drives once, folder by folder, looking for what builds and installs leave
/// inside projects — and for model files people downloaded by hand. It never descends into
/// what it found (a node_modules is counted, not explored), nor into dot-folders, version
/// control or system folders, so the walk covers the projects, not the packages.
/// </summary>
public static class Projects
{
    public const string NodeModules = "node_modules", BuildCache = "cache", BuildOutput = "output", PyCache = "pycache", Venv = "venv";

    private static readonly EnumerationOptions Flat = new()
    {
        RecurseSubdirectories = false, IgnoreInaccessible = true, AttributesToSkip = 0, BufferSize = 64 * 1024,
    };

    private static readonly HashSet<string> SkipEverywhere = new(StringComparer.OrdinalIgnoreCase)
    {
        "$RECYCLE.BIN", "System Volume Information", "Windows", "WindowsApps", "Program Files", "Program Files (x86)",
        "ProgramData", "Recovery", "PerfLogs", "$WinREAgent", "Config.Msi", "Documents and Settings", "Windows.old",
        "$Windows.~BT", "$Windows.~WS", "ESD", "AppData", "Application Data", "Local Settings", "OneDriveTemp", "MSOCache",
        // where projects do not live, and walking costs minutes
        "Music", "Videos", "Pictures", "Games", "Steam", "SteamLibrary", "My Music", "My Videos", "My Pictures",
    };

    private static readonly HashSet<string> JsCaches = new(StringComparer.OrdinalIgnoreCase)
    {
        ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache", ".angular", ".expo", ".docusaurus", ".astro",
        ".vite", ".cache", ".output", ".vercel\\output", ".wrangler", ".swc", ".eslintcache",
    };

    private static readonly HashSet<string> JsOutputs = new(StringComparer.OrdinalIgnoreCase)
    {
        "dist", "build", "out", "release", "storybook-static", "coverage", ".nyc_output", "dist-electron", "dist-ssr",
    };

    private static readonly HashSet<string> PyCaches = new(StringComparer.OrdinalIgnoreCase)
    {
        "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".hypothesis", ".ipynb_checkpoints",
    };

    private static readonly HashSet<string> ModelExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".gguf", ".safetensors", ".ckpt", ".pt", ".pth", ".onnx", ".bin", ".h5", ".tflite", ".pb", ".ggml", ".mlmodel", ".llamafile",
    };

    /// <summary>
    /// Where projects live: every fixed drive that is getting full, plus the system drive.
    /// On the system drive only the user's own folders and non-system top-level folders.
    /// </summary>
    private static readonly string SysRoot = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows)) ?? @"C:\";

    /// <summary>
    /// The drives worth cleaning: the system drive, and any fixed drive under 25% free.
    /// A roomy external disk is left alone — walking it costs minutes and frees nothing needed.
    /// </summary>
    public static List<DriveInfo> Crowded()
    {
        var list = new List<DriveInfo>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                if (d.Name.Equals(SysRoot, StringComparison.OrdinalIgnoreCase) || (d.TotalSize > 0 && d.AvailableFreeSpace < d.TotalSize * 0.25))
                    list.Add(d);
            }
            catch { }
        }
        return list;
    }

    public static List<string> DefaultRoots()
    {
        var roots = new List<string>();
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var d in Crowded())
        {
            try
            {
                bool isSys = d.Name.Equals(SysRoot, StringComparison.OrdinalIgnoreCase);
                foreach (var top in Fs.Dirs(d.RootDirectory.FullName))
                {
                    var n = Path.GetFileName(top);
                    if (SkipEverywhere.Contains(n) || n.StartsWith('$')) continue;
                    if (isSys && n.Equals("Users", StringComparison.OrdinalIgnoreCase)) continue;
                    if (isSys && n is "Intel" or "AMD" or "NVIDIA" or "Drivers" or "inetpub" or "XboxGames") continue;
                    roots.Add(top);
                }
                if (isSys) roots.Add(home);
            }
            catch { }
        }
        return roots;
    }

    private sealed class Dir
    {
        public bool PackageJson, Cargo, Pom, DotNet, Gradle, Pubspec, Podfile, Git;
        public List<(string Path, string Name, bool Link)> Subs = [];
    }

    public static void Discover(IEnumerable<string> roots, Action<Artifact> onArtifact, Action<string, long, DateTime> onModel,
        CancellationToken ct)
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        // Units of work: each root's children, so one huge folder does not hold up the rest.
        var units = new List<(string Path, string? Git)>();
        foreach (var r in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(r)) continue;
            var d = Read(r, onModel);
            if (d is null) continue;
            string? git = d.Git ? r : null;
            Visit(r, d, git, home, onArtifact, units, 0);
        }

        Parallel.ForEach(units, new ParallelOptions { MaxDegreeOfParallelism = Fs.Workers, CancellationToken = ct }, u =>
        {
            var stack = new Stack<(string Path, string? Git, int Depth)>();
            stack.Push((u.Path, u.Git, 1));
            var next = new List<(string Path, string? Git)>();
            while (stack.Count > 0)
            {
                ct.ThrowIfCancellationRequested();
                var (path, git, depth) = stack.Pop();
                var d = Read(path, onModel);
                if (d is null) continue;
                if (d.Git) git = path;
                next.Clear();
                Visit(path, d, git, home, onArtifact, next, depth);
                if (depth >= 12) continue;
                foreach (var n in next) stack.Push((n.Path, n.Git, depth + 1));
            }
        });
    }

    private static Dir? Read(string path, Action<string, long, DateTime> onModel)
    {
        var d = new Dir();
        try
        {
            var e = new FileSystemEnumerable<(string Name, bool IsDir, bool Link, long Len, DateTime W)>(path,
                (ref FileSystemEntry en) => (en.FileName.ToString(), en.IsDirectory, (en.Attributes & FileAttributes.ReparsePoint) != 0,
                    en.Length, en.LastWriteTimeUtc.UtcDateTime), Flat);
            foreach (var x in e)
            {
                if (x.IsDir)
                {
                    if (x.Name.Equals(".git", StringComparison.OrdinalIgnoreCase)) d.Git = true;
                    d.Subs.Add((Path.Combine(path, x.Name), x.Name, x.Link));
                    continue;
                }
                var n = x.Name;
                if (n.Equals("package.json", StringComparison.OrdinalIgnoreCase)) d.PackageJson = true;
                else if (n.Equals("Cargo.toml", StringComparison.OrdinalIgnoreCase)) d.Cargo = true;
                else if (n.Equals("pom.xml", StringComparison.OrdinalIgnoreCase)) d.Pom = true;
                else if (n.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase) || n.EndsWith(".fsproj", StringComparison.OrdinalIgnoreCase)
                         || n.EndsWith(".vbproj", StringComparison.OrdinalIgnoreCase)) d.DotNet = true;
                else if (n.StartsWith("build.gradle", StringComparison.OrdinalIgnoreCase) || n.StartsWith("settings.gradle", StringComparison.OrdinalIgnoreCase)) d.Gradle = true;
                else if (n.Equals("pubspec.yaml", StringComparison.OrdinalIgnoreCase)) d.Pubspec = true;
                else if (n.Equals("Podfile", StringComparison.OrdinalIgnoreCase)) d.Podfile = true;
                else if (x.Len >= 300L << 20 && ModelExts.Contains(Path.GetExtension(n))
                         && (x.Len >= 1L << 30 || !n.EndsWith(".bin", StringComparison.OrdinalIgnoreCase)))
                    onModel(Path.Combine(path, n), x.Len, x.W);
            }
        }
        catch { return null; }
        return d;
    }

    /// <summary>Reports the artifacts directly inside <paramref name="path"/> and queues the rest.</summary>
    private static void Visit(string path, Dir d, string? git, string home, Action<Artifact> found,
        List<(string Path, string? Git)> next, int depth)
    {
        // A home folder or a drive root with a stray package.json is not a project: its
        // .cache holds models and its "build" may be anything.
        if (path.Equals(home, StringComparison.OrdinalIgnoreCase) || path.TrimEnd('\\').Length <= 2)
        {
            d.PackageJson = d.Cargo = d.Pom = d.DotNet = d.Gradle = d.Pubspec = d.Podfile = false;
            git = null;
        }
        var project = git ?? path;
        HashSet<string>? ignored = null;
        bool Ignored(string name)
        {
            ignored ??= ReadIgnore(path, git);
            return ignored.Contains(name);
        }

        foreach (var (sub, name, link) in d.Subs)
        {
            if (link) continue;
            string? kind = null; Risk risk = Risk.Safe;

            if (name.Equals("node_modules", StringComparison.OrdinalIgnoreCase))
            { kind = NodeModules; risk = d.PackageJson ? Risk.Safe : Risk.Review; }
            else if (d.PackageJson && JsCaches.Contains(name)) kind = BuildCache;
            else if (d.PackageJson && JsOutputs.Contains(name) && Ignored(name)) kind = BuildOutput;
            else if ((d.Cargo || d.Pom) && name.Equals("target", StringComparison.OrdinalIgnoreCase)) kind = BuildOutput;
            else if (d.DotNet && (name.Equals("bin", StringComparison.OrdinalIgnoreCase) || name.Equals("obj", StringComparison.OrdinalIgnoreCase))) kind = BuildOutput;
            else if (d.Gradle && name is "build" or ".gradle" or ".cxx" or ".externalNativeBuild" or ".kotlin") kind = BuildOutput;
            else if (d.Pubspec && name is "build" or ".dart_tool") kind = BuildOutput;
            else if (d.Podfile && name == "Pods") kind = BuildOutput;
            else if (PyCaches.Contains(name)) kind = PyCache;
            else if (File.Exists(Path.Combine(sub, "pyvenv.cfg"))) { kind = Venv; risk = Risk.Review; }
            else if (File.Exists(Path.Combine(sub, "CMakeCache.txt"))) kind = BuildOutput;

            if (kind != null)
            {
                found(new Artifact(sub, kind, risk, project));
                continue;
            }

            if (name.StartsWith('.') || name.StartsWith('$') || SkipEverywhere.Contains(name)) continue;
            next.Add((sub, git));
        }
    }

    private static HashSet<string> ReadIgnore(string dir, string? git)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in new[] { Path.Combine(dir, ".gitignore"), git is null ? null : Path.Combine(git, ".gitignore") })
        {
            if (f is null || !File.Exists(f)) continue;
            try
            {
                foreach (var raw in File.ReadLines(f))
                {
                    var l = raw.Trim();
                    if (l.Length == 0 || l[0] is '#' or '!') continue;
                    l = l.Replace("**/", "").Trim('/');
                    if (l.EndsWith("/*")) l = l[..^2];
                    if (!l.Contains('/') && !l.Contains('*')) set.Add(l);
                }
            }
            catch { }
        }
        return set;
    }

    private static readonly ConcurrentDictionary<string, DateTime> Activity = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// When someone last worked in a project: the newest of its top-level files, its source
    /// folders' top level, and git's index and HEAD log.
    /// </summary>
    public static DateTime LastActivity(string root) => Activity.GetOrAdd(root, r =>
    {
        var newest = DateTime.MinValue;
        void Look(string dir)
        {
            foreach (var f in Fs.Files(dir)) if (f.Written > newest) newest = f.Written;
        }
        Look(r);
        foreach (var s in new[] { "src", "app", "lib", "pages", "components", "server" }) Look(Path.Combine(r, s));
        foreach (var g in new[] { @".git\index", @".git\logs\HEAD", @".git\FETCH_HEAD" })
        {
            try { var p = Path.Combine(r, g); if (File.Exists(p)) { var t = File.GetLastWriteTimeUtc(p); if (t > newest) newest = t; } }
            catch { }
        }
        return newest == DateTime.MinValue ? DateTime.UtcNow : newest;
    });

    public static void ResetActivity() => Activity.Clear();
}
