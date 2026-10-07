using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rocket.Core;

/// <summary>An installed program, from Add/Remove or the Store.</summary>
public sealed class Program : Bindable
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string Publisher { get; init; } = "";
    public string Version { get; init; } = "";
    public DateTime? Installed { get; init; }
    public bool Store { get; init; }
    public bool Machine { get; init; }
    public string? KeyPath { get; init; }
    public string? InstallLocation { get; init; }
    public string? Uninstall { get; init; }
    public string? QuietUninstall { get; init; }
    public bool IsMsi { get; init; }
    public bool Dependency { get; init; }
    public string? Package { get; init; }

    private long _bytes;
    public long Bytes { get => _bytes; set { if (Set(ref _bytes, value)) Raise(nameof(SizeText)); } }
    public bool Measured { get; set; }

    private string _state = "";
    /// <summary>"", "removing", "removed", "failed".</summary>
    public string State { get => _state; set => Set(ref _state, value); }

    public bool HasUninstaller => Store || !string.IsNullOrWhiteSpace(Uninstall) || !string.IsNullOrWhiteSpace(QuietUninstall);
    public string Display => Format.Ltr(Name);
    public string Sub => string.Join("  ·  ", new[] { Publisher, Version }.Where(s => s.Length > 0));
    public string SizeText => Bytes > 0 ? Format.Bytes(Bytes) : "—";
    public string DateText => Installed?.ToString("yyyy-MM-dd") ?? "";
}

