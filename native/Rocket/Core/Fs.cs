using System.Collections.Concurrent;
using System.IO;
using System.IO.Enumeration;

namespace Rocket.Core;

/// <summary>What a walk found: bytes on disk, how many files, and the newest write.</summary>
public struct Tally
{
    public long Bytes;
    public long Files;
    public long NewestTicks;

    public readonly DateTime Newest => NewestTicks == 0 ? DateTime.MinValue : new DateTime(NewestTicks, DateTimeKind.Utc);

    public void Add(in Tally o)
    {
        Bytes += o.Bytes;
        Files += o.Files;
        if (o.NewestTicks > NewestTicks) NewestTicks = o.NewestTicks;
    }
}

/// <summary>Live counters for a delete in progress. Safe to read from the UI thread.</summary>
public sealed class DeleteStats
{
    public long Bytes;
    public long Files;
    public long Failed;
    public string? LastError;
}

/// <summary>
/// The file system, done fast: the .NET enumerator (one NtQueryDirectoryFile call per 64 KB
/// of names, no FileInfo per file), split across threads by subfolder, never following a
/// junction or symlink — measuring through one would count someone else's files, and
/// deleting through one would delete them.
/// </summary>
public static class Fs
{
    private static readonly EnumerationOptions Flat = new()
    {
        RecurseSubdirectories = false,
        IgnoreInaccessible = true,
        AttributesToSkip = 0,
        ReturnSpecialDirectories = false,
        BufferSize = 64 * 1024,
    };

