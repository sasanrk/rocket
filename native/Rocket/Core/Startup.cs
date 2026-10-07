using System.IO;
using Microsoft.Win32;

namespace Rocket.Core;

/// <summary>One thing Windows starts at sign-in.</summary>
public sealed class StartupEntry : Bindable
{
    public required string Name { get; init; }
    public required string Command { get; init; }
    /// <summary>"run", "run32" or "folder" — which StartupApproved list governs it.</summary>
    public required string Kind { get; init; }
    public required bool Machine { get; init; }
    /// <summary>Registry value name, or the shortcut's file name for the Startup folder.</summary>
    public required string Key { get; init; }
    public string? Exe { get; init; }
    public string? Publisher { get; set; }

    private bool _enabled;
    public bool Enabled { get => _enabled; set => Set(ref _enabled, value); }

    private string _usage = "";
    /// <summary>"Running · 230 MB" when its program is running now.</summary>
    public string Usage { get => _usage; set => Set(ref _usage, value); }

    public string Display => Format.Ltr(Name);
    public string Scope => Machine ? Loc.I["startup.allusers"] : Loc.I["startup.you"];
    public bool Locked => Machine && !Native.IsAdmin;

    public void Relocalize() => Raise(nameof(Scope));
}

/// <summary>
/// The sign-in list Task Manager shows: the Run keys and the Startup folders, each turned
/// on or off through the matching StartupApproved value — the same switch Task Manager
/// flips, so the two never disagree and nothing is deleted. Machine-wide entries live
/// under HKLM and are changed through one UAC prompt.
/// </summary>
public static class Startup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Run32Key = @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
    private const string Approved = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\";

    public static List<StartupEntry> List()
    {
        var list = new List<StartupEntry>();
        void FromKey(RegistryKey hive, string path, string kind, bool machine)
        {
            try
            {
                using var k = hive.OpenSubKey(path);
                if (k is null) return;
                foreach (var v in k.GetValueNames())
                {
                    if (string.IsNullOrWhiteSpace(v)) continue;
                    var cmd = k.GetValue(v)?.ToString() ?? "";
                    list.Add(new StartupEntry
                    {
                        Name = v, Command = cmd, Kind = kind, Machine = machine, Key = v, Exe = ExeOf(cmd),
                        Enabled = IsEnabled(machine ? Registry.LocalMachine : Registry.CurrentUser, kind, v),
                    });
                }
            }
            catch { }
        }
        FromKey(Registry.CurrentUser, RunKey, "run", false);
        FromKey(Registry.LocalMachine, RunKey, "run", true);
        FromKey(Registry.LocalMachine, Run32Key, "run32", true);

        void FromFolder(string dir, bool machine)
        {
            foreach (var f in Fs.Files(dir))
            {
                var name = Path.GetFileName(f.Path);
                if (name.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase)) continue;
                var target = f.Path.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase) ? Shortcut.Target(f.Path) : f.Path;
                list.Add(new StartupEntry
                {
                    Name = Path.GetFileNameWithoutExtension(name), Command = target ?? f.Path, Kind = "folder", Machine = machine,
                    Key = name, Exe = target,
                    Enabled = IsEnabled(machine ? Registry.LocalMachine : Registry.CurrentUser, "folder", name),
                });
            }
        }
        FromFolder(Environment.GetFolderPath(Environment.SpecialFolder.Startup), false);
        FromFolder(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), true);

        foreach (var e in list)
            if (e.Exe is { } exe && File.Exists(exe))
                try { e.Publisher = System.Diagnostics.FileVersionInfo.GetVersionInfo(exe).CompanyName; } catch { }
        return list.OrderBy(e => !e.Enabled).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static string ApprovedPath(string kind) => Approved + kind switch { "run32" => "Run32", "folder" => "StartupFolder", _ => "Run" };

    // StartupApproved holds 12 bytes per entry: an even first byte means on, odd means
    // off, and the last eight are when it was turned off. No value means on.
    private static bool IsEnabled(RegistryKey hive, string kind, string name)
    {
        try
        {
            using var k = hive.OpenSubKey(ApprovedPath(kind));
            return k?.GetValue(name) is not byte[] b || b.Length == 0 || (b[0] & 1) == 0;
        }
        catch { return true; }
    }

    private static byte[] Flag(bool on)
    {
        var b = new byte[12];
        b[0] = on ? (byte)2 : (byte)3;
        if (!on) BitConverter.GetBytes(DateTime.UtcNow.ToFileTimeUtc()).CopyTo(b, 4);
        return b;
    }

    /// <summary>Turns an entry on or off. False when the change was refused or failed.</summary>
    public static async Task<bool> Set(StartupEntry e, bool on)
    {
        if (!e.Machine)
        {
            try
            {
                using var k = Registry.CurrentUser.CreateSubKey(ApprovedPath(e.Kind));
                k.SetValue(e.Key, Flag(on), RegistryValueKind.Binary);
                e.Enabled = on;
                return true;
            }
            catch { return false; }
        }
        var bytes = string.Join(",", Flag(on).Select(x => "0x" + x.ToString("x2")));
        var r = await Elevated.PowerShell($@"
$k = 'HKLM:\{ApprovedPath(e.Kind)}'
if (-not (Test-Path $k)) {{ New-Item -Path $k -Force | Out-Null }}
Set-ItemProperty -LiteralPath $k -Name {Elevated.Q(e.Key)} -Type Binary -Value ([byte[]]({bytes}))");
        if (r.Ok) e.Enabled = on;
        return r.Ok;
    }

    /// <summary>The program a command line starts, without its arguments.</summary>
    public static string? ExeOf(string cmd)
    {
        cmd = Environment.ExpandEnvironmentVariables(cmd.Trim());
        if (cmd.StartsWith('"'))
        {
            int end = cmd.IndexOf('"', 1);
            return end > 1 ? cmd[1..end] : null;
        }
        int exe = cmd.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        return exe > 0 ? cmd[..(exe + 4)] : cmd.Split(' ')[0];
    }
}

/// <summary>Reads a .lnk target through the shell's own COM object.</summary>
public static class Shortcut
{
    public static string? Target(string lnk)
    {
        try
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            if (t is null) return null;
            dynamic sh = Activator.CreateInstance(t)!;
            var sc = sh.CreateShortcut(lnk);
            string target = sc.TargetPath;
            return string.IsNullOrEmpty(target) ? null : target;
        }
        catch { return null; }
    }
}
