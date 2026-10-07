using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Threading;
using Rocket.Core;

namespace Rocket.Pages;

/// <summary>Something worth doing about the machine right now.</summary>
public sealed record Finding(string Text, bool Warn, string? ActionText = null, ProcRow? Target = null)
{
    public bool HasAction => ActionText != null;
}

public partial class ProcessesPage : PageBase
{
    private readonly ObservableCollection<ProcRow> _rows = [];
    private readonly Dictionary<string, ProcRow> _byKey = [];
    private readonly ProcSampler _sampler = new();
    private readonly DispatcherTimer _tick = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly ListCollectionView _view;
    private Dictionary<int, string> _cmd = [];
    private string _group = "all";
    private int _beat;
    private bool _sampling, _settingPriority, _askingCmd;

    public List<string> PriorityNames { get; private set; } = [];

    public ProcessesPage()
    {
        InitializeComponent();
        _view = new ListCollectionView(_rows) { IsLiveSorting = true, IsLiveFiltering = true };
        _view.LiveSortingProperties.Add(nameof(ProcRow.Cpu));
        _view.LiveSortingProperties.Add(nameof(ProcRow.Memory));
        _view.Filter = Keep;
        List.ItemsSource = _view;
        _tick.Tick += async (_, _) => await Sample();
        BuildChrome();
    }

    protected override async void OnShown()
    {
        _tick.Start();
        await Sample();
    }

    public override void Hidden() => _tick.Stop();

    protected override void Relocalize() => BuildChrome();

    private void BuildChrome()
    {
        PriorityNames = new[] { "proc.p.idle", "proc.p.below", "proc.p.normal", "proc.p.above", "proc.p.high" }.Select(k => Loc.I[k]).ToList();
        var sort = SortBox.SelectedIndex;
        SortBox.ItemsSource = new[] { Loc.I["proc.sort.cpu"], Loc.I["proc.sort.mem"], Loc.I["proc.sort.name"] };
        SortBox.SelectedIndex = Math.Max(0, sort);
        GroupPills.Children.Clear();
        foreach (var g in Procs.Groups)
        {
            var rb = new RadioButton
            {
                Style = (Style)FindResource("Pill"), GroupName = "procgroup", Tag = g, IsChecked = g == _group,
                Content = new TextBlock { Text = Loc.I["proc.g." + g], FontSize = 12 },
            };
            rb.Checked += (s, _) => { _group = (string)((RadioButton)s).Tag; _view.Refresh(); };
            GroupPills.Children.Add(rb);
        }
    }

    private bool Keep(object o)
    {
        if (o is not ProcRow r) return false;
        if (_group != "all" && r.Group != _group) return false;
        var q = Search.Text.Trim();
        return q.Length == 0 || r.Name.Contains(q, StringComparison.OrdinalIgnoreCase) || r.Detail.Contains(q, StringComparison.OrdinalIgnoreCase)
               || r.Pids.Any(p => p.ToString() == q);
    }

    private void Sort_Changed(object s, SelectionChangedEventArgs e)
    {
        _view.SortDescriptions.Clear();
        switch (SortBox.SelectedIndex)
        {
            case 1: _view.SortDescriptions.Add(new SortDescription(nameof(ProcRow.Memory), ListSortDirection.Descending)); break;
            case 2: _view.SortDescriptions.Add(new SortDescription(nameof(ProcRow.Name), ListSortDirection.Ascending)); break;
            default:
                _view.SortDescriptions.Add(new SortDescription(nameof(ProcRow.Cpu), ListSortDirection.Descending));
                _view.SortDescriptions.Add(new SortDescription(nameof(ProcRow.Memory), ListSortDirection.Descending));
                break;
        }
    }

    private void Search_Changed(object s, TextChangedEventArgs e) => _view.Refresh();

    // ── sampling ────────────────────────────────────────────────────────────

    private async Task Sample()
    {
        if (_sampling) return;
        _sampling = true;
        try
        {
            // Command lines come from a slow CIM query: ask in the background, use them when they land.
            if (_beat++ % 4 == 0 && !_askingCmd)
            {
                _askingCmd = true;
                _ = Procs.CommandLines().ContinueWith(t => { if (t.IsCompletedSuccessfully) _cmd = t.Result; _askingCmd = false; });
            }
            var procs = await Task.Run(_sampler.Sample);
            double cpu = Perf.Cpu();
            var mem = Perf.Memory();

            // Programs collapse into one row; dev runtimes stay one row per process.
            var seen = new HashSet<string>();
            foreach (var g in procs.GroupBy(p => Procs.Detailed.Contains(p.Name) ? p.Name + "#" + p.Id : p.Name, StringComparer.OrdinalIgnoreCase))
            {
                var first = g.First();
                var key = g.Key;
                seen.Add(key);
                if (!_byKey.TryGetValue(key, out var row))
                {
                    row = new ProcRow
                    {
                        Key = key, Name = first.Name, Group = Procs.Group(first.Name),
                        Protected = Procs.IsProtected(first.Name) || g.Any(p => p.Id == Environment.ProcessId),
                    };
                    _byKey[key] = row;
                    _rows.Add(row);
                }
                row.Pids = g.Select(p => p.Id).ToList();
                row.Count = row.Pids.Count;
                row.Cpu = g.Sum(p => p.Cpu);
                row.Memory = g.Sum(p => p.Memory);
                row.Path = first.Path;
                if (!_settingPriority) row.Priority = Procs.PriorityIndex(first.Priority);
                row.Detail = _cmd.TryGetValue(first.Id, out var cl) && !string.IsNullOrEmpty(cl) ? Trim(cl)
                           : first.Path ?? Loc.I["proc.g." + row.Group];
            }
            foreach (var gone in _byKey.Keys.Where(k => !seen.Contains(k)).ToList())
            {
                _rows.Remove(_byKey[gone]);
                _byKey.Remove(gone);
            }

            CpuNow.Text = (cpu * 100).ToString("0") + "%";
            CpuNow.Foreground = Tone(cpu > 0.85, cpu > 0.6);
            double used = mem.Total == 0 ? 0 : 1 - (double)mem.Available / mem.Total;
            MemNow.Text = (used * 100).ToString("0") + "%";
            MemNow.Foreground = Tone(used > 0.85, used > 0.7);
            MemBar.Value = used;
            MemOf.Text = Loc.I.F("proc.memof", Format.Bytes((long)(mem.Total - mem.Available)), Format.Bytes((long)mem.Total));
            CountNow.Text = procs.Count.ToString();
            var up = TimeSpan.FromMilliseconds(Environment.TickCount64);
            UptimeNow.Text = up.TotalDays >= 1 ? Loc.I.F("proc.days", (int)up.TotalDays, up.Hours) : Loc.I.F("proc.hours", up.Hours, up.Minutes);
            Findings.ItemsSource = Find(used, up).OrderByDescending(f => f.Warn).Take(3).ToList();
        }
        finally { _sampling = false; }
    }