    private static readonly EnumerationOptions Deep = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        AttributesToSkip = 0,
        ReturnSpecialDirectories = false,
        BufferSize = 64 * 1024,
    };

    public static int Workers { get; } = Math.Clamp(Environment.ProcessorCount, 2, 8);

    /// <summary>
    /// What a file really costs: NTFS rounds every file up to a 4 KB cluster, and keeps
    /// the tiniest ones inside the MFT record where they cost nothing extra.
    /// </summary>
    public static long OnDisk(long length) => length <= 700 ? 0 : (length + 4095) & ~4095L;

    private static bool IsLink(FileAttributes a) => (a & FileAttributes.ReparsePoint) != 0;

    // ── measuring ───────────────────────────────────────────────────────────

    public static Tally Measure(string path, CancellationToken ct = default, DateTime? olderThan = null)
    {
        long limit = olderThan?.ToUniversalTime().Ticks ?? long.MaxValue;
        if (File.Exists(path))
        {
            try
            {
                var fi = new FileInfo(path);
                if (fi.LastWriteTimeUtc.Ticks >= limit) return default;
                return new Tally { Bytes = OnDisk(fi.Length), Files = 1, NewestTicks = fi.LastWriteTimeUtc.Ticks };
            }
            catch { return default; }
        }
        if (!Directory.Exists(path)) return default;

        // Split the tree into enough independent pieces to keep every worker busy, then
        // walk each piece with the recursive enumerator.
        var units = new List<string>();
        var total = new Tally();
        Split(path, 0, units, ref total, limit, ct);

        var bag = new ConcurrentBag<Tally>();
        Parallel.ForEach(units, new ParallelOptions { MaxDegreeOfParallelism = Workers, CancellationToken = ct },
            dir => bag.Add(WalkDeep(dir, limit, ct)));
        foreach (var t in bag) total.Add(t);
        return total;
    }

    // Counts the files directly in `dir` and hands its subfolders on as work units; if
    // there are only a few, goes one level further so one huge child does not serialise
    // the whole walk (npm's _cacache has three children and half a million files).
    private static void Split(string dir, int depth, List<string> units, ref Tally total, long limit, CancellationToken ct)
    {
        var subs = new List<string>();
        try
        {
            var e = new FileSystemEnumerable<(string Path, bool Dir, long Len, long Ticks)>(dir,
                (ref FileSystemEntry en) => (en.IsDirectory ? en.ToFullPath() : "", en.IsDirectory, en.Length, en.LastWriteTimeUtc.UtcTicks),
                Flat)
            {
                ShouldIncludePredicate = (ref FileSystemEntry en) => !en.IsDirectory || !IsLink(en.Attributes),
            };
            foreach (var x in e)
            {
                ct.ThrowIfCancellationRequested();
                if (x.Dir) { subs.Add(x.Path); continue; }
                if (x.Ticks >= limit) continue;
                total.Bytes += OnDisk(x.Len);
                total.Files++;
                if (x.Ticks > total.NewestTicks) total.NewestTicks = x.Ticks;
            }
        }
        catch (OperationCanceledException) { throw; }
        catch { return; }

        if (depth < 3 && subs.Count is > 0 and < 8)
        {
            foreach (var s in subs) Split(s, depth + 1, units, ref total, limit, ct);
        }
        else units.AddRange(subs);
    }

    private static Tally WalkDeep(string dir, long limit, CancellationToken ct)
    {
        var t = new Tally();
        try
        {
            var e = new FileSystemEnumerable<(long Len, long Ticks)>(dir,
                (ref FileSystemEntry en) => (en.Length, en.LastWriteTimeUtc.UtcTicks), Deep)
            {
                ShouldIncludePredicate = (ref FileSystemEntry en) => !en.IsDirectory,
                ShouldRecursePredicate = (ref FileSystemEntry en) => !IsLink(en.Attributes),
            };
            int n = 0;
            foreach (var x in e)
            {
                if ((++n & 1023) == 0) ct.ThrowIfCancellationRequested();
                if (x.Ticks >= limit) continue;
                t.Bytes += OnDisk(x.Len);
                t.Files++;
                if (x.Ticks > t.NewestTicks) t.NewestTicks = x.Ticks;
            }
        }
        catch (OperationCanceledException) { throw; }
        catch { /* gone or denied mid-walk: count what was seen */ }
        return t;
    }

    // ── deleting ────────────────────────────────────────────────────────────

    /// <summary>How many threads delete at once. Measured on this machine's SATA SSDs: four
    /// workers deleted ~4× faster than one, while sixteen fought over the volume and fell
    /// back to the speed of one.</summary>
    public static int DeleteWorkers { get; set; } = Math.Clamp(Environment.ProcessorCount, 4, 8);

    /// <summary>
    /// Deletes a file or a folder tree for good. Files in use are skipped and counted, not
    /// retried; a junction or symlink is unlinked, never followed. With
    /// <paramref name="keepRoot"/> the folder itself stays and only its contents go.
    /// With <paramref name="olderThan"/>, only files last written before it go, and only
    /// folders left empty.
    /// </summary>
    public static void Delete(string path, DeleteStats st, CancellationToken ct, bool keepRoot = false, DateTime? olderThan = null)
    {
        path = Path.GetFullPath(path);
        if (!Guard.MayDelete(path, keepRoot))
        {
            Interlocked.Increment(ref st.Failed);
            st.LastError = "protected: " + path;
            return;
        }

        long limit = olderThan?.ToUniversalTime().Ticks ?? long.MaxValue;
        if (File.Exists(path))
        {
            if (keepRoot) return;
            var fi = new FileInfo(path);
            if (fi.LastWriteTimeUtc.Ticks < limit) DeleteFile(path, fi.Length, fi.Attributes, st);
            return;
        }
        if (!Directory.Exists(path)) return;

        if (IsLink(File.GetAttributes(path)))
        {
            if (!keepRoot) RemoveDir(path, st);
            return;
        }

        DeleteTree(path, st, ct, limit);
        if (!keepRoot) RemoveDir(path, st);
    }

    /// <summary>
    /// A parallel walk where every worker deletes the files of the folder it just listed and
    /// queues its subfolders for whoever is free — so the whole tree, not just its top, is
    /// spread across the workers (npm's cache is 65,000 folders three levels down). Emptied
    /// folders are removed afterwards, deepest first, also in parallel.
    /// </summary>
    private static void DeleteTree(string root, DeleteStats st, CancellationToken ct, long limit)
    {
        bool aged = limit != long.MaxValue;
        var queue = new ConcurrentQueue<(string Path, int Depth, long Ticks)>();
        var done = new ConcurrentBag<(string Path, int Depth, long Ticks)>();
        int pending = 1;
        queue.Enqueue((root, 0, 0));

        void Work()
        {
            var idle = 0;
            while (Volatile.Read(ref pending) > 0 && !ct.IsCancellationRequested)
            {
                if (!queue.TryDequeue(out var d))
                {
                    if (++idle > 50) Thread.Sleep(1); else Thread.Yield();
                    continue;
                }
                idle = 0;
                try
                {
                    var e = new FileSystemEnumerable<(string Path, bool Dir, FileAttributes A, long Len, long Ticks)>(d.Path,
                        (ref FileSystemEntry en) => (en.ToFullPath(), en.IsDirectory, en.Attributes, en.Length, en.LastWriteTimeUtc.UtcTicks),
                        Flat);
                    foreach (var x in e)
                    {
                        if (x.Dir)
                        {
                            if (IsLink(x.A)) { if (!aged) RemoveDir(x.Path, st); continue; }
                            Interlocked.Increment(ref pending);
                            queue.Enqueue((x.Path, d.Depth + 1, x.Ticks));
                            continue;
                        }
                        if (x.Ticks >= limit) continue;
                        DeleteFile(x.Path, x.Len, x.A, st);
                    }
                    done.Add(d);
                }
                catch (Exception ex) { st.LastError = ex.Message; }
                finally { Interlocked.Decrement(ref pending); }
            }
        }

        var workers = new Thread[DeleteWorkers];
        for (int i = 0; i < workers.Length; i++)
        {
            workers[i] = new Thread(Work) { IsBackground = true, Name = "rocket-delete" };
            workers[i].Start();
        }
        foreach (var w in workers) w.Join();
        if (ct.IsCancellationRequested) return;

        // Folders, deepest level first; each level in parallel. The root is the caller's.
        foreach (var level in done.Where(d => d.Depth > 0).GroupBy(d => d.Depth).OrderByDescending(g => g.Key))
        {
            // With an age limit, a folder written recently may be about to be used; leave it.
            var dirs = level.Where(d => !aged || d.Ticks < limit).Select(d => d.Path).ToList();
            Parallel.ForEach(dirs, new ParallelOptions { MaxDegreeOfParallelism = DeleteWorkers }, p => RemoveDir(p, st, quiet: aged));
        }
    }

    private static void DeleteFile(string path, long len, FileAttributes attrs, DeleteStats st)
    {
        try
        {
            // Read-only files (git packs, some npm tarballs) refuse to go; clear the flag
            // first rather than paying for an exception and a retry.
            if ((attrs & FileAttributes.ReadOnly) != 0) File.SetAttributes(path, FileAttributes.Normal);
            File.Delete(path);
            Interlocked.Add(ref st.Bytes, OnDisk(len));
            Interlocked.Increment(ref st.Files);
        }
        catch (Exception ex)
        {
            Interlocked.Increment(ref st.Failed);
            st.LastError = ex.Message;
        }
    }

    private static void RemoveDir(string path, DeleteStats st, bool quiet = false)
    {
        try { Directory.Delete(path, false); }
        catch (UnauthorizedAccessException)
        {
            try
            {
                File.SetAttributes(path, FileAttributes.Directory);
                Directory.Delete(path, false);
            }
            catch { if (!quiet) Interlocked.Increment(ref st.Failed); }
        }
        catch (IOException) { /* not empty: something inside was in use */ }
        catch { if (!quiet) Interlocked.Increment(ref st.Failed); }
    }

    // ── small helpers ───────────────────────────────────────────────────────

    /// <summary>Immediate subfolders, links excluded. Never throws.</summary>
    public static List<string> Dirs(string dir)
    {
        var list = new List<string>();
        if (!Directory.Exists(dir)) return list;
        try
        {
            var e = new FileSystemEnumerable<string>(dir, (ref FileSystemEntry en) => en.ToFullPath(), Flat)
            {
                ShouldIncludePredicate = (ref FileSystemEntry en) => en.IsDirectory && !IsLink(en.Attributes),
            };
            list.AddRange(e);
        }
        catch { }
        return list;
    }

    /// <summary>Immediate files with their length and write time. Never throws.</summary>
    public static List<(string Path, long Length, DateTime Written)> Files(string dir)
    {
        var list = new List<(string, long, DateTime)>();
        if (!Directory.Exists(dir)) return list;
        try
        {
            var e = new FileSystemEnumerable<(string, long, DateTime)>(dir,
                (ref FileSystemEntry en) => (en.ToFullPath(), en.Length, en.LastWriteTimeUtc.UtcDateTime), Flat)
            {
                ShouldIncludePredicate = (ref FileSystemEntry en) => !en.IsDirectory,
            };
            list.AddRange(e);
        }
        catch { }
        return list;
    }

    public static string Env(string name) => Environment.ExpandEnvironmentVariables(name);
}
