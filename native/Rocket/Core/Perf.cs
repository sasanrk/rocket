using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Rocket.Core;

/// <summary>
/// Whole-machine CPU and memory, read straight from the kernel: two calls per sample, no
/// performance counters (they take seconds to warm up and a thread to keep alive).
/// </summary>
public static class Perf
{
    [DllImport("kernel32.dll")]
    private static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength, dwMemoryLoad;
        public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll")]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

    private static long _idle, _kernel, _user;

    /// <summary>CPU busy share since the previous call, 0..1.</summary>
    public static double Cpu()
    {
        if (!GetSystemTimes(out var idle, out var kernel, out var user)) return 0;
        long di = idle - _idle, dk = kernel - _kernel, du = user - _user;
        bool first = _kernel == 0;
        _idle = idle; _kernel = kernel; _user = user;
        long total = dk + du; // kernel time includes idle
        return first || total <= 0 ? 0 : Math.Clamp(1 - (double)di / total, 0, 1);
    }

    public static (ulong Total, ulong Available, uint Load, ulong CommitTotal, ulong CommitAvail) Memory()
    {
        var m = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        GlobalMemoryStatusEx(ref m);
        return (m.ullTotalPhys, m.ullAvailPhys, m.dwMemoryLoad, m.ullTotalPageFile, m.ullAvailPageFile);
    }
}

/// <summary>One process as last sampled.</summary>
public sealed record ProcInfo(int Id, string Name, long Memory, double Cpu, string? Path, int Priority);

/// <summary>
/// Samples every process's CPU time and memory; CPU share comes from the difference
/// against the previous sample, so the first call reports zero CPU.
/// </summary>
public sealed class ProcSampler
{
    private Dictionary<int, (TimeSpan Cpu, DateTime At)> _last = [];
    private readonly Dictionary<int, string?> _paths = [];

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr h, uint flags, System.Text.StringBuilder name, ref int size);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr h);

    /// <summary>The exe behind a pid, with the least access Windows asks for (works on most elevated processes too).</summary>
    public static string? ImagePath(int pid)
    {
        var h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
        if (h == IntPtr.Zero) return null;
        try
        {
            var sb = new System.Text.StringBuilder(1024);
            int size = sb.Capacity;
            return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : null;
        }
        finally { CloseHandle(h); }
    }

    public List<ProcInfo> Sample()
    {
        var now = DateTime.UtcNow;
        var next = new Dictionary<int, (TimeSpan, DateTime)>();
        var list = new List<ProcInfo>();
        int cores = Environment.ProcessorCount;
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                try
                {
                    if (p.Id is 0 or 4) continue; // Idle, System
                    long mem = p.PrivateMemorySize64;
                    double cpu = 0;
                    TimeSpan t = TimeSpan.Zero;
                    int prio = 0;
                    try
                    {
                        t = p.TotalProcessorTime;
                        prio = (int)p.PriorityClass;
                        next[p.Id] = (t, now);
                        if (_last.TryGetValue(p.Id, out var prev))
                        {
                            var wall = (now - prev.At).TotalMilliseconds;
                            if (wall > 0) cpu = Math.Clamp((t - prev.Cpu).TotalMilliseconds / wall / cores, 0, 1);
                        }
                    }
                    catch { /* protected process: memory only */ }
                    if (!_paths.TryGetValue(p.Id, out var path))
                    {
                        path = ImagePath(p.Id);
                        _paths[p.Id] = path;
                    }
                    list.Add(new ProcInfo(p.Id, p.ProcessName, mem, cpu, path, prio));
                }
                catch { }
            }
        }
        _last = next;
        var alive = list.Select(x => x.Id).ToHashSet();
        foreach (var gone in _paths.Keys.Where(k => !alive.Contains(k)).ToList()) _paths.Remove(gone);
        return list;
    }
}