    private static string Trim(string cmd) => cmd.Length > 240 ? cmd[..240] + "…" : cmd;

    private System.Windows.Media.Brush Tone(bool danger, bool warn)
        => (System.Windows.Media.Brush)FindResource(danger ? "Danger" : warn ? "Warn" : "Text");

    private List<Finding> Find(double memUsed, TimeSpan up)
    {
        var list = new List<Finding>();
        var byGroup = _rows.Where(r => r.Group is not "system" and not "security")
            .GroupBy(r => r.Group).Select(g => (Group: g.Key, Mem: g.Sum(r => r.Memory))).OrderByDescending(g => g.Mem).FirstOrDefault();
        if (memUsed > 0.85)
            list.Add(new Finding(Loc.I.F("proc.f.mem", (memUsed * 100).ToString("0"), Loc.I["proc.g." + byGroup.Group], Format.Bytes(byGroup.Mem)), true));
        else if (memUsed > 0.7 && byGroup.Group != null)
            list.Add(new Finding(Loc.I.F("proc.f.memwarn", (memUsed * 100).ToString("0"), Loc.I["proc.g." + byGroup.Group], Format.Bytes(byGroup.Mem)), false));
        if (up.TotalHours > 24 && memUsed > 0.7)
            list.Add(new Finding(Loc.I.F("proc.f.uptime", (int)up.TotalDays), false));

        var busiest = _rows.Where(r => !r.Protected).OrderByDescending(r => r.Cpu).FirstOrDefault();
        if (busiest is { Cpu: > 0.25 } && busiest.Priority >= 2)
            list.Add(new Finding(Loc.I.F("proc.f.cpu", busiest.Name, (busiest.Cpu * 100).ToString("0")), true, Loc.I["proc.f.lower"], busiest));

        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.DriveType != DriveType.Fixed || !d.IsReady || d.TotalSize == 0) continue;
                double free = (double)d.AvailableFreeSpace / d.TotalSize;
                if (free < 0.10) list.Add(new Finding(Loc.I.F("proc.f.disk", d.Name.TrimEnd('\\'), Format.Bytes(d.AvailableFreeSpace)), free < 0.05));
            }
            catch { }
        }
        return list;
    }

    private void FindingAction_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is Finding { Target: { } row })
        {
            int failed = Procs.SetPriority(row, System.Diagnostics.ProcessPriorityClass.BelowNormal);
            row.Priority = 1;
            Main.Toast(failed == 0 ? Loc.I.F("proc.lowered", row.Name) : Loc.I["proc.denied"], failed == 0);
        }
    }

    // ── actions ─────────────────────────────────────────────────────────────

    private void Priority_Changed(object s, SelectionChangedEventArgs e)
    {
        if (s is not ComboBox { DataContext: ProcRow row } cb || !cb.IsDropDownOpen && !cb.IsKeyboardFocusWithin) return;
        if (cb.SelectedIndex < 0 || cb.SelectedIndex == row.Priority) return;
        _settingPriority = true;
        int failed = Procs.SetPriority(row, Procs.Priorities[cb.SelectedIndex]);
        row.Priority = failed == row.Pids.Count ? row.Priority : cb.SelectedIndex;
        _settingPriority = false;
        Main.Toast(failed == 0 ? Loc.I.F("proc.prioset", row.Name, PriorityNames[cb.SelectedIndex]) : Loc.I["proc.denied"], failed == 0);
    }

    private async void End_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is not ProcRow row || row.Protected) return;
        var body = row.Count > 1 ? Loc.I.F("proc.end.many", row.Name, row.Count) : Loc.I.F("proc.end.one", row.Name);
        if (!await Main.Ask(Loc.I["proc.end"], body, Loc.I["proc.end"])) return;
        int failed = Procs.End(row);
        Main.Toast(failed == 0 ? Loc.I.F("proc.ended", row.Name) : Loc.I.F("proc.endfailed", failed), failed == 0);
        await Task.Delay(400);
        await Sample();
    }
}
