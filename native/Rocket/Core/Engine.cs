using System.IO;

namespace Rocket.Core;

/// <summary>Measures and cleans <see cref="Item"/>s, whatever their kind.</summary>
public static class Engine
{
    public static void Measure(Item it, CancellationToken ct)
    {
        switch (it.Kind)
        {
            case Kind.RecycleBin:
                var (b, n) = Native.RecycleBin();
                it.Files = n;
                it.Bytes = b;
                return;
            case Kind.Hibernate:
                it.Bytes = Fs.Files(Path.GetPathRoot(it.Paths[0])!).FirstOrDefault(f =>
                    Path.GetFileName(f.Path).Equals("hiberfil.sys", StringComparison.OrdinalIgnoreCase)).Length;
                return;
            case Kind.ComponentStore:
                it.Bytes = -2;
                return;
        }

        var t = new Tally();
        var cutoff = DateTime.UtcNow - it.MinAge;
        foreach (var p in it.Paths)
        {
            ct.ThrowIfCancellationRequested();
            t.Add(Fs.Measure(p, ct, it.Kind == Kind.OldFiles ? cutoff : null));
        }
        it.Files = t.Files;
        it.Bytes = t.Bytes;
    }

    /// <summary>Cleans one item. Freed bytes accumulate in <paramref name="st"/> as they go.</summary>
    public static async Task Clean(Item it, DeleteStats st, CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow - it.MinAge;
        switch (it.Kind)
        {
            case Kind.Contents:
                foreach (var p in it.Paths) await Task.Run(() => Fs.Delete(p, st, ct, keepRoot: true), ct);
                break;
            case Kind.Remove:
            case Kind.OllamaModel:
                foreach (var p in it.Paths) await Task.Run(() => Fs.Delete(p, st, ct), ct);
                break;
            case Kind.OldFiles:
                foreach (var p in it.Paths) await Task.Run(() => Fs.Delete(p, st, ct, keepRoot: true, olderThan: cutoff), ct);
                break;
            case Kind.RecycleBin:
                var before = Native.RecycleBin().Bytes;
                await Task.Run(Native.EmptyRecycleBin, ct);
                Interlocked.Add(ref st.Bytes, Math.Max(0, before - Native.RecycleBin().Bytes));
                break;
            case Kind.Hibernate:
            {
                var (code, output) = await Native.Run("powercfg.exe", "/hibernate off", ct);
                if (code == 0) Interlocked.Add(ref st.Bytes, Math.Max(0, it.Bytes));
                else { Interlocked.Increment(ref st.Failed); st.LastError = output.Trim(); }
                break;
            }
            case Kind.ComponentStore:
            {
                var root = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows))!;
                long free = new DriveInfo(root).AvailableFreeSpace;
                var (code, output) = await Native.Run("Dism.exe", "/Online /Cleanup-Image /StartComponentCleanup", ct);
                Interlocked.Add(ref st.Bytes, Math.Max(0, new DriveInfo(root).AvailableFreeSpace - free));
                if (code != 0) { Interlocked.Increment(ref st.Failed); st.LastError = output.Trim(); }
                break;
            }
        }
    }
}
