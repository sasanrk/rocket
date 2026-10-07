using System.IO;
using System.Windows;
using System.Windows.Threading;
using Rocket.Core;

namespace Rocket.Pages;

/// <summary>A warning on the overview that leads to the page that fixes it.</summary>
public sealed record Alert(string Text, string Page);

public partial class OverviewPage : PageBase
{
    private readonly DispatcherTimer _tick = new() { Interval = TimeSpan.FromSeconds(2.5) };
    private CpuClock? _clock;
    private string? _plan;

    public OverviewPage()
    {
        InitializeComponent();
        _tick.Tick += (_, _) => Refresh();
    }

    protected override async void FirstShown()
    {
        _plan = (await Task.Run(Power.Read)).ActiveName;
        Refresh();
    }

    protected override void OnShown()
    {
        _clock ??= new CpuClock();
        Drives.ItemsSource = Main.DriveList.ItemsSource;
        _tick.Start();
        Refresh();
    }

    public override void Hidden() => _tick.Stop();

    protected override void Relocalize() => Refresh();

    private void Refresh()
    {
        var alerts = new List<Alert>();

        // Free space: what the scans found so far, else how much is free.
        var (clean, projects, models, scanning) = Main.Reclaimable();
        long can = clean + projects;
        SpaceBig.Text = can > 0 ? Format.Bytes(can) : scanning ? "…" : Format.Bytes(DriveInfo.GetDrives().Where(d => d.IsReady && d.DriveType == DriveType.Fixed).Sum(d => d.AvailableFreeSpace));
        SpaceSub.Text = can > 0
            ? Loc.I.F("ov.space.sub", Format.Bytes(clean), Format.Bytes(projects)) + (models > 0 ? "  ·  " + Loc.I.F("ov.space.models", Format.Bytes(models)) : "")
            : Loc.I[scanning ? "common.scanning" : "ov.space.free"];

        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.DriveType != DriveType.Fixed || !d.IsReady || d.TotalSize == 0) continue;
                if (d.AvailableFreeSpace < d.TotalSize * 0.1)
                    alerts.Add(new Alert(Loc.I.F("ov.alert.disk", d.Name.TrimEnd('\\'), Format.Bytes(d.AvailableFreeSpace)), "clean"));
            }
            catch { }
        }

        // Speed: the clock right now against the rated one.
        var c = _clock?.Read();
        if (c is { } r)
        {
            SpeedBig.Text = $"{r.Mhz / 1000:0.00} GHz";
            SpeedSub.Text = Loc.I.F("tune.ofrated", r.Perf.ToString("0"), (Power.RatedMhz / 1000.0).ToString("0.00")) + (_plan is null ? "" : "  ·  " + _plan);
            if (r.Utility > 40 && r.Perf < 85) alerts.Add(new Alert(Loc.I.F("ov.alert.cpu", r.Perf.ToString("0")), "tune"));
        }

        // Keep watch: memory first — on this kind of machine it runs out before the CPU does.
        var mem = Perf.Memory();
        double used = mem.Total == 0 ? 0 : 1 - (double)mem.Available / mem.Total;
        double cpu = Perf.Cpu();
        WatchBig.Text = Loc.I.F("ov.mem", (used * 100).ToString("0"));
        WatchBig.Foreground = (System.Windows.Media.Brush)FindResource(used > 0.85 ? "Danger" : used > 0.7 ? "Warn" : "Text");
        WatchSub.Text = Loc.I.F("ov.watch.sub", Format.Bytes((long)(mem.Total - mem.Available)), Format.Bytes((long)mem.Total), (cpu * 100).ToString("0"));
        if (used > 0.85) alerts.Add(new Alert(Loc.I.F("ov.alert.mem", (used * 100).ToString("0")), "processes"));

        Alerts.ItemsSource = alerts;
    }

    private void Go_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.Tag is string page) Main.ShowPage(page);
    }

    private void Alert_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is Alert a) Main.ShowPage(a.Page);
    }
}
