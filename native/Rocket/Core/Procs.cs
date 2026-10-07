using System.Diagnostics;

namespace Rocket.Core;

/// <summary>A row on the Processes page: every instance of one program, or one dev process on its own.</summary>
public sealed class ProcRow : Bindable
{
    public required string Key { get; init; }
    public required string Name { get; init; }
    public required string Group { get; init; }
    public bool Protected { get; init; }
    public List<int> Pids { get; set; } = [];

    private double _cpu;
    public double Cpu { get => _cpu; set { if (Set(ref _cpu, value)) { Raise(nameof(CpuText)); Raise(nameof(CpuBar)); } } }
    private long _mem;
    public long Memory { get => _mem; set { if (Set(ref _mem, value)) Raise(nameof(MemText)); } }
    private int _count;
    public int Count { get => _count; set { if (Set(ref _count, value)) Raise(nameof(Title)); } }
    private string _detail = "";
    public string Detail { get => _detail; set => Set(ref _detail, value); }
    private int _priority;
    /// <summary>Index into <see cref="Procs.Priorities"/>.</summary>
    public int Priority { get => _priority; set => Set(ref _priority, value); }
    public string? Path { get; set; }

    public string Title => Format.Ltr(Name + (Count > 1 ? $"  ×{Count}" : ""));
    public string CpuText => Cpu >= 0.001 ? (Cpu * 100).ToString(Cpu < 0.1 ? "0.0" : "0") + "%" : "—";
    public double CpuBar => Math.Max(0, Math.Min(1, Cpu)) * 60;
    public string MemText => Format.Bytes(Memory);
    public string Glyph => Procs.GlyphOf(Group);
    public bool CanAct => !Protected;
}

/// <summary>Which processes belong together, which are untouchable, and acting on them.</summary>
public static class Procs
{
    public static readonly string[] Groups = ["all", "node", "build", "editor", "browser", "security", "system", "other"];

    private static readonly Dictionary<string, string> GroupOf = Build();

    private static Dictionary<string, string> Build()
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        void Add(string g, params string[] names) { foreach (var n in names) d.TryAdd(n, g); }
        Add("node", "node", "npm", "npx", "yarn", "pnpm", "bun", "deno", "esbuild", "tsserver", "rollup", "nodemon", "vite", "turbo");
        Add("build", "java", "javaw", "gradle", "kotlin-daemon", "adb", "qemu-system-x86_64", "emulator", "msbuild", "cl", "link",
            "dotnet", "php", "python", "pythonw", "go", "cargo", "rustc", "docker", "com.docker.backend", "vmmem", "vmmemWSL", "wsl", "wslhost");
        Add("editor", "code", "cursor", "windsurf", "kiro", "antigravity", "devenv", "idea64", "studio64", "phpstorm64", "webstorm64",
            "pycharm64", "rider64", "sublime_text", "notepad++", "claude", "electron");
        Add("browser", "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "msedgewebview2");
        Add("security", "msmpeng", "nissrv", "securityhealthservice", "securityhealthsystray", "mpcmdrun", "mssense", "avp", "avgui", "mpdefendercoreservice");
        Add("system", "system", "idle", "registry", "memory compression", "smss", "csrss", "wininit", "winlogon", "services", "lsass",
            "svchost", "dwm", "explorer", "fontdrvhost", "sihost", "ctfmon", "audiodg", "runtimebroker", "searchhost",
            "startmenuexperiencehost", "shellexperiencehost", "taskhostw", "wmiprvse", "conhost", "dllhost", "spoolsv",
            "searchindexer", "wudfhost", "powershell", "pwsh", "cmd", "textinputhost", "lockapp", "searchprotocolhost",
            "searchfilterhost", "smartscreen", "sgrmbroker", "dashost", "useroobebroker", "applicationframehost");
        return d;
    }

    /// <summary>Never ended, never re-prioritised: Windows itself and the antivirus core.</summary>
    private static readonly HashSet<string> Untouchable = new(StringComparer.OrdinalIgnoreCase)
    {
        "system", "idle", "registry", "memory compression", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "lsaiso",
        "fontdrvhost", "dwm", "sihost", "ctfmon", "audiodg", "wudfhost", "securityhealthservice", "msmpeng", "nissrv",
    };

    /// <summary>Dev runtimes listed one process per row, with their command line — which dev server is which.</summary>
    public static readonly HashSet<string> Detailed = new(StringComparer.OrdinalIgnoreCase) { "node", "java", "javaw", "bun", "deno", "python", "pythonw", "php", "dotnet" };

    public static readonly System.Diagnostics.ProcessPriorityClass[] Priorities =
    [
        ProcessPriorityClass.Idle, ProcessPriorityClass.BelowNormal, ProcessPriorityClass.Normal,
        ProcessPriorityClass.AboveNormal, ProcessPriorityClass.High,
    ];

    public static string Group(string name) => GroupOf.TryGetValue(name, out var g) ? g : "other";

    public static bool IsProtected(string name) => Untouchable.Contains(name) || name.Equals("Rocket", StringComparison.OrdinalIgnoreCase);

    public static int PriorityIndex(int cls) => cls switch
    {
        (int)ProcessPriorityClass.Idle => 0, (int)ProcessPriorityClass.BelowNormal => 1,
        (int)ProcessPriorityClass.AboveNormal => 3, (int)ProcessPriorityClass.High => 4, _ => 2,
    };

    public static string GlyphOf(string group) => group switch
    {
        "node" => "", "build" => "", "editor" => "", "browser" => "",
        "security" => "", "system" => "", _ => "",
    };

    /// <summary>Ends every process of a row. Returns how many would not go.</summary>
    public static int End(ProcRow row)
    {
        int failed = 0;
        foreach (var pid in row.Pids)
        {
            if (pid == Environment.ProcessId) continue;
            try
            {
                using var p = Process.GetProcessById(pid);
                if (IsProtected(p.ProcessName)) { failed++; continue; }
                p.Kill();
            }
            catch (ArgumentException) { /* already gone */ }
            catch { failed++; }
        }
        return failed;
    }

    public static int SetPriority(ProcRow row, ProcessPriorityClass cls)
    {
        int failed = 0;
        foreach (var pid in row.Pids)
            try { using var p = Process.GetProcessById(pid); p.PriorityClass = cls; }
            catch (ArgumentException) { }
            catch { failed++; }
        return failed;
    }

    /// <summary>Command lines of the dev runtimes, keyed by pid — one CIM query.</summary>
    public static async Task<Dictionary<int, string>> CommandLines()
    {
        var names = string.Join(" or ", Detailed.Select(n => $"Name='{n}.exe'"));
        var j = await Ps.Json($"Get-CimInstance Win32_Process -Filter \"{names}\" | Select-Object ProcessId, CommandLine", 30);
        var map = new Dictionary<int, string>();
        if (j is { } e) foreach (var x in e.A()) map[(int)x.L("ProcessId")] = x.S("CommandLine");
        return map;
    }
}
