using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rocket.Core;

/// <summary>One processor setting Rocket can raise, with whether it already is.</summary>
public sealed class Tweak : Bindable
{
    public required string Id { get; init; }
    public string Title => Loc.I["tw." + Id];
    public string Detail => Loc.I["tw." + Id + ".d"]
        + (Power.IsLaptop && Loc.I["tw." + Id + ".laptop"] is var n && !n.StartsWith("tw.") ? "  " + n : "")
        + (!Available ? "  " + Loc.I["tw." + Id + ".na"] : "");

    private bool? _active;
    /// <summary>True when the setting is already where Rocket would put it; null when unknown.</summary>
    public bool? Active { get => _active; set { if (Set(ref _active, value)) Raise(nameof(StateText)); } }
    private bool _available = true;
    public bool Available { get => _available; set { if (Set(ref _available, value)) Raise(nameof(Detail)); } }

    private bool _chosen;
    public bool Chosen { get => _chosen; set => Set(ref _chosen, value); }

    public string StateText => Active == true ? Loc.I["tw.on"] : Active == false ? "" : Loc.I["tw.unknown"];
    public void Relocalize() { Raise(nameof(Title)); Raise(nameof(Detail)); Raise(nameof(StateText)); }
}

/// <summary>A Windows service worth switching off on a build machine.</summary>
public sealed class Svc : Bindable
{
    public required string Name { get; init; }
    public string Title => Loc.I["svc." + Name];
    public string Detail => Loc.I["svc." + Name + ".d"];
    public bool Present { get; set; }
    private string _start = "";
    public string StartType { get => _start; set { if (Set(ref _start, value)) { Raise(nameof(On)); Raise(nameof(StateText)); } } }
    public bool Running { get; set; }
    public bool On => StartType != "Disabled";
    public string StateText => !Present ? Loc.I["svc.missing"] : Loc.I.F("svc.state", Loc.I["svc.start." + StartType], Running ? Loc.I["svc.running"] : Loc.I["svc.stopped"]);
    public void Relocalize() { Raise(nameof(Title)); Raise(nameof(Detail)); Raise(nameof(StateText)); }
}

/// <summary>
/// CPU and power: the plan, the processor-state settings inside it, Windows' power mode
/// overlay and the foreground priority boost — read without asking, changed through one
/// UAC prompt. The first change writes down every original value; Restore puts them all
/// back and deletes that note.
/// </summary>
public static class Power
{
    public const string Balanced = "381b4222-f694-41f0-9685-ff5bb260df2e", High = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
        Saver = "a1841308-3541-4fab-bc81-f71556f20b4a", Ultimate = "e9a42b02-d5df-448d-aa00-03f14749eb61";
    private const string Sub = "54533251-82be-4824-96c1-47b60b740d00";
    public static readonly Dictionary<string, string> Settings = new()
    {
        ["min"] = "893dee8e-2bef-41e0-89c6-b55d0929964c",
        ["max"] = "bc5038f7-23e0-4960-96da-33abaf5935ec",
        ["boost"] = "be337238-0d82-4146-a960-4f3749d470c7",
        ["minCores"] = "0cc5b647-c1df-4637-891a-dec35c318583",
        ["cooling"] = "94d3a615-a899-4ac5-ae2b-e4d8f634367f",
    };
    private static readonly Dictionary<string, string> Overlays = new()
    {
        ["max"] = "ded574b5-45a0-4f42-8737-46345c09c238", ["high"] = "3af9b8d9-7c97-431d-ad78-34a8bfea439f",
        ["saver"] = "961cc777-2547-4f9d-8174-7d86181b8a7a", ["balanced"] = "00000000-0000-0000-0000-000000000000",
    };
    public static readonly string[] TweakIds = ["plan", "max", "boost", "cores", "min", "cooling", "overlay", "foreground"];
    public static readonly string[] ServiceNames = ["SysMain", "WSearch"];
    private const int Foreground = 38;
    private static string BackupFile => Path.Combine(Core.Settings.Folder, "cpu-backup.json");