/// <summary>
/// Installed programs: listing, sizing, uninstalling (always with the command read fresh
/// from the registry, never a cached one), forcing a dead entry out of the list, and
/// finding the folders a program leaves behind once it is gone.
/// </summary>
public static class Programs
{
    private static readonly (RegistryKey Hive, string Path, bool Machine, string Arch)[] Roots =
    [
        (Registry.LocalMachine, @"Software\Microsoft\Windows\CurrentVersion\Uninstall", true, "x64"),
        (Registry.LocalMachine, @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", true, "x86"),
        (Registry.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\Uninstall", false, "x64"),
    ];

    private static readonly Regex DependencyRx = new(
        @"visual c\+\+|\.net (framework|runtime|sdk|core)|redistributable|runtime|\bsdk\b|driver|chipset|graphics|realtek|intel\(r\)|nvidia|amd (software|radeon|chipset)|windows (sdk|software development kit)|webview2|edge update|java \d|directx",
        RegexOptions.IgnoreCase);

    public static List<Program> Desktop()
    {
        var list = new List<Program>();
        foreach (var (hive, path, machine, arch) in Roots)
        {
            using var root = hive.OpenSubKey(path);
            if (root is null) continue;
            foreach (var sub in root.GetSubKeyNames())
            {
                try
                {
                    using var k = root.OpenSubKey(sub);
                    if (k is null) continue;
                    var name = (k.GetValue("DisplayName") as string)?.Trim();
                    if (string.IsNullOrEmpty(name)) continue;
                    if (k.GetValue("SystemComponent") is int sc && sc == 1) continue;
                    if (!string.IsNullOrEmpty(k.GetValue("ParentKeyName") as string)) continue;
                    if (Regex.IsMatch(k.GetValue("ReleaseType") as string ?? "", "Update|Hotfix|Security Update")) continue;
                    if (Regex.IsMatch(name, "^(Update for|Security Update for|Hotfix for) ")) continue;
                    var publisher = (k.GetValue("Publisher") as string ?? "").Trim();
                    var un = k.GetValue("UninstallString") as string;
                    DateTime? date = DateTime.TryParseExact(k.GetValue("InstallDate") as string ?? "", "yyyyMMdd", null,
                        System.Globalization.DateTimeStyles.None, out var d) ? d : null;
                    long size = k.GetValue("EstimatedSize") is int kb ? kb * 1024L : 0;
                    list.Add(new Program
                    {
                        Id = $"{(machine ? "machine" : "user")}:{arch}:{sub}", Name = name, Publisher = publisher,
                        Version = (k.GetValue("DisplayVersion") as string ?? "").Trim(), Installed = date, Machine = machine,
                        KeyPath = $@"{(machine ? "HKEY_LOCAL_MACHINE" : "HKEY_CURRENT_USER")}\{path}\{sub}",
                        InstallLocation = (k.GetValue("InstallLocation") as string)?.Trim().Trim('"'),
                        Uninstall = un, QuietUninstall = k.GetValue("QuietUninstallString") as string,
                        IsMsi = k.GetValue("WindowsInstaller") is int wi && wi == 1 || Regex.IsMatch(un ?? "", @"^\s*""?msiexec", RegexOptions.IgnoreCase),
                        Dependency = DependencyRx.IsMatch(name + " " + publisher),
                        Bytes = size, Measured = size > 0,
                    });
                }
                catch { }
            }
        }
        return list;
    }

    /// <summary>Store apps that have a Start menu entry — the ones a person installed.</summary>
    public static async Task<List<Program>> StoreApps()
    {
        var j = await Ps.Json("""
            $start = @{}
            foreach ($a in (Get-StartApps)) { $fam = ($a.AppID -split '!')[0]; if (-not $start.ContainsKey($fam)) { $start[$fam] = $a.Name } }
            Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.IsResourcePackage -and -not $_.NonRemovable -and $_.SignatureKind -ne 'System' } |
              Where-Object { $start.Count -eq 0 -or $start.ContainsKey($_.PackageFamilyName) } |
              ForEach-Object {
                $pub = ($_.Publisher -replace '^CN=([^,]+).*$', '$1')
                [pscustomobject]@{ name = $(if ($start[$_.PackageFamilyName]) { $start[$_.PackageFamilyName] } else { $_.Name });
                  pkg = $_.PackageFullName; version = [string]$_.Version; publisher = $pub; location = $_.InstallLocation }
              }
            """, 120);
        var list = new List<Program>();
        if (j is { } e)
            foreach (var x in e.A())
                list.Add(new Program
                {
                    Id = "store:" + x.S("pkg"), Name = x.S("name"), Publisher = x.S("publisher"), Version = x.S("version"),
                    Store = true, Package = x.S("pkg"), InstallLocation = x.S("location"),
                });
        return list;
    }

    /// <summary>Sizes for programs that did not report one, from their install folder.</summary>
    public static void Measure(Program p, CancellationToken ct)
    {
        if (p.Measured || string.IsNullOrEmpty(p.InstallLocation) || !Directory.Exists(p.InstallLocation)) return;
        if (p.InstallLocation.TrimEnd('\\').Length <= 3) return;
        try { p.Bytes = Fs.Measure(p.InstallLocation, ct).Bytes; p.Measured = true; } catch { }
    }

    // ── uninstall ──────────────────────────────────────────────────────────

    public sealed record Outcome(bool Removed, string Message, bool CanForce = false);

    /// <summary>Runs the program's own uninstaller and checks the registry afterwards.</summary>
    public static async Task<Outcome> Uninstall(Program p, bool quiet)
    {
        if (p.Store)
        {
            var r = await Ps.Json($"Remove-AppxPackage -Package {Elevated.Q(p.Package!)}; 'ok'", 300);
            var still = (await StoreApps()).Any(x => x.Package == p.Package);
            return new Outcome(!still, still ? Loc.I["prog.notremoved"] : "");
        }

        // Read the command again: never run something a stale list remembered.
        var fresh = Desktop().FirstOrDefault(x => x.Id == p.Id);
        if (fresh is null) return new Outcome(true, "");
        var (file, args) = Plan(fresh, quiet);
        if (file is null) return new Outcome(false, Loc.I["prog.nouninstaller"], CanForce: true);
        if (!file.Equals("msiexec.exe", StringComparison.OrdinalIgnoreCase) && !File.Exists(file))
            return new Outcome(false, Loc.I.F("prog.missing", file), CanForce: true);

        if (!fresh.Machine && !fresh.IsMsi)
        {
            try
            {
                using var proc = Process.Start(new ProcessStartInfo(file, args) { UseShellExecute = true })!;
                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(15));
                await proc.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException) { return new Outcome(false, Loc.I["prog.stillrunning"]); }
            catch (Exception ex) { return new Outcome(false, ex.Message); }
        }
        else
        {
            var line = $"Start-Process -FilePath {Elevated.Q(file)}" + (args.Length > 0 ? $" -ArgumentList {Elevated.Q(args)}" : "") + " -Wait";
            var r = await Elevated.PowerShell(line);
            if (r.Refused) return new Outcome(false, Loc.I["admin.refused"]);
        }
        bool gone = Desktop().All(x => x.Id != p.Id);
        return new Outcome(gone, gone ? "" : Loc.I["prog.notremoved"]);
    }

    private static (string? File, string Args) Plan(Program p, bool quiet)
    {
        if (p.IsMsi && Regex.Match(p.Uninstall ?? "", @"\{[0-9A-Fa-f-]{36}\}") is { Success: true } g)
            return ("msiexec.exe", $"/x {g.Value}" + (quiet ? " /passive" : ""));
        var cmd = (quiet && !string.IsNullOrWhiteSpace(p.QuietUninstall) ? p.QuietUninstall : p.Uninstall)?.Trim();
        if (string.IsNullOrEmpty(cmd)) return (null, "");
        cmd = Environment.ExpandEnvironmentVariables(cmd);
        if (cmd.StartsWith('"'))
        {
            int end = cmd.IndexOf('"', 1);
            return end > 1 ? (cmd[1..end], cmd[(end + 1)..].Trim()) : (null, "");
        }
        var m = Regex.Match(cmd, @"^(.*?\.exe)\b\s*(.*)$", RegexOptions.IgnoreCase);
        if (m.Success) return (m.Groups[1].Value, m.Groups[2].Value);
        int sp = cmd.IndexOf(' ');
        return sp < 0 ? (cmd, "") : (cmd[..sp], cmd[(sp + 1)..]);
    }

    /// <summary>Takes a program with no working uninstaller out of the list. Its files are not touched.</summary>
    public static async Task<Outcome> ForceRemove(Program p)
    {
        if (p.Store || p.KeyPath is null) return new Outcome(false, "");
        if (!Regex.IsMatch(p.KeyPath, @"^HKEY_(LOCAL_MACHINE|CURRENT_USER)\\Software\\(WOW6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\]+$", RegexOptions.IgnoreCase))
            return new Outcome(false, "");
        if (!p.Machine)
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(p.KeyPath["HKEY_CURRENT_USER\\".Length..], false);
                return new Outcome(true, "");
            }
            catch (Exception ex) { return new Outcome(false, ex.Message); }
        }
        var r = await Elevated.PowerShell($"Remove-Item -Path {Elevated.Q("Registry::" + p.KeyPath)} -Recurse");
        if (r.Refused) return new Outcome(false, Loc.I["admin.refused"]);
        bool gone = Desktop().All(x => x.Id != p.Id);
        return new Outcome(gone, gone ? "" : r.Output);
    }

    // ── leftovers ──────────────────────────────────────────────────────────

    private static readonly HashSet<string> SharedPublisherDirs = new(StringComparer.OrdinalIgnoreCase)
        { "microsoft", "google", "adobe", "common files", "windows", "packages", "programs", "temp", "jetbrains", "mozilla" };

    private static readonly HashSet<string> ProtectedDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "microsoft", "windows", "windowsapps", "common files", "internet explorer", "windows defender", "windows nt", "packages",
        "temp", "programs", "microsoft shared", "system32", "desktop", "documents", "downloads", "pictures", "videos", "music",
        "onedrive", "appdata", ".ssh", ".gnupg", "contacts", "favorites", "links", "saved games", "searches", "rocket",
    };

    private static readonly HashSet<string> Stop = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "for", "and", "app", "desktop", "application", "setup", "edition", "version", "windows", "pro", "free", "client",
        "tool", "tools", "suite", "software", "installer", "launcher", "user", "machine", "current", "latest", "stable", "beta",
        "preview", "microsoft",
    };

    private static string Normalise(string s)
    {
        s = s.ToLowerInvariant();
        s = Regex.Replace(s, @"\((x64|x86|64-bit|32-bit)\)|64-bit|32-bit|\bx64\b|\bx86\b", " ");
        s = Regex.Replace(s, @"\bv?\d+(\.\d+)+\b", " ");
        return Regex.Replace(s, "[^a-z0-9]+", " ").Trim();
    }

    /// <summary>
    /// Folders named after a program that is gone: in AppData, ProgramData, Program Files
    /// and dot-folders in the home folder. Publisher folders shared by many programs are
    /// looked into, never offered whole.
    /// </summary>
    public static List<Item> Leftovers(Program p)
    {
        var full = Normalise(p.Name).Replace(" ", "");
        var tokens = Normalise(p.Name).Split(' ').Where(t => t.Length >= 4 && t.Any(char.IsLetter) && !Stop.Contains(t)).ToList();
        var publisher = Normalise(p.Publisher).Replace(" ", "");
        bool Match(string dirName)
        {
            var d = Normalise(dirName);
            if (d.Length == 0 || ProtectedDirs.Contains(d) || ProtectedDirs.Contains(dirName)) return false;
            var c = d.Replace(" ", "");
            return c == full || tokens.Any(t => c == t || (t.Length >= 5 && c.Contains(t) && c.Length <= t.Length + 8));
        }

        var found = new List<(string Path, string Why)>();
        var install = p.InstallLocation?.TrimEnd('\\');
        if (!string.IsNullOrEmpty(install) && Directory.Exists(install) && install.Split('\\').Length >= 3
            && !ProtectedDirs.Contains(Path.GetFileName(install)))
            found.Add((install, "prog.lo.install"));

        if (tokens.Count > 0 || full.Length >= 4)
        {
            var roots = new List<(string Dir, bool DotOnly)>
            {
                (Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), false),
                (Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), false),
                (Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"), false),
                (Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), false),
                (Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), false),
                (Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), false),
                (Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), true),
            };
            foreach (var (dir, dotOnly) in roots.Where(r => Directory.Exists(r.Dir)).DistinctBy(r => r.Dir.ToLowerInvariant()))
                foreach (var sub in Fs.Dirs(dir))
                {
                    var n = Path.GetFileName(sub);
                    if (dotOnly && !n.StartsWith('.')) continue;
                    bool shared = SharedPublisherDirs.Contains(n) || (publisher.Length > 0 && Normalise(n).Replace(" ", "") == publisher && !Match(n));
                    if (shared)
                    {
                        foreach (var deeper in Fs.Dirs(sub)) if (Match(Path.GetFileName(deeper))) found.Add((deeper, "prog.lo.data"));
                        continue;
                    }
                    if (Match(n)) found.Add((sub, "prog.lo.data"));
                }
        }

        var items = new List<Item>();
        foreach (var (path, why) in found.DistinctBy(f => f.Path.ToLowerInvariant()))
        {
            if (!Guard.MayDeleteFromMap(path) && !path.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), StringComparison.OrdinalIgnoreCase)
                && !path.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), StringComparison.OrdinalIgnoreCase)) continue;
            var it = new Item
            {
                Id = "lo." + path, Group = "leftovers", Kind = Kind.Remove, Risk = Risk.Review, Paths = [path], Name = Path.GetFileName(path),
                Note = Loc.I[why], Admin = !IsWritable(path),
            };
            it.Bytes = Fs.Measure(path).Bytes;
            it.IsChecked = !it.Locked;
            items.Add(it);
        }
        return items.Where(i => i.Bytes > 0).OrderByDescending(i => i.Bytes).ToList();
    }

    private static bool IsWritable(string path)
    {
        var pf = new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.CommonApplicationData }
            .Select(Environment.GetFolderPath);
        return Native.IsAdmin || !pf.Any(r => path.StartsWith(r, StringComparison.OrdinalIgnoreCase));
    }
}
