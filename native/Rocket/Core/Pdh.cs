using System.Runtime.InteropServices;

namespace Rocket.Core;

/// <summary>
/// The processor's real clock, the way Task Manager reads it: "% Processor Performance"
/// (how far above or below its rated speed the chip runs) times "Processor Frequency",
/// plus "% Processor Utility". Two samples apart give a reading; the first gives none.
/// </summary>
public sealed class CpuClock : IDisposable
{
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern int PdhOpenQuery(string? src, IntPtr user, out IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern int PdhAddEnglishCounter(IntPtr q, string path, IntPtr user, out IntPtr c);
    [DllImport("pdh.dll")] private static extern int PdhCollectQueryData(IntPtr q);
    [DllImport("pdh.dll")] private static extern int PdhGetFormattedCounterValue(IntPtr c, uint fmt, IntPtr type, out PDH_FMT_COUNTERVALUE v);
    [DllImport("pdh.dll")] private static extern int PdhCloseQuery(IntPtr q);

    [StructLayout(LayoutKind.Sequential)]
    private struct PDH_FMT_COUNTERVALUE { public uint CStatus; public double Value; }

    private const uint PDH_FMT_DOUBLE = 0x200, PDH_FMT_NOCAP100 = 0x8000;
    private readonly IntPtr _q, _perf, _util, _freq;
    private readonly bool _ok;

    public CpuClock()
    {
        _ok = PdhOpenQuery(null, IntPtr.Zero, out _q) == 0
              && PdhAddEnglishCounter(_q, @"\Processor Information(_Total)\% Processor Performance", IntPtr.Zero, out _perf) == 0
              && PdhAddEnglishCounter(_q, @"\Processor Information(_Total)\% Processor Utility", IntPtr.Zero, out _util) == 0
              && PdhAddEnglishCounter(_q, @"\Processor Information(_Total)\Processor Frequency", IntPtr.Zero, out _freq) == 0;
        if (_ok) PdhCollectQueryData(_q);
    }

    /// <summary>(MHz now, % of rated speed, % busy) — or null until two samples exist.</summary>
    public (double Mhz, double Perf, double Utility)? Read()
    {
        if (!_ok || PdhCollectQueryData(_q) != 0) return null;
        double Get(IntPtr c) => PdhGetFormattedCounterValue(c, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, IntPtr.Zero, out var v) == 0 && v.CStatus == 0 ? v.Value : double.NaN;
        double perf = Get(_perf), util = Math.Min(100, Get(_util)), freq = Get(_freq);
        if (double.IsNaN(perf) || double.IsNaN(freq)) return null;
        return (freq * perf / 100, perf, double.IsNaN(util) ? 0 : util);
    }

    public void Dispose() { if (_ok) PdhCloseQuery(_q); }
}
