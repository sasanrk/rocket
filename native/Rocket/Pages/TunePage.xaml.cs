using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Rocket.Core;

namespace Rocket.Pages;

public partial class TunePage : PageBase
{
    private readonly ObservableCollection<Tweak> _tweaks = [];
    private readonly ObservableCollection<Svc> _services = [];
    private readonly ObservableCollection<Exclusion> _exclusions = [];
    private readonly DispatcherTimer _tick = new() { Interval = TimeSpan.FromMilliseconds(2500) };
    private CpuClock? _clock;
    private Power.State? _state;
    private Defender.Info? _def;
    private bool? _ssd;
    private bool _busy;

    public TunePage()
    {
        InitializeComponent();
        Tweaks.ItemsSource = _tweaks;
        Services.ItemsSource = _services;
        Exclusions.ItemsSource = _exclusions;
        foreach (var id in Power.TweakIds) _tweaks.Add(new Tweak { Id = id });
        foreach (var n in Power.ServiceNames) _services.Add(new Svc { Name = n });
        _tick.Tick += (_, _) => Sample();
        CpuName.Text = Power.CpuName;
    }

    protected override async void FirstShown()
    {
        await Reload(chooseDefaults: true);
        _ = LoadDefender();
        _ssd = await SystemDriveIsSsd();
        ShowServiceNote();
    }

    protected override void OnShown()
    {
        _clock ??= new CpuClock();
        _tick.Start();
        Sample();
    }

    public override void Hidden() => _tick.Stop();

    protected override void Relocalize()
    {
        foreach (var t in _tweaks) t.Relocalize();
        foreach (var s in _services) s.Relocalize();
        foreach (var x in _exclusions) x.Relocalize();
        UpdatePower();
        ShowServiceNote();
        ShowDefender();
    }

    // ── live clock ──────────────────────────────────────────────────────────

    private void Sample()
    {
        var r = _clock?.Read();
        if (r is not { } c) return;
        ClockNow.Text = $"{c.Mhz / 1000:0.00} GHz";
        ClockOf.Text = Loc.I.F("tune.ofrated", c.Perf.ToString("0"), (Power.RatedMhz / 1000.0).ToString("0.00"));
        LoadNow.Text = c.Utility.ToString("0") + "%";
        ClockNow.Foreground = (System.Windows.Media.Brush)FindResource(c.Perf < 60 ? "Danger" : c.Perf < 90 ? "Warn" : "Text");

        // The finding that matters most: the CPU is busy but held below its clock.
        string? find = null;
        if (c.Utility > 40 && c.Perf < 85) find = Loc.I.F(Power.OnBattery ? "tune.throttled.battery" : "tune.throttled", c.Perf.ToString("0"));
        else if (_state?.Values["max"].Ac is int max && max < 100) find = Loc.I.F("tune.capped", max);
        Finding.Visibility = find is null ? Visibility.Collapsed : Visibility.Visible;
        FindingText.Text = find ?? "";
    }

    // ── CPU & power ─────────────────────────────────────────────────────────

    private async Task Reload(bool chooseDefaults)
    {
        _state = await Task.Run(Power.Read);
        Power.Evaluate(_state, _tweaks);
        foreach (var t in _tweaks)
        {
            if (t.Active == true || !t.Available) t.Chosen = false;
            else if (chooseDefaults) t.Chosen = Power.Recommended(t.Id);
        }
        foreach (var s in _services)
        {
            var (present, start, running) = _state.Services[s.Name];
            s.Present = present; s.Running = running; s.StartType = start;
            s.Relocalize();
        }
        PlanNow.Text = _state.ActiveName;
        UpdatePower();
    }

    private void UpdatePower()
    {
        int n = _tweaks.Count(t => t.Chosen && t.Active != true && t.Available);
        BtnApplyText.Text = n == 0 ? Loc.I["tw.allset"] : Loc.I.F("tw.apply", n);
        BtnApply.IsEnabled = n > 0 && !_busy;
        var at = Power.BackupAt;
        BtnRestore.Visibility = at is null ? Visibility.Collapsed : Visibility.Visible;
        PowerNote.Text = at is { } d ? Loc.I.F("tw.backup", d.ToLocalTime().ToString("yyyy-MM-dd HH:mm")) : Loc.I["tw.note"];
    }

    private void Tweak_Click(object s, RoutedEventArgs e) => UpdatePower();

    private async void Apply_Click(object s, RoutedEventArgs e)
    {
        _busy = true; UpdatePower();
        var (ok, msg) = await Power.Apply(_tweaks.Where(t => t.Chosen && t.Active != true).Select(t => t.Id).ToList());
        if (ok) History.Add(new Run(DateTime.UtcNow, 0, 1, 0, [Loc.I["tw.log"]]));
        Main.Toast(ok ? Loc.I["tw.applied"] : msg.Length > 0 ? msg : Loc.I["tw.notrecorded"], ok);
        _busy = false;
        await Reload(chooseDefaults: false);
    }

    private async void Restore_Click(object s, RoutedEventArgs e)
    {
        if (!await Main.Ask(Loc.I["tw.restore"], Loc.I["tw.restore.q"], Loc.I["tw.restore"])) return;
        _busy = true; UpdatePower();
        var (ok, msg) = await Power.Restore();
        Main.Toast(ok ? Loc.I["tw.restored"] : msg.Length > 0 ? msg : Loc.I["tw.notrecorded"], ok);
        if (ok) History.Add(new Run(DateTime.UtcNow, 0, 1, 0, [Loc.I["tw.restored"]]));
        _busy = false;
        await Reload(chooseDefaults: true);
    }

