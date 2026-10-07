using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;

namespace Rocket.Core;

/// <summary>
/// Moves a folder to another drive. A project travels without what its tools rebuild
/// (node_modules, build output, caches) — those are deleted with the original instead of
/// copied. Across drives the copy is checked file for file before the original goes; on
/// the same drive it is a rename.
/// </summary>
public static class Mover
{
    public static readonly HashSet<string> Rebuilt = new(StringComparer.OrdinalIgnoreCase)
    {
        "node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache", ".angular", ".astro", ".vite", ".output",
        ".expo", ".docusaurus", ".vercel", ".netlify", ".dart_tool", "dist", "build", "out", "coverage", "storybook-static", ".gradle",
        ".cxx", ".kotlin", "captures", "Pods", "__pycache__", ".venv", "venv", "target", "bin", "obj", ".pytest_cache", ".mypy_cache",
        ".nyc_output", "tmp", ".tmp",
    };

    public sealed record Plan(string Source, string Destination, bool IsProject, bool SameDrive, long Bytes, long Files,
        long LeftBehind, long Free, string? Problem);

    private static bool IsProject(string dir) =>
        new[] { ".git", "package.json", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "pubspec.yaml", "go.mod", "pyproject.toml", "composer.json" }
            .Any(m => Directory.Exists(Path.Combine(dir, m)) || File.Exists(Path.Combine(dir, m)))
        || Directory.EnumerateFiles(dir, "*.csproj").Any() || Directory.EnumerateFiles(dir, "*.sln").Any();

    /// <summary>Walks the tree once, splitting what travels from what is rebuilt.</summary>
    private static (long Bytes, long Files, long Rebuilt) Weigh(string dir, bool project)
    {
        long bytes = 0, files = 0, rebuilt = 0;
        var stack = new Stack<string>();
        stack.Push(dir);
        while (stack.Count > 0)
        {
            var d = stack.Pop();
            foreach (var f in Fs.Files(d)) { bytes += Fs.OnDisk(f.Length); files++; }
            foreach (var sub in Fs.Dirs(d))
            {
                if (project && Rebuilt.Contains(Path.GetFileName(sub))) { rebuilt += Fs.Measure(sub).Bytes; continue; }
                stack.Push(sub);
            }
        }
        return (bytes, files, rebuilt);
    }

    public static Plan Make(string source, string destParent)
    {
        source = Path.GetFullPath(source).TrimEnd('\\');
        destParent = Path.GetFullPath(destParent);
        var dest = Path.Combine(destParent, Path.GetFileName(source));
        string? problem = null;
        if (!Directory.Exists(source)) problem = Loc.I["move.p.source"];
        else if (!Guard.MayDeleteFromMap(source)) problem = Loc.I["move.p.protected"];
        else if (!Directory.Exists(destParent)) problem = Loc.I["move.p.dest"];
        else if (dest.Equals(source, StringComparison.OrdinalIgnoreCase) || dest.StartsWith(source + "\\", StringComparison.OrdinalIgnoreCase))
            problem = Loc.I["move.p.inside"];
        else if (Directory.Exists(dest) || File.Exists(dest)) problem = Loc.I.F("move.p.exists", dest);
        else if (destParent.TrimEnd('\\').Length > 2 && !Guard.MayDeleteFromMap(Path.Combine(destParent, "x"))) problem = Loc.I["move.p.protected"];
        if (problem != null) return new Plan(source, dest, false, false, 0, 0, 0, 0, problem);

        bool project = IsProject(source);
        var (bytes, files, rebuilt) = Weigh(source, project);
        bool same = string.Equals(Path.GetPathRoot(source), Path.GetPathRoot(dest), StringComparison.OrdinalIgnoreCase);
        long free = new DriveInfo(Path.GetPathRoot(dest)!).AvailableFreeSpace;
        if (!same && free < bytes * 1.05 + (64L << 20)) problem = Loc.I.F("move.p.space", Format.Bytes(free));
        return new Plan(source, dest, project, same, bytes, files, rebuilt, free, problem);
    }

    /// <summary>Moves; copied bytes count up in <paramref name="st"/>. Returns an error, or null.</summary>
    public static async Task<string?> Run(Plan plan, DeleteStats st, CancellationToken ct)
    {
        if (plan.SameDrive)
        {
            Directory.Move(plan.Source, plan.Destination);
            Interlocked.Add(ref st.Bytes, plan.Bytes);
            if (plan.IsProject) await Task.Run(() => DropRebuilt(plan.Destination, st, ct), ct);
            return null;
        }

        var xd = plan.IsProject ? " /XD " + string.Join(" ", Rebuilt.Select(n => $"\"{n}\"")) : "";
        var psi = new ProcessStartInfo("robocopy.exe",
            $"\"{plan.Source}\" \"{plan.Destination}\" /E /COPY:DAT /DCOPY:DAT /XJ /R:2 /W:1 /MT:16 /NP /NJH /NJS /NDL /NC /BYTES{xd}")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
        };
        using var p = Process.Start(psi)!;
        using var reg = ct.Register(() => { try { p.Kill(true); } catch { } });
        var line = new Regex(@"^\s*(\d+)\s+\S");
        while (await p.StandardOutput.ReadLineAsync(ct) is { } l)
            if (line.Match(l) is { Success: true } m && long.TryParse(m.Groups[1].Value, out var b))
                Interlocked.Add(ref st.Bytes, Fs.OnDisk(b));
        await p.WaitForExitAsync(ct);
        if (p.ExitCode >= 8) return Loc.I.F("move.e.copy", p.ExitCode);

        // The copy must match what was planned, file for file, before the original goes.
        var (bytes, files, _) = Weigh(plan.Destination, plan.IsProject);
        if (files != plan.Files || bytes != plan.Bytes) return Loc.I.F("move.e.verify", files, plan.Files);

        var del = new DeleteStats();
        await Task.Run(() => Fs.Delete(plan.Source, del, ct), ct);
        return del.Failed > 0 ? Loc.I.F("move.e.left", del.Failed) : null;
    }

    private static void DropRebuilt(string dir, DeleteStats st, CancellationToken ct)
    {
        foreach (var sub in Fs.Dirs(dir))
        {
            if (Rebuilt.Contains(Path.GetFileName(sub))) Fs.Delete(sub, new DeleteStats(), ct);
            else DropRebuilt(sub, st, ct);
        }
    }

    /// <summary>The same place on the roomiest other drive: D:\Dev\x → F:\Dev.</summary>
    public static string? Suggest(string source)
    {
        var root = Path.GetPathRoot(source)!;
        var best = DriveInfo.GetDrives().Where(d => { try { return d.IsReady && d.DriveType == DriveType.Fixed && !d.Name.Equals(root, StringComparison.OrdinalIgnoreCase); } catch { return false; } })
            .OrderByDescending(d => d.AvailableFreeSpace).FirstOrDefault();
        if (best is null) return null;
        var parent = Path.GetDirectoryName(source)!;
        return Path.Combine(best.RootDirectory.FullName, parent[root.Length..]);
    }
}
