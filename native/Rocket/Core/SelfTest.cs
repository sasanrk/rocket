using System.Diagnostics;
using System.IO;
using System.Text;

namespace Rocket.Core;

/// <summary>
/// <c>Rocket.exe --selftest &lt;empty dir&gt; &lt;out.txt&gt;</c>: builds a small tree in a scratch
/// folder and checks the delete engine's promises — read-only files go, a junction is
/// unlinked without touching its target, the age filter keeps fresh files, the guard
/// refuses protected folders.
/// </summary>
public static class SelfTest
{
    public static void Run(string root, string outFile)
    {
        var log = new StringBuilder();
        int fails = 0;
        void Check(bool ok, string what) { log.AppendLine((ok ? "ok    " : "FAIL  ") + what); if (!ok) fails++; }

        Directory.CreateDirectory(root);
        var victim = Path.Combine(root, "victim");
        var outside = Path.Combine(root, "outside");
        Directory.CreateDirectory(Path.Combine(victim, @"a\b\c"));
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "precious.txt"), "keep me");
        for (int i = 0; i < 50; i++) File.WriteAllBytes(Path.Combine(victim, @"a\b\c", $"f{i}.bin"), new byte[5000]);
        var ro = Path.Combine(victim, @"a\readonly.txt");
        File.WriteAllText(ro, "ro");
        File.SetAttributes(ro, FileAttributes.ReadOnly);
        var link = Path.Combine(victim, @"a\link");
        var p = Process.Start(new ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{outside}\"") { CreateNoWindow = true, UseShellExecute = false })!;
        p.WaitForExit();
        Check(Directory.Exists(link), "junction created");

        var t = Fs.Measure(victim);
        Check(t.Files == 51, $"measure counts 51 files, not the junction's ({t.Files})");

        var st = new DeleteStats();
        Fs.Delete(victim, st, default);
        Check(!Directory.Exists(victim), "victim folder gone");
        Check(File.Exists(Path.Combine(outside, "precious.txt")), "junction target untouched");
        Check(st.Files == 51 && st.Failed == 0, $"51 files deleted, 0 failed ({st.Files}, {st.Failed})");

        // keepRoot + age filter
        var aged = Path.Combine(root, "aged");
        Directory.CreateDirectory(Path.Combine(aged, "old"));
        Directory.CreateDirectory(Path.Combine(aged, "new"));
        var oldF = Path.Combine(aged, @"old\x.tmp");
        var newF = Path.Combine(aged, @"new\y.tmp");
        File.WriteAllText(oldF, "old");
        File.WriteAllText(newF, "new");
        File.SetLastWriteTimeUtc(oldF, DateTime.UtcNow.AddDays(-3));
        Directory.SetLastWriteTimeUtc(Path.Combine(aged, "old"), DateTime.UtcNow.AddDays(-3));
        var m = Fs.Measure(aged, default, DateTime.UtcNow.AddDays(-1));
        Check(m.Files == 1, $"aged measure sees 1 old file ({m.Files})");
        st = new DeleteStats();
        Fs.Delete(aged, st, default, keepRoot: true, olderThan: DateTime.UtcNow.AddDays(-1));
        Check(!File.Exists(oldF), "old file deleted");
        Check(!Directory.Exists(Path.Combine(aged, "old")), "emptied old folder removed");
        Check(File.Exists(newF), "fresh file kept");
        Check(Directory.Exists(aged), "root kept");

        // guard
        string W = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string H = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        Check(!Guard.MayDelete(W, false), "refuses Windows");
        Check(!Guard.MayDelete(H, false), "refuses the profile");
        Check(!Guard.MayDelete(H, true), "refuses emptying the profile");
        Check(!Guard.MayDelete(Path.GetDirectoryName(H)!, false), "refuses C:\\Users");
        Check(!Guard.MayDelete(@"C:\", true), "refuses a drive root");
        Check(Guard.MayDelete(Path.GetTempPath(), true), "may empty Temp");
        Check(!Guard.MayDelete(Path.GetTempPath(), false), "may not delete Temp itself");
        Check(!Guard.MayDeleteFromMap(Path.Combine(W, "System32", "drivers")), "map refuses System32\\drivers");
        Check(Guard.MayDeleteFromMap(Path.Combine(root, "anything")), "map allows a scratch folder");
        log.AppendLine(fails == 0 ? "ALL PASSED" : $"{fails} FAILED");
        File.WriteAllText(outFile, log.ToString());
    }

    /// <summary><c>--movetest &lt;scratch on one drive&gt; &lt;scratch on another&gt; out.txt</c>: a fake project, moved and checked.</summary>
    public static void MoveTest(string from, string to, string outFile)
    {
        var log = new StringBuilder();
        int fails = 0;
        void Check(bool ok, string what) { log.AppendLine((ok ? "ok    " : "FAIL  ") + what); if (!ok) fails++; }
        var proj = Path.Combine(from, "demo-project");
        Directory.CreateDirectory(Path.Combine(proj, "src"));
        Directory.CreateDirectory(Path.Combine(proj, "node_modules", "left-pad"));
        Directory.CreateDirectory(Path.Combine(proj, "packages", "a", "node_modules", "x"));
        File.WriteAllText(Path.Combine(proj, "package.json"), "{}");
        for (int i = 0; i < 20; i++) File.WriteAllBytes(Path.Combine(proj, "src", $"f{i}.ts"), new byte[3000 + i]);
        File.WriteAllBytes(Path.Combine(proj, "node_modules", "left-pad", "index.js"), new byte[50000]);
        File.WriteAllBytes(Path.Combine(proj, "packages", "a", "node_modules", "x", "i.js"), new byte[9000]);
        File.WriteAllText(Path.Combine(proj, "packages", "a", "index.ts"), "export {}");
        Directory.CreateDirectory(to);

        var plan = Mover.Make(proj, to);
        Check(plan.Problem is null, "plan accepted: " + plan.Problem);
        Check(plan.IsProject, "seen as a project");
        Check(plan.Files == 22, $"22 files travel ({plan.Files})");
        Check(plan.LeftBehind > 0, "node_modules left behind");
        var st = new DeleteStats();
        var err = Task.Run(() => Mover.Run(plan, st, default)).GetAwaiter().GetResult();
        Check(err is null, "moved: " + err);
        var dest = Path.Combine(to, "demo-project");
        Check(File.Exists(Path.Combine(dest, "src", "f19.ts")), "sources arrived");
        Check(File.Exists(Path.Combine(dest, "packages", "a", "index.ts")), "nested source arrived");
        Check(!Directory.Exists(Path.Combine(dest, "node_modules")), "node_modules not copied");
        Check(!Directory.Exists(Path.Combine(dest, "packages", "a", "node_modules")), "nested node_modules not copied");
        Check(!Directory.Exists(proj), "original removed");
        Check(Mover.Make(dest, to).Problem != null, "refuses to move onto itself");
        Check(Mover.Make(Environment.GetFolderPath(Environment.SpecialFolder.Windows), to).Problem != null, "refuses Windows");
        Fs.Delete(dest, new DeleteStats(), default);
        log.AppendLine(fails == 0 ? "ALL PASSED" : $"{fails} FAILED");
        File.WriteAllText(outFile, log.ToString());
    }

    /// <summary><c>--bench &lt;scratch&gt; out.txt</c>: an npm-cache-shaped tree, deleted and timed.</summary>
    public static void Bench(string root, string outFile, int workers = 0)
    {
        if (workers > 0) Fs.DeleteWorkers = workers;
        var tree = Path.Combine(root, "bench");
        var buf = new byte[2000];
        var sw = Stopwatch.StartNew();
        Parallel.For(0, 256, a =>
        {
            for (int b = 0; b < 8; b++)
            {
                var d = Path.Combine(tree, a.ToString("x2"), b.ToString("x2"));
                Directory.CreateDirectory(d);
                for (int f = 0; f < 6; f++) File.WriteAllBytes(Path.Combine(d, $"{f}.bin"), buf);
            }
        });
        var made = sw.Elapsed;
        var t = Fs.Measure(tree);
        sw.Restart();
        var st = new DeleteStats();
        if (workers < 0)
        {
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c rd /s /q \"{tree}\"") { CreateNoWindow = true, UseShellExecute = false })!.WaitForExit();
            st.Files = t.Files;
        }
        else Fs.Delete(tree, st, default);
        var del = sw.Elapsed;
        File.AppendAllText(outFile, $"workers {workers}: created {t.Files} files in {made.TotalSeconds:0.0}s\n" +
            $"deleted {st.Files} files ({Format.Bytes(st.Bytes)}) in {del.TotalSeconds:0.00}s = {st.Files / del.TotalSeconds:0} files/s, failed {st.Failed}, gone={!Directory.Exists(tree)}\n");
    }
}