    [DllImport("kernel32.dll")] private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);
    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }

    /// <summary>A battery means a laptop (or a tablet), whatever the chassis claims.</summary>
    public static bool IsLaptop { get; } = GetSystemPowerStatus(out var s) && s.BatteryFlag != 128 && s.BatteryFlag != 255;
    public static bool OnBattery => GetSystemPowerStatus(out var s) && s.ACLineStatus == 0;

    public static string CpuName { get; } = ReadCpuName();
    public static int RatedMhz { get; } = (int)(Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "~MHz", 0) ?? 0);

    private static string ReadCpuName()
    {
        var n = Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString", "")?.ToString() ?? "";
        return Regex.Replace(n.Replace("(R)", "").Replace("(TM)", ""), @"\s+CPU\s+@.*$|\s{2,}", " ").Trim();
    }

    // ── reading ─────────────────────────────────────────────────────────────

    public sealed record State(List<(string Guid, string Name)> Schemes, string Active, Dictionary<string, (int? Ac, int? Dc)> Values,
        string Overlay, int? Separation, Dictionary<string, (bool Present, string Start, bool Running)> Services)
    {
        public string ActiveName => Schemes.FirstOrDefault(s => s.Guid == Active).Name ?? Active;
        public string PerformancePlan => Schemes.Any(s => s.Guid == Ultimate) ? Ultimate : High;
    }

    public static State Read()
    {
        var schemes = new List<(string, string)>();
        string active = Balanced;
        foreach (Match m in Regex.Matches(Ps.Run("powercfg.exe", "/list"), @"GUID:\s*([0-9a-f-]{36})\s+\((.+?)\)\s*(\*)?\s*$",
                     RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            schemes.Add((m.Groups[1].Value.ToLowerInvariant(), m.Groups[2].Value.Trim()));
            if (m.Groups[3].Success) active = m.Groups[1].Value.ToLowerInvariant();
        }
        var values = Settings.ToDictionary(kv => kv.Key, kv => ValueOf(active, kv.Value));

        string overlay = "unsupported";
        var ov = Regex.Match(Ps.Run("powercfg.exe", "/getactiveoverlayscheme"), "[0-9a-f-]{36}", RegexOptions.IgnoreCase);
        if (ov.Success) overlay = Overlays.FirstOrDefault(kv => kv.Value.Equals(ov.Value, StringComparison.OrdinalIgnoreCase)).Key ?? "balanced";

        var sep = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\PriorityControl", "Win32PrioritySeparation", null) as int?;
        var services = ServiceNames.ToDictionary(n => n, ReadService);
        return new State(schemes, active, values, overlay, sep, services);
    }

    /// <summary>A processor setting's AC/DC index in a scheme: the user's override, else the scheme default, else powercfg's word.</summary>
    public static (int? Ac, int? Dc) ValueOf(string scheme, string setting)
    {
        int? Reg(string path, string name) => Registry.GetValue(@"HKEY_LOCAL_MACHINE\" + path, name, null) as int?;
        var user = $@"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes\{scheme}\{Sub}\{setting}";
        int? ac = Reg(user, "ACSettingIndex"), dc = Reg(user, "DCSettingIndex");
        var def = $@"SYSTEM\CurrentControlSet\Control\Power\PowerSettings\{Sub}\{setting}\DefaultPowerSchemeValues\{scheme}";
        ac ??= Reg(def, "AcSettingIndex");
        dc ??= Reg(def, "DcSettingIndex");
        if (ac is null || dc is null)
        {
            var q = Ps.Run("powercfg.exe", $"/q {scheme} {Sub} {setting}");
            var a = Regex.Match(q, @"Current AC Power Setting Index:\s*0x([0-9a-f]+)", RegexOptions.IgnoreCase);
            var d = Regex.Match(q, @"Current DC Power Setting Index:\s*0x([0-9a-f]+)", RegexOptions.IgnoreCase);
            if (ac is null && a.Success) ac = Convert.ToInt32(a.Groups[1].Value, 16);
            if (dc is null && d.Success) dc = Convert.ToInt32(d.Groups[1].Value, 16);
        }
        return (ac, dc);
    }

    private static (bool, string, bool) ReadService(string name)
    {
        using var k = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{name}");
        if (k is null) return (false, "Missing", false);
        var start = (k.GetValue("Start") as int?) switch { 2 => "Automatic", 3 => "Manual", 4 => "Disabled", _ => "Manual" };
        bool running = Ps.Run("sc.exe", $"query {name}").Contains("RUNNING");
        return (true, start, running);
    }

    /// <summary>Whether each tweak already holds, from a fresh state.</summary>
    public static void Evaluate(State s, IEnumerable<Tweak> tweaks)
    {
        foreach (var t in tweaks)
        {
            var v = s.Values;
            t.Available = t.Id != "overlay" || s.Overlay != "unsupported";
            t.Active = t.Id switch
            {
                "plan" => s.Active is High or Ultimate,
                "max" => v["max"].Ac is null ? null : v["max"].Ac >= 100 && (!IsLaptop || v["max"].Dc is null || v["max"].Dc >= 100),
                "boost" => v["boost"].Ac is null ? null : v["boost"].Ac >= 2,
                "cores" => v["minCores"].Ac is null ? null : v["minCores"].Ac >= 100,
                "min" => v["min"].Ac is null ? null : v["min"].Ac >= 100,
                "cooling" => v["cooling"].Ac is null ? null : v["cooling"].Ac == 1,
                "overlay" => s.Overlay == "unsupported" ? null : s.Overlay == "max",
                "foreground" => s.Separation is null ? null : s.Separation == Foreground,
                _ => null,
            };
        }
    }

    /// <summary>What Rocket ticks for you: everything that helps, minus what costs a laptop its battery.</summary>
    public static bool Recommended(string id) => IsLaptop ? id is "max" or "boost" or "cooling" or "overlay" or "foreground"
                                                            : id is not "min";

    // ── changing ────────────────────────────────────────────────────────────

    public static async Task<(bool Ok, string Message)> Apply(IEnumerable<string> ids)
    {
        var want = TweakIds.Where(ids.Contains).ToList();
        if (want.Count == 0) return (false, "");
        var before = Read();
        var target = want.Contains("plan") ? before.PerformancePlan : before.Active;
        await WriteBackup(before, target);

        var lines = new List<string>();
        string pc(string args) => $"cmd.exe /d /c \"powercfg {args} 2>nul\"";
        string set(string ac, string key, int value) => pc($"/set{ac}valueindex SCHEME_CURRENT {Sub} {Settings[key]} {value}");
        foreach (var id in want)
        {
            switch (id)
            {
                case "plan": lines.Add(pc($"/setactive {before.PerformancePlan}")); break;
                case "max": lines.Add(set("ac", "max", 100)); lines.Add(set("dc", "max", 100)); break;
                case "boost":
                    lines.Add(pc($"-attributes {Sub} {Settings["boost"]} -ATTRIB_HIDE"));
                    lines.Add(set("ac", "boost", 2));
                    if (IsLaptop && before.Values["boost"].Dc == 0) lines.Add(set("dc", "boost", 1));
                    break;
                case "cores": lines.Add(pc($"-attributes {Sub} {Settings["minCores"]} -ATTRIB_HIDE")); lines.Add(set("ac", "minCores", 100)); break;
                case "min": lines.Add(set("ac", "min", 100)); break;
                case "cooling": lines.Add(set("ac", "cooling", 1)); if (IsLaptop) lines.Add(set("dc", "cooling", 1)); break;
                case "overlay": lines.Add($"try {{ & powercfg /overlaysetactive {Overlays["max"]} 2>&1 | Out-Null }} catch {{ }}"); break;
                case "foreground":
                    lines.Add($"Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name Win32PrioritySeparation -Value {Foreground} -Type DWord");
                    break;
            }
        }
        // Values inside a plan only take effect when the plan is activated again.
        if (want.Any(i => i is not "overlay" and not "foreground")) lines.Add(pc("/setactive SCHEME_CURRENT"));

        var r = await Elevated.PowerShell(string.Join("\n", lines));
        if (r.Refused) return (false, Loc.I["admin.refused"]);
        var after = Read();
        var check = want.Select(i => new Tweak { Id = i }).ToList();
        Evaluate(after, check);
        bool ok = check.Any(t => t.Active == true);
        return (ok, ok ? "" : Loc.I["tw.notrecorded"]);
    }

    public static async Task<(bool Ok, string Message)> SetService(string name, bool on)
    {
        if (!ServiceNames.Contains(name)) return (false, "");
        await WriteBackup(Read(), null);
        var r = await Elevated.PowerShell(on
            ? $"Set-Service -Name {name} -StartupType Automatic\nStart-Service -Name {name} -ErrorAction SilentlyContinue"
            : $"Set-Service -Name {name} -StartupType Disabled\nStop-Service -Name {name} -Force -ErrorAction SilentlyContinue");
        if (r.Refused) return (false, Loc.I["admin.refused"]);
        var (_, start, _) = ReadService(name);
        bool ok = on ? start == "Automatic" : start == "Disabled";
        return (ok, ok ? "" : Loc.I["tw.notrecorded"]);
    }

    // ── backup and restore ──────────────────────────────────────────────────

    public static DateTime? BackupAt
    {
        get
        {
            try { return File.Exists(BackupFile) ? JsonDocument.Parse(File.ReadAllText(BackupFile)).RootElement.GetProperty("at").GetDateTime() : null; }
            catch { return null; }
        }
    }

    /// <summary>Records the original settings — only the first time; later changes keep that first note.</summary>
    private static async Task WriteBackup(State before, string? targetScheme)
    {
        if (File.Exists(BackupFile)) return;
        var scheme = targetScheme ?? before.Active;
        var values = scheme == before.Active ? before.Values : Settings.ToDictionary(kv => kv.Key, kv => ValueOf(scheme, kv.Value));
        var doc = new
        {
            at = DateTime.UtcNow,
            activeScheme = before.Active,
            modifiedScheme = scheme,
            values = values.ToDictionary(kv => kv.Key, kv => new { ac = kv.Value.Ac, dc = kv.Value.Dc }),
            overlay = before.Overlay,
            prioritySeparation = before.Separation,
            services = before.Services.Where(s => s.Value.Present).ToDictionary(s => s.Key, s => s.Value.Start),
        };
        Directory.CreateDirectory(Core.Settings.Folder);
        await File.WriteAllTextAsync(BackupFile, JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }));
    }

    public static async Task<(bool Ok, string Message)> Restore()
    {
        if (!File.Exists(BackupFile)) return (false, "");
        var b = JsonDocument.Parse(await File.ReadAllTextAsync(BackupFile)).RootElement;
        var lines = new List<string>();
        string pc(string args) => $"cmd.exe /d /c \"powercfg {args} 2>nul\"";
        var scheme = b.S("modifiedScheme");
        if (Regex.IsMatch(scheme, "^[0-9a-f-]{36}$") && b.TryGetProperty("values", out var vals))
            foreach (var (key, guid) in Settings)
                if (vals.TryGetProperty(key, out var v))
                {
                    if (v.TryGetProperty("ac", out var ac) && ac.ValueKind == JsonValueKind.Number) lines.Add(pc($"/setacvalueindex {scheme} {Sub} {guid} {Math.Max(0, ac.GetInt32())}"));
                    if (v.TryGetProperty("dc", out var dc) && dc.ValueKind == JsonValueKind.Number) lines.Add(pc($"/setdcvalueindex {scheme} {Sub} {guid} {Math.Max(0, dc.GetInt32())}"));
                }
        var active = b.S("activeScheme");
        if (Regex.IsMatch(active, "^[0-9a-f-]{36}$")) lines.Add(pc($"/setactive {active}"));
        if (Overlays.TryGetValue(b.S("overlay"), out var og)) lines.Add($"try {{ & powercfg /overlaysetactive {og} 2>&1 | Out-Null }} catch {{ }}");
        if (b.TryGetProperty("prioritySeparation", out var ps) && ps.ValueKind == JsonValueKind.Number)
            lines.Add($"Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name Win32PrioritySeparation -Value {ps.GetInt32()} -Type DWord");
        if (b.TryGetProperty("services", out var svc))
            foreach (var p in svc.EnumerateObject())
                if (ServiceNames.Contains(p.Name) && p.Value.GetString() is "Automatic" or "Manual" or "Disabled")
                {
                    lines.Add($"Set-Service -Name {p.Name} -StartupType {p.Value.GetString()}");
                    if (p.Value.GetString() == "Automatic") lines.Add($"Start-Service -Name {p.Name} -ErrorAction SilentlyContinue");
                }
        var r = await Elevated.PowerShell(string.Join("\n", lines));
        if (r.Refused) return (false, Loc.I["admin.refused"]);
        if (!r.Ok) return (false, r.Output);
        try { File.Delete(BackupFile); } catch { }
        return (true, "");
    }
}
