using System.IO;

namespace Rocket.Core;

/// <summary>A folder Defender should stop scanning on every write.</summary>
public sealed class Exclusion : Bindable
{
    public required string Path { get; init; }
    public required string LabelKey { get; init; }
    public string Label => Loc.I[LabelKey];
    private bool? _covered;
    /// <summary>Already excluded; null when Windows would not say (it hides the list from non-admins).</summary>
    public bool? Covered { get => _covered; set { if (Set(ref _covered, value)) Raise(nameof(StateText)); } }
    private bool _chosen;
    public bool Chosen { get => _chosen; set => Set(ref _chosen, value); }
    public string StateText => Covered == true ? Loc.I["def.covered"] : Covered == false ? Loc.I["def.scanned"] : Loc.I["def.unknownstate"];
    public void Relocalize() { Raise(nameof(Label)); Raise(nameof(StateText)); }
}

/// <summary>
/// Defender's cost on a build machine: every file npm, Gradle or a compiler writes into an
/// unexcluded cache is opened and scanned. This reads Defender's state and the exclusion
/// list, offers the developer cache folders that exist here, and adds them through one
/// UAC prompt. Real-time protection itself is left alone unless asked, twice.
/// </summary>
public static class Defender
{
    public sealed record Info(bool Available, bool RealTime, bool? Tamper, long MemoryMb, bool Running,
        List<string>? Exclusions, int CpuCap, bool OnlyIdle, bool ScanRunning);

    private static readonly (string Path, string Label)[] Candidates =
    [
        (@"%LOCALAPPDATA%\Temp", "def.temp"),
        (@"%APPDATA%\npm-cache", "def.npm"), (@"%LOCALAPPDATA%\npm-cache", "def.npm"), (@"%USERPROFILE%\.npm", "def.npm"),
        (@"%LOCALAPPDATA%\Yarn\Cache", "def.yarn"), (@"%LOCALAPPDATA%\pnpm", "def.pnpm"),
        (@"%USERPROFILE%\.gradle", "def.gradle"), (@"%USERPROFILE%\.m2", "def.maven"), (@"%USERPROFILE%\.cargo", "def.cargo"),
        (@"%USERPROFILE%\.nuget", "def.nuget"), (@"%APPDATA%\Docker", "def.docker"), (@"%LOCALAPPDATA%\Docker", "def.docker"),
        (@"%USERPROFILE%\.vscode\extensions", "def.vscode"), (@"%LOCALAPPDATA%\Programs", "def.programs"),
    ];

    public static async Task<Info> Read()
    {
        var j = await Ps.Json("""
            $p = Get-MpPreference
            $s = Get-MpComputerStatus
            $m = Get-Process MsMpEng -ErrorAction SilentlyContinue | Select-Object -First 1
            [pscustomobject]@{
              available = [bool]($p -and $s)
              realTime = [bool]$s.RealTimeProtectionEnabled
              tamper = if ($s.PSObject.Properties['IsTamperProtected']) { [bool]$s.IsTamperProtected } else { $null }
              exclusions = @($p.ExclusionPath | Where-Object { $_ })
              cpuCap = [int]$p.ScanAvgCPULoadFactor
              onlyIdle = [bool]$p.ScanOnlyIfIdleEnabled
              scanRunning = [bool]($s.QuickScanInProgress -or $s.FullScanInProgress)
              running = [bool]$m
              memoryMb = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
            }
            """, 60);
        if (j is not { } e) return new Info(false, false, null, 0, false, null, 0, false, false);
        // Without admin rights Windows answers with a placeholder instead of the list.
        var ex = e.A("exclusions").Select(x => x.ToString()).ToList();
        List<string>? list = ex.Any(x => x.StartsWith("N/A", StringComparison.OrdinalIgnoreCase)) ? null : ex;
        bool? tamper = e.TryGetProperty("tamper", out var t) && t.ValueKind is System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False ? t.GetBoolean() : null;
        return new Info(e.B("available"), e.B("realTime"), tamper, e.L("memoryMb"), e.B("running"), list,
            (int)e.L("cpuCap"), e.B("onlyIdle"), e.B("scanRunning"));
    }

    public static List<Exclusion> Suggestions(Info info)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<Exclusion>();
        foreach (var (raw, label) in Candidates)
        {
            var p = System.IO.Path.GetFullPath(Environment.ExpandEnvironmentVariables(raw)).TrimEnd('\\');
            if (!Directory.Exists(p) || !seen.Add(p)) continue;
            var x = new Exclusion { Path = p, LabelKey = label, Covered = info.Exclusions is null ? null : IsCovered(p, info.Exclusions) };
            x.Chosen = x.Covered != true;
            list.Add(x);
        }
        return list;
    }

    public static bool IsCovered(string path, IEnumerable<string> exclusions)
    {
        var p = path.TrimEnd('\\');
        foreach (var raw in exclusions)
        {
            var x = Environment.ExpandEnvironmentVariables(raw).TrimEnd('\\');
            if (p.Equals(x, StringComparison.OrdinalIgnoreCase) || p.StartsWith(x + "\\", StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    public static async Task<Elevated.Result> Exclude(IEnumerable<string> paths, bool remove = false)
    {
        var verb = remove ? "Remove-MpPreference" : "Add-MpPreference";
        var lines = paths.Where(p => remove || Directory.Exists(p)).Take(40).Select(p => $"{verb} -ExclusionPath {Elevated.Q(p)}");
        return await Elevated.PowerShell(string.Join("\n", lines));
    }

    public static Task<Elevated.Result> SetRealTime(bool on)
        => Elevated.PowerShell($"Set-MpPreference -DisableRealtimeMonitoring ${(!on).ToString().ToLowerInvariant()}");
}
