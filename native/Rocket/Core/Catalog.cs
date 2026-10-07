using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Rocket.Core;

/// <summary>
/// Every place on a developer's Windows machine where disposable bytes pile up, resolved to
/// the folders that actually exist here. Only paths are found here; sizes come later.
/// Each path is claimed once, so an app's cache is never counted under two items.
/// </summary>
public sealed partial class Catalog
{
    private static readonly string L = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private static readonly string R = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    private static readonly string H = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static readonly string W = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
    private static readonly string PD = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
    private static readonly string LL = Path.Combine(H, "AppData", "LocalLow");
    private static readonly string Sys = Path.GetPathRoot(W) ?? @"C:\";

    private readonly List<Item> _items = [];
    private readonly List<string> _claimed = [];

    public static List<Item> Build()
    {
        var c = new Catalog();
        c.System();
        c.Dev();
        c.Editors();
        c.AiCaches();
        c.Apps();
        c.Leftovers();
        return c._items;
    }

    // ── plumbing ────────────────────────────────────────────────────────────

    private bool Claim(string p)
    {
        var n = p.TrimEnd('\\');
        foreach (var c in _claimed)
            if (n.Equals(c, StringComparison.OrdinalIgnoreCase)
                || n.StartsWith(c + "\\", StringComparison.OrdinalIgnoreCase)
                || c.StartsWith(n + "\\", StringComparison.OrdinalIgnoreCase))
                return false;
        _claimed.Add(n);
        return true;
    }

    private static bool Exists(string p) => Directory.Exists(p) || File.Exists(p);

    private Item? Add(string group, string id, Kind kind, IEnumerable<string> paths, Risk risk = Risk.Safe,
        bool admin = false, string? name = null, string glyph = "\uE74C", TimeSpan minAge = default, string? note = null,
        bool keepEmpty = false)
    {
        var list = new List<string>();
        foreach (var p in paths)
        {
            if (string.IsNullOrEmpty(p) || !Exists(p)) continue;
            var full = Path.GetFullPath(p);
            if (Claim(full)) list.Add(full);
        }
        if (list.Count == 0 && !keepEmpty) return null;
        var item = new Item
        {
            Id = id, Group = group, Kind = kind, Risk = risk, Admin = admin, Paths = list, MinAge = minAge,
            TitleKey = "t." + id, DetailKey = "d." + id.Split('.')[0], Name = name, Glyph = glyph, Note = note,
        };
        _items.Add(item);
        return item;
    }

    private Item? Add(string group, string id, Kind kind, Risk risk, bool admin, params string[] paths)
        => Add(group, id, kind, paths, risk, admin);

    /// <summary>Subfolders of <paramref name="dir"/> whose name matches.</summary>
    private static IEnumerable<string> Sub(string dir, Func<string, bool> match)
        => Fs.Dirs(dir).Where(d => match(Path.GetFileName(d)));

    private static readonly Regex VersionTail = MyVersionTail();
    [GeneratedRegex(@"^(?<id>.+?)-(?<v>\d+(\.\d+)+)(?<rest>[-+].*)?$")]
    private static partial Regex MyVersionTail();

    private static Version? ParseVersion(string s)
    {
        var m = Regex.Match(s, @"\d+(\.\d+){1,3}");
        return m.Success && Version.TryParse(m.Value, out var v) ? v : null;
    }

    // ── Windows ─────────────────────────────────────────────────────────────

