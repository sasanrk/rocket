using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Rocket.Core;

/// <summary>
/// <c>Rocket.exe --report file.txt</c>: everything the app would find, measured, written
/// as text — no window, nothing deleted. For checking the catalog on a real machine.
/// </summary>
public static class Report
{
    public static void Write(string file)
    {
        var sb = new StringBuilder();
        var sw = Stopwatch.StartNew();
        var items = Catalog.Build();
        sb.AppendLine($"catalog: {items.Count} items in {sw.ElapsedMilliseconds} ms  (admin: {Native.IsAdmin})");
        sw.Restart();
        var log = file + ".items.log";
        File.WriteAllText(log, "");
        Parallel.ForEach(items, new ParallelOptions { MaxDegreeOfParallelism = 4 }, it =>
        {
            var t = Stopwatch.StartNew();
            lock (log) File.AppendAllText(log, $"start {it.Id}\n");
            try { Engine.Measure(it, default); } catch { it.Bytes = 0; }
            lock (log) File.AppendAllText(log, $"done  {it.Id} {t.ElapsedMilliseconds} ms\n");
        });
        sb.AppendLine($"measured in {sw.Elapsed.TotalSeconds:0.0} s");
        foreach (var g in items.GroupBy(i => i.Group))
        {
            sb.AppendLine($"\n## {g.Key}  {Format.Bytes(g.Where(i => i.Bytes > 0).Sum(i => i.Bytes))}");
            foreach (var i in g.OrderByDescending(i => i.Bytes))
                sb.AppendLine($"  {Format.Bytes(i.Bytes),10}  {(i.Risk == Risk.Review ? "R" : " ")}{(i.Admin ? "A" : " ")}  {i.Title}  [{string.Join(" | ", i.Paths.Take(4))}{(i.Paths.Count > 4 ? $" +{i.Paths.Count - 4}" : "")}]");
        }

        sw.Restart();
        var roots = Projects.DefaultRoots();
        var found = new ConcurrentQueue<Artifact>();
        var loose = new ConcurrentQueue<string>();
        Projects.Discover(roots, found.Enqueue, (p, l, _) => loose.Enqueue($"{Format.Bytes(l),10}  {p}"), default);
        sb.AppendLine($"\n## projects  roots: {string.Join(", ", roots)}");
        sb.AppendLine($"walk: {found.Count} artifacts in {sw.Elapsed.TotalSeconds:0.0} s");
        sw.Restart();
        var rows = found.GroupBy(a => (a.ProjectRoot, a.Kind)).Select(g =>
        {
            var t = new Tally();
            foreach (var a in g) t.Add(Fs.Measure(a.Path));
            var idle = (int)(DateTime.UtcNow - Projects.LastActivity(g.Key.ProjectRoot)).TotalDays;
            return (g.Key.ProjectRoot, g.Key.Kind, t.Bytes, Count: g.Count(), idle);
        }).AsParallel().WithDegreeOfParallelism(3).ToList();
        sb.AppendLine($"measured in {sw.Elapsed.TotalSeconds:0.0} s, total {Format.Bytes(rows.Sum(r => r.Bytes))}");
        foreach (var r in rows.OrderByDescending(r => r.Bytes).Take(150))
            sb.AppendLine($"  {Format.Bytes(r.Bytes),10}  {r.Kind,-12} x{r.Count,-3} idle {r.idle,4}d  {r.ProjectRoot}");

        sb.AppendLine("\n## models");
        foreach (var m in Models.Find())
        {
            Engine.Measure(m, default);
            sb.AppendLine($"  {Format.Bytes(m.Bytes),10}  {m.Badge}  {m.Title}");
        }
        foreach (var l in loose) sb.AppendLine("  " + l);
        File.WriteAllText(file, sb.ToString());
    }
}