    // ── services ────────────────────────────────────────────────────────────

    private static async Task<bool?> SystemDriveIsSsd()
    {
        var sys = Environment.GetFolderPath(Environment.SpecialFolder.Windows)[..1];
        var j = await Ps.Json($"$n = (Get-Partition -DriveLetter {sys}).DiskNumber; (Get-PhysicalDisk | Where-Object DeviceId -eq \"$n\" | Select-Object -First 1).MediaType", 40);
        var m = j?.ToString() ?? "";
        return m.Contains("SSD", StringComparison.OrdinalIgnoreCase) || m == "4" ? true
             : m.Contains("HDD", StringComparison.OrdinalIgnoreCase) || m == "3" ? false : null;
    }

    private void ShowServiceNote() => SvcNote.Text = Loc.I[_ssd switch { true => "svc.ssd", false => "svc.hdd", _ => "svc.unknown" }];

    private async void Service_Click(object s, RoutedEventArgs e)
    {
        if (s is not CheckBox { DataContext: Svc svc } cb) return;
        bool on = cb.IsChecked == true;
        cb.IsEnabled = false;
        var (ok, msg) = await Power.SetService(svc.Name, on);
        Main.Toast(ok ? Loc.I.F(on ? "svc.turnedon" : "svc.turnedoff", svc.Title) : msg.Length > 0 ? msg : Loc.I["tw.notrecorded"], ok);
        if (ok) History.Add(new Run(DateTime.UtcNow, 0, 1, 0, [Loc.I.F(on ? "svc.turnedon" : "svc.turnedoff", svc.Title)]));
        await Reload(chooseDefaults: false);
        cb.IsEnabled = true;
        cb.IsChecked = svc.On;
    }

    // ── Defender ────────────────────────────────────────────────────────────

    private async Task LoadDefender()
    {
        _def = await Defender.Read();
        _exclusions.Clear();
        foreach (var x in Defender.Suggestions(_def)) _exclusions.Add(x);
        ShowDefender();
    }

    private void ShowDefender()
    {
        if (_def is null) return;
        if (!_def.Available)
        {
            DefStatus.Text = Loc.I["def.unavailable"];
            BtnExclude.IsEnabled = false;
            RealTime.IsEnabled = false;
            return;
        }
        var parts = new List<string>
        {
            Loc.I[_def.RealTime ? "def.rt.on" : "def.rt.off"],
            _def.Running ? Loc.I.F("def.mem", _def.MemoryMb) : "",
            _def.CpuCap > 0 ? Loc.I.F("def.cap", _def.CpuCap) : "",
            _def.Exclusions is null ? Loc.I["def.hidden"] : Loc.I.F("def.count", _def.Exclusions.Count),
        };
        DefStatus.Text = string.Join("  ·  ", parts.Where(p => p.Length > 0));
        int n = _exclusions.Count(x => x.Chosen && x.Covered != true);
        BtnExcludeText.Text = n == 0 ? Loc.I["def.nothing"] : Loc.I.F("def.exclude", n);
        BtnExclude.IsEnabled = n > 0 && !_busy;
        RealTime.IsChecked = _def.RealTime;
        RealTime.IsEnabled = !_busy && _def.Tamper != true;
        RealTimeNote.Text = _def.Tamper == true ? Loc.I["def.tamper"] : Loc.I["def.realtime.d"];
    }

    private void ExclusionTick_Click(object s, RoutedEventArgs e) => ShowDefender();

    private async void Exclude_Click(object s, RoutedEventArgs e)
    {
        var paths = _exclusions.Where(x => x.Chosen && x.Covered != true).Select(x => x.Path).ToList();
        _busy = true; ShowDefender();
        var r = await Defender.Exclude(paths);
        _busy = false;
        Main.Toast(r.Refused ? Loc.I["admin.refused"] : r.Ok ? Loc.I.F("def.done", paths.Count) : r.Output, r.Ok);
        if (r.Ok) History.Add(new Run(DateTime.UtcNow, 0, paths.Count, 0, [Loc.I.F("def.done", paths.Count)]));
        if (r.Ok) foreach (var x in _exclusions.Where(x => paths.Contains(x.Path))) { x.Covered = true; x.Chosen = false; }
        ShowDefender();
        var fresh = await Defender.Read();
        _def = fresh;
        if (fresh.Exclusions is { } list) foreach (var x in _exclusions) x.Covered = Defender.IsCovered(x.Path, list);
        ShowDefender();
    }

    private async void RealTime_Click(object s, RoutedEventArgs e)
    {
        bool on = RealTime.IsChecked == true;
        RealTime.IsChecked = !on; // stays where it was until Windows confirms
        if (!on && !await Main.Ask(Loc.I["def.off.title"], Loc.I["def.off.q"], Loc.I["def.off.go"])) return;
        _busy = true; ShowDefender();
        var r = await Defender.SetRealTime(on);
        _busy = false;
        _def = await Defender.Read();
        bool ok = _def.RealTime == on;
        Main.Toast(r.Refused ? Loc.I["admin.refused"] : ok ? Loc.I[on ? "def.rt.on" : "def.rt.off"] : Loc.I["tw.notrecorded"], ok);
        ShowDefender();
    }
}