    private void System()
    {
        const string g = "system";
        var day = TimeSpan.FromDays(1);

        Add(g, "temp", Kind.OldFiles, [Path.GetTempPath(), Path.Combine(L, "Temp")], minAge: day, glyph: "\uE7B8");
        Add(g, "wintemp", Kind.OldFiles, [Path.Combine(W, "Temp")], admin: true, minAge: day, glyph: "\uE7B8");
        Add(g, "recycle", Kind.RecycleBin, [], glyph: "\uE74D", keepEmpty: true);
        Add(g, "wu", Kind.Contents, Risk.Safe, true, Path.Combine(W, @"SoftwareDistribution\Download"));
        Add(g, "delivery", Kind.Contents, Risk.Safe, true,
            Path.Combine(W, @"ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache"));
        Add(g, "wer", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"Microsoft\Windows\WER"), Path.Combine(L, "CrashDumps"));
        Add(g, "wersys", Kind.Contents, [Path.Combine(PD, @"Microsoft\Windows\WER"), Path.Combine(W, "Minidump"),
            Path.Combine(W, "LiveKernelReports")], admin: true);
        Add(g, "memdump", Kind.Remove, Risk.Safe, true, Path.Combine(W, "MEMORY.DMP"));
        Add(g, "shader", Kind.Contents, Risk.Safe, false,
            Path.Combine(L, "D3DSCache"), Path.Combine(L, @"NVIDIA\DXCache"), Path.Combine(L, @"NVIDIA\GLCache"),
            Path.Combine(LL, @"NVIDIA\PerDriverVersion\DXCache"), Path.Combine(LL, @"NVIDIA\PerDriverVersion\GLCache"),
            Path.Combine(L, @"AMD\DxCache"), Path.Combine(L, @"AMD\DxcCache"), Path.Combine(L, @"AMD\GLCache"),
            Path.Combine(L, @"AMD\VkCache"), Path.Combine(LL, @"Intel\ShaderCache"));
        Add(g, "inet", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"Microsoft\Windows\INetCache"));
        Add(g, "cbs", Kind.OldFiles, [Path.Combine(W, @"Logs\CBS"), Path.Combine(W, @"Logs\DISM"), Path.Combine(W, @"Logs\WindowsUpdate")],
            admin: true, minAge: TimeSpan.FromDays(3));
        Add(g, "oldwin", Kind.Remove, [Path.Combine(Sys, "Windows.old"), Path.Combine(Sys, "$Windows.~BT"),
            Path.Combine(Sys, "$Windows.~WS"), Path.Combine(Sys, "ESD")], Risk.Review, admin: true);

        var hib = Path.Combine(Sys, "hiberfil.sys");
        if (File.Exists(hib)) Add(g, "hiber", Kind.Hibernate, [], Risk.Review, admin: true, keepEmpty: true)!.Paths.Add(hib);
        Add(g, "winsxs", Kind.ComponentStore, [], Risk.Review, admin: true, keepEmpty: true);
    }

    // ── package managers and build tools ───────────────────────────────────

    private void Dev()
    {
        const string g = "dev";
        Add(g, "npm", Kind.Contents, Risk.Safe, false, Path.Combine(L, "npm-cache"), Path.Combine(R, "npm-cache"));
        Add(g, "yarn", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"Yarn\Cache"), Path.Combine(H, @".yarn\berry\cache"));
        var pnpm = new List<string> { Path.Combine(L, @"pnpm\store"), Path.Combine(L, "pnpm-cache") };
        foreach (var d in Projects.Crowded())
            pnpm.Add(Path.Combine(d.RootDirectory.FullName, ".pnpm-store"));
        Add(g, "pnpm", Kind.Contents, pnpm, Risk.Review);
        Add(g, "bun", Kind.Contents, Risk.Safe, false, Path.Combine(H, @".bun\install\cache"));
        Add(g, "nodegyp", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"node-gyp\Cache"));
        // env-paths: node CLIs keep their throwaway files in %LOCALAPPDATA%\<name>-nodejs\Cache
        Add(g, "nodecli", Kind.Contents, Sub(L, n => n.EndsWith("-nodejs", StringComparison.OrdinalIgnoreCase))
            .Select(d => Path.Combine(d, "Cache")).Concat([Path.Combine(L, "next-swc"), Path.Combine(L, "swc"), Path.Combine(L, "vitest")]));
        Add(g, "pip", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"pip\cache"), Path.Combine(H, @".cache\pip"));
        Add(g, "uv", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"uv\cache"), Path.Combine(H, @".cache\uv"));
        Add(g, "poetry", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"pypoetry\Cache"));
        Add(g, "conda", Kind.Contents, Risk.Review, false, Path.Combine(H, @"anaconda3\pkgs"), Path.Combine(H, @"miniconda3\pkgs"),
            Path.Combine(PD, @"anaconda3\pkgs"), Path.Combine(PD, @"miniconda3\pkgs"));
        Add(g, "nugethttp", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"NuGet\v3-cache"), Path.Combine(L, @"NuGet\plugins-cache"),
            Path.Combine(L, @"NuGet\http-cache"));
        Add(g, "nuget", Kind.Contents, Risk.Review, false, Path.Combine(H, @".nuget\packages"));
        Add(g, "gradle", Kind.Contents, Risk.Review, false, Path.Combine(H, @".gradle\caches"), Path.Combine(H, @".gradle\wrapper\dists"));
        Add(g, "gradled", Kind.Contents, Risk.Safe, false, Path.Combine(H, @".gradle\daemon"), Path.Combine(H, @".gradle\.tmp"));
        Add(g, "maven", Kind.Contents, Risk.Review, false, Path.Combine(H, @".m2\repository"));
        Add(g, "cargo", Kind.Contents, Risk.Review, false, Path.Combine(H, @".cargo\registry\cache"), Path.Combine(H, @".cargo\registry\src"),
            Path.Combine(H, @".cargo\git\checkouts"));
        Add(g, "gobuild", Kind.Contents, Risk.Safe, false, Path.Combine(L, "go-build"));
        Add(g, "gomod", Kind.Contents, Risk.Review, false, Path.Combine(H, @"go\pkg\mod"));
        Add(g, "electron", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"electron\Cache"), Path.Combine(L, @"electron-builder\Cache"),
            Path.Combine(L, "SquirrelTemp"));
        Add(g, "browsers", Kind.Contents, Risk.Review, false, Path.Combine(L, "ms-playwright"), Path.Combine(L, "ms-playwright-go"),
            Path.Combine(H, @".cache\puppeteer"), Path.Combine(L, @"Cypress\Cache"), Path.Combine(H, @".cache\selenium"));
        Add(g, "android", Kind.Contents, Risk.Safe, false, Path.Combine(H, @".android\cache"), Path.Combine(H, @".android\build-cache"),
            Path.Combine(L, @"Android\Sdk\.temp"), Path.Combine(H, ".skiko"));
        Add(g, "composer", Kind.Contents, Risk.Safe, false, Path.Combine(L, "Composer"));
        Add(g, "vs", Kind.Contents, Sub(Path.Combine(L, @"Microsoft\VisualStudio"), _ => true)
            .Select(d => Path.Combine(d, "ComponentModelCache")));
        Add(g, "vspkg", Kind.Contents, Risk.Review, false, Path.Combine(L, "Package Cache"));
        Add(g, "javacrash", Kind.Remove, Fs.Files(H).Where(f => Path.GetFileName(f.Path).StartsWith("hs_err_pid", StringComparison.OrdinalIgnoreCase)
            || Path.GetFileName(f.Path).StartsWith("replay_pid", StringComparison.OrdinalIgnoreCase)).Select(f => f.Path));
        Add(g, "claudetmp", Kind.Remove, Fs.Files(H).Where(f => Path.GetFileName(f.Path).StartsWith(".claude.json.tmp.", StringComparison.OrdinalIgnoreCase)
            && f.Written < DateTime.UtcNow.AddHours(-1)).Select(f => f.Path));

        // Claude Code keeps every version it ever updated to; the newest is the one in use.
        OldVersions(g, "claudever", Path.Combine(H, @".local\share\claude\versions"));
        Add(g, "claudestage", Kind.Contents, Risk.Safe, false, Path.Combine(H, @".cache\claude\staging"));
        JetBrains(g);
        foreach (var sdk in AndroidSdks()) AndroidSdk(g, sdk);
    }

    /// <summary>Every version folder but the newest.</summary>
    private void OldVersions(string g, string id, string dir)
    {
        var vs = Fs.Dirs(dir).Concat(Fs.Files(dir).Select(f => f.Path))
            .Select(p => (p, v: ParseVersion(Path.GetFileName(p)))).Where(x => x.v != null).OrderByDescending(x => x.v).ToList();
        if (vs.Count > 1) Add(g, id, Kind.Remove, vs.Skip(1).Select(x => x.p));
    }

    /// <summary>Android SDKs: the env vars, the default, and any SDK-shaped folder near a drive root.</summary>
    private static IEnumerable<string> AndroidSdks()
    {
        var c = new List<string?> { Environment.GetEnvironmentVariable("ANDROID_HOME"), Environment.GetEnvironmentVariable("ANDROID_SDK_ROOT"),
            Path.Combine(L, @"Android\Sdk") };
        foreach (var d in Projects.Crowded())
            foreach (var top in Fs.Dirs(d.RootDirectory.FullName).Where(t => !Path.GetFileName(t).StartsWith('$') && !Path.GetFileName(t).Equals("Windows", StringComparison.OrdinalIgnoreCase)))
            {
                c.Add(top);
                c.AddRange(Fs.Dirs(top).Where(x => Regex.IsMatch(Path.GetFileName(x), "sdk|android", RegexOptions.IgnoreCase)));
            }
        return c.Where(p => !string.IsNullOrEmpty(p) && Directory.Exists(Path.Combine(p!, "platform-tools"))
                            && (Directory.Exists(Path.Combine(p!, "build-tools")) || Directory.Exists(Path.Combine(p!, "platforms"))))
            .Select(p => Path.GetFullPath(p!).TrimEnd('\\')).Distinct(StringComparer.OrdinalIgnoreCase)!;
    }

    /// <summary>
    /// Android Studio installs a new NDK, CMake and build-tools for every project that asks,
    /// and never removes the old ones. Keeps the newest; a project pinned to an older one
    /// downloads it again on its next build.
    /// </summary>
    private void AndroidSdk(string g, string sdk)
    {
        List<string> Older(string sub, int keep) => Fs.Dirs(Path.Combine(sdk, sub))
            .Select(d => (d, v: ParseVersion(Path.GetFileName(d).Replace("android-", "") + (Path.GetFileName(d).StartsWith("android-") ? ".0" : ""))))
            .Where(x => x.v != null).OrderByDescending(x => x.v).Skip(keep).Select(x => x.d).ToList();

        var ndk = Older("ndk", 1);
        ndk.AddRange(Fs.Files(Path.Combine(sdk, "ndk")).Where(f => f.Path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)).Select(f => f.Path));
        ndk.Add(Path.Combine(sdk, "ndk-bundle"));
        var where = $"  ({sdk})";
        Add(g, "sdkndk." + sdk, Kind.Remove, ndk, Risk.Review, name: Loc.I["t.sdkndk"] + where);
        Add(g, "sdkbt." + sdk, Kind.Remove, Older("build-tools", 2).Concat(Older("cmake", 1)), Risk.Review, name: Loc.I["t.sdkbt"] + where);
        Add(g, "sdkplat." + sdk, Kind.Remove, Older("platforms", 3).Concat(Older("sources", 2)), Risk.Review, name: Loc.I["t.sdkplat"] + where);
        Add(g, "sdkimg." + sdk, Kind.Remove, Fs.Dirs(Path.Combine(sdk, "system-images")), Risk.Review, name: Loc.I["t.sdkimg"] + where);
        Add(g, "sdktmp." + sdk, Kind.Remove, [Path.Combine(sdk, ".temp"), Path.Combine(sdk, ".downloadIntermediates"),
            Path.Combine(sdk, "platform-tools.backup")], name: Loc.I["t.sdktmp"] + where);
    }

    private void JetBrains(string g)
    {
        var root = Path.Combine(L, "JetBrains");
        var caches = new List<string>();
        var old = new List<string>();
        var byProduct = Fs.Dirs(root)
            .Select(d => (d, m: Regex.Match(Path.GetFileName(d), @"^(?<p>[A-Za-z]+)(?<v>\d{4}\.\d+)$")))
            .Where(x => x.m.Success)
            .GroupBy(x => x.m.Groups["p"].Value);
        foreach (var prod in byProduct)
        {
            var ordered = prod.OrderByDescending(x => Version.Parse(x.m.Groups["v"].Value)).ToList();
            foreach (var x in ordered.Take(1))
                foreach (var s in new[] { "caches", "log", "tmp", "index" }) caches.Add(Path.Combine(x.d, s));
            old.AddRange(ordered.Skip(1).Select(x => x.d));
        }
        Add(g, "jbcache", Kind.Contents, caches);
        Add(g, "jbold", Kind.Remove, old, Risk.Review);
    }

    // ── VS Code and every fork of it (Cursor, Windsurf, Kiro, Antigravity, …) ──

    private void Editors()
    {
        const string g = "editors";
        foreach (var app in Fs.Dirs(R))
        {
            bool isCode = Directory.Exists(Path.Combine(app, "CachedData")) || Directory.Exists(Path.Combine(app, "CachedExtensionVSIXs"))
                       || (Directory.Exists(Path.Combine(app, "User")) && Directory.Exists(Path.Combine(app, "logs"))
                           && File.Exists(Path.Combine(app, "Local State")));
            if (!isCode) continue;
            var name = Path.GetFileName(app);
            var paths = new[] { "CachedData", "CachedExtensionVSIXs", "CachedProfilesData", "CachedConfigurations", "logs",
                    @"Crashpad\reports", @"Service Worker\CacheStorage", @"Service Worker\ScriptCache" }
                .Concat(ChromiumCacheNames).Select(s => Path.Combine(app, s));
            Add(g, "code." + name, Kind.Contents, paths, name: name + " — " + Loc.I["t.editorcache"]);
        }

        // Extension folders keep every version they ever installed; VS Code lists the
        // replaced ones in .obsolete, and only the newest of each id is loaded.
        foreach (var home in Fs.Dirs(H).Where(d => Path.GetFileName(d).StartsWith('.')))
        {
            var ext = Path.Combine(home, "extensions");
            if (!File.Exists(Path.Combine(ext, "extensions.json")) && !File.Exists(Path.Combine(ext, ".obsolete"))) continue;
            var stale = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var obs = Path.Combine(ext, ".obsolete");
                if (File.Exists(obs))
                    foreach (var p in JsonDocument.Parse(File.ReadAllText(obs)).RootElement.EnumerateObject())
                        if (p.Value.ValueKind == JsonValueKind.True) stale.Add(Path.Combine(ext, p.Name));
            }
            catch { }
            foreach (var grp in Fs.Dirs(ext).Select(d => (d, m: VersionTail.Match(Path.GetFileName(d)))).Where(x => x.m.Success)
                         .GroupBy(x => x.m.Groups["id"].Value + (x.m.Groups["rest"].Value), StringComparer.OrdinalIgnoreCase))
            {
                var ordered = grp.Select(x => (x.d, v: ParseVersion(x.m.Groups["v"].Value))).Where(x => x.v != null)
                    .OrderByDescending(x => x.v).ToList();
                foreach (var x in ordered.Skip(1)) stale.Add(x.d);
            }
            Add(g, "ext" + Path.GetFileName(home), Kind.Remove, stale.Where(Directory.Exists),
                name: string.Format(Loc.I["t.oldext"], Path.GetFileName(home)));
        }
    }

    // ── AI tools (models themselves are on their own page) ──────────────────

    private void AiCaches()
    {
        const string g = "ai";
        Add(g, "hfxet", Kind.Contents, Risk.Safe, false, Path.Combine(H, @".cache\huggingface\xet"));
        Add(g, "codexrt", Kind.Contents, Risk.Review, false, Path.Combine(H, @".cache\codex-runtimes"));
        Add(g, "opencode", Kind.Contents, Risk.Safe, false, Path.Combine(H, @".cache\opencode"));
        Add(g, "ailogs", Kind.OldFiles, [Path.Combine(L, @"Claude\logs"), Path.Combine(R, @"Claude\logs"),
            Path.Combine(L, @"claude-cli-nodejs\Cache"), Path.Combine(H, @".codex\log"), Path.Combine(H, @".gemini\tmp"),
            Path.Combine(R, @"Claude\sentry")], minAge: TimeSpan.FromDays(3));
    }

    // ── browsers and Electron apps ──────────────────────────────────────────

    private static readonly string[] ChromiumCacheNames =
    [
        "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache",
        "GraphiteDawnCache", "ShaderCache", @"Crashpad\reports",
    ];

    private static readonly string[] ProfileCacheNames =
    [
        "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
        @"Service Worker\CacheStorage", @"Service Worker\ScriptCache", "Media Cache", "Application Cache",
    ];

    private static readonly HashSet<string> SkipTop = new(StringComparer.OrdinalIgnoreCase)
    {
        "Microsoft", "Packages", "Temp", "Programs", "JetBrains", "NVIDIA", "AMD", "Intel", "D3DSCache", "CrashDumps",
        "npm-cache", "Yarn", "pnpm", "pip", "uv", "NuGet", "Docker", "wsl", "Android", "electron", "electron-builder",
    };

    private void Apps()
    {
        const string g = "apps";

        // Telegram's media cache: re-downloaded when a chat is opened again.
        Add(g, "telegram", Kind.Contents, Sub(Path.Combine(R, @"Telegram Desktop\tdata"),
            n => n.StartsWith("user_data", StringComparison.OrdinalIgnoreCase)), name: "Telegram — " + Loc.I["t.mediacache"]);
        Add(g, "spotify", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"Spotify\Storage"), Path.Combine(L, @"Spotify\Data"));
        Add(g, "steam", Kind.Contents, Risk.Safe, false, Path.Combine(L, @"Steam\htmlcache"));
        Add(g, "firefox", Kind.Contents, Sub(Path.Combine(L, @"Mozilla\Firefox\Profiles"), _ => true)
            .SelectMany(p => new[] { Path.Combine(p, "cache2"), Path.Combine(p, "startupCache"), Path.Combine(p, "thumbnails") }),
            name: "Firefox — " + Loc.I["t.browsercache"]);

        // Downloaded updates electron-updater keeps after installing them.
        Add(g, "updaters", Kind.Contents, Sub(L, n => n.EndsWith("-updater", StringComparison.OrdinalIgnoreCase)));

        // Squirrel apps (Discord, Slack, Teams classic, GitHub Desktop…) keep the previous
        // app-x.y.z folder next to the current one.
        var squirrel = new List<string>();
        foreach (var app in Fs.Dirs(L))
        {
            if (!File.Exists(Path.Combine(app, "Update.exe"))) continue;
            var vers = Sub(app, n => n.StartsWith("app-", StringComparison.OrdinalIgnoreCase))
                .Select(d => (d, v: ParseVersion(Path.GetFileName(d)))).Where(x => x.v != null).OrderByDescending(x => x.v).ToList();
            squirrel.AddRange(vers.Skip(1).Select(x => x.d));
            squirrel.AddRange(Fs.Files(Path.Combine(app, "packages")).Where(f => f.Path.EndsWith(".nupkg", StringComparison.OrdinalIgnoreCase))
                .Select(f => f.Path));
        }
        Add(g, "squirrel", Kind.Remove, squirrel);

        // Anything Chromium-shaped: browsers, Electron apps, scraper profiles. Found by the
        // "Local State" file every Chromium user-data folder has, or by its cache folders.
        foreach (var top in new[] { L, R })
            foreach (var dir in Fs.Dirs(top))
            {
                if (SkipTop.Contains(Path.GetFileName(dir))) continue;
                ChromiumAt(g, top, dir, 0);
            }
        // Edge and others under Microsoft are skipped above as a whole; take Edge back.
        ChromiumAt(g, L, Path.Combine(L, @"Microsoft\Edge"), 1);
    }

    private void ChromiumAt(string g, string top, string dir, int depth)
    {
        if (!Directory.Exists(dir)) return;
        bool isRoot = File.Exists(Path.Combine(dir, "Local State")) || ChromiumCacheNames.Take(3).Any(n => Directory.Exists(Path.Combine(dir, n)));
        if (isRoot)
        {
            var paths = new List<string>();
            paths.AddRange(ChromiumCacheNames.Select(n => Path.Combine(dir, n)));
            paths.AddRange(ProfileCacheNames.Select(n => Path.Combine(dir, n)));
            foreach (var prof in Sub(dir, n => n == "Default" || n.StartsWith("Profile ") || n is "Guest Profile" or "System Profile"))
                paths.AddRange(ProfileCacheNames.Select(n => Path.Combine(prof, n)));
            foreach (var part in Sub(Path.Combine(dir, "Partitions"), _ => true))
                paths.AddRange(ProfileCacheNames.Select(n => Path.Combine(part, n)));

            var rel = Path.GetRelativePath(top, dir).Replace(@"\User Data", "").Replace('\\', ' ');
            Add(g, "chromium." + rel, Kind.Contents, paths, name: Pretty(rel) + " — " + Loc.I["t.appcache"], glyph: "\uE774");
            return;
        }
        if (depth >= 2) return;
        foreach (var sub in Fs.Dirs(dir))
        {
            var n = Path.GetFileName(sub);
            if (n.StartsWith('.') || n.Equals("node_modules", StringComparison.OrdinalIgnoreCase)) continue;
            ChromiumAt(g, top, sub, depth + 1);
        }
    }

    private static string Pretty(string rel) => rel switch
    {
        var s when s.StartsWith("Google Chrome", StringComparison.OrdinalIgnoreCase) => "Google Chrome",
        var s when s.StartsWith("Microsoft Edge", StringComparison.OrdinalIgnoreCase) => "Microsoft Edge",
        var s when s.StartsWith("BraveSoftware", StringComparison.OrdinalIgnoreCase) => "Brave",
        _ => rel,
    };

    // ── things you put there yourself and forgot ────────────────────────────

    private void Leftovers()
    {
        const string g = "files";
        var dl = Path.Combine(H, "Downloads");
        var cutoff = DateTime.UtcNow.AddDays(-30);
        string[] exts = [".exe", ".msi", ".msix", ".msixbundle", ".appx", ".zip", ".7z", ".rar", ".iso", ".apk", ".aab", ".tar", ".gz", ".xz", ".dmg", ".img"];
        var dls = new List<string> { dl };
        foreach (var d in Projects.Crowded())
            dls.Add(Path.Combine(d.RootDirectory.FullName, "Downloads"));
        var files = dls.Distinct(StringComparer.OrdinalIgnoreCase).SelectMany(Fs.Files)
            .Where(f => f.Written < cutoff && exts.Contains(Path.GetExtension(f.Path), StringComparer.OrdinalIgnoreCase))
            .Select(f => f.Path).ToList();
        Add(g, "installers", Kind.Remove, files, Risk.Review);
        Add(g, "tgdl", Kind.Contents, Risk.Review, false, Path.Combine(dl, "Telegram Desktop"));
        Add(g, "thumbs", Kind.Contents, Risk.Safe, false, Path.Combine(H, ".thumbnails"));
    }
}
