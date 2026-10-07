using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Rocket.Core;

namespace Rocket;

// Quick clean: the catalog, measured in parallel, grouped into cards.
public partial class MainWindow
{
    private static readonly (string Key, string Glyph)[] GroupOrder =
    [
        ("system", ""), ("dev", ""), ("editors", ""), ("ai", ""), ("apps", ""), ("files", ""),
    ];

    private readonly ObservableCollection<Group> _groups = [];
    private CancellationTokenSource? _cleanScan;
    private bool _totalsQueued;

    private async Task ScanClean()
    {
        _cleanScan?.Cancel();
        var cts = _cleanScan = new CancellationTokenSource();
        var sw = Stopwatch.StartNew();

        BtnCleanRescan.IsEnabled = false;
        BtnClean.IsEnabled = false;
        CleanBar.IsIndeterminate = true;
        CleanStatus.Text = Loc.I["common.scanning"];
        _groups.Clear();
        CleanGroups.ItemsSource = _groups;

        var items = await Task.Run(Catalog.Build);
        if (cts.IsCancellationRequested) return;

        foreach (var (key, glyph) in GroupOrder)
        {
            var g = new Group { Key = key, Glyph = glyph };
            foreach (var it in items.Where(i => i.Group == key))
            {
                it.IsChecked = it.Risk == Risk.Safe && !it.Locked;
                it.Changed += QueueCleanTotals;
                g.Items.Add(it);
            }
            if (g.Items.Count > 0) _groups.Add(g);
        }

        int done = 0;
        var tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        tick.Tick += (_, _) =>
        {
            CleanStatus.Text = Loc.I.F("common.measuring", done, items.Count);
            CleanBar.IsIndeterminate = false;
            CleanBar.Value = items.Count == 0 ? 1 : (double)done / items.Count;
            UpdateCleanTotals();
        };
        tick.Start();

        try
        {
            // Small items first finish quickly and fill the page; the four workers then
            // share the big trees between them.
            await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = cts.Token },
                (it, ct) =>
                {
                    try { Engine.Measure(it, ct); }
                    catch (OperationCanceledException) { throw; }
                    catch { it.Bytes = 0; }
                    Interlocked.Increment(ref done);
                    return ValueTask.CompletedTask;
                });
        }
        catch (OperationCanceledException) { tick.Stop(); return; }
        tick.Stop();

        // Biggest first, inside each card and across cards; drop what is empty.
        var sorted = _groups.Select(g =>
        {
            var keep = g.Items.Where(i => i.Bytes == -2 || i.Bytes >= 1 << 20).OrderByDescending(i => i.Bytes).ToList();
            g.Items.Clear();
            foreach (var i in keep) g.Items.Add(i);
            return g;
        }).Where(g => g.Items.Count > 0).OrderByDescending(g => g.Total).ToList();
        _groups.Clear();
        foreach (var g in sorted) _groups.Add(g);

        CleanBar.Value = 1;
        CleanStatus.Text = Loc.I.F("common.ready", $"{sw.Elapsed.TotalSeconds:0.0}s");
        BtnCleanRescan.IsEnabled = true;
        UpdateCleanTotals();
    }

    /// <summary>For the overview: what the scans have found so far, and whether they are still going.</summary>
    public (long Clean, long Projects, long Models, bool Scanning) Reclaimable()
    {
        long clean = _groups.SelectMany(g => g.Items).Where(i => i.IsChecked && i.Bytes > 0).Sum(i => i.Bytes);
        long projects = _projectItems.Where(i => i.Bytes > 0).Sum(i => i.Bytes);
        long models = _modelItems.Where(i => i.Bytes > 0).Sum(i => i.Bytes);
        return (clean, projects, models, !BtnCleanRescan.IsEnabled || _projScanning);
    }

    private void QueueCleanTotals()
    {
        if (_totalsQueued) return;
        _totalsQueued = true;
        Dispatcher.BeginInvoke(() => { _totalsQueued = false; UpdateCleanTotals(); }, DispatcherPriority.Background);
    }

    private void UpdateCleanTotals()
    {
        var all = _groups.SelectMany(g => g.Items).ToList();
        long found = all.Where(i => i.Bytes > 0 && !i.Locked).Sum(i => i.Bytes);
        long sel = all.Where(i => i.IsChecked && i.Bytes > 0).Sum(i => i.Bytes);
        int n = all.Count(i => i.IsChecked);
        CleanSelected.Text = Format.Bytes(sel);
        CleanFound.Text = Loc.I.F("common.found", Format.Bytes(found), all.Count);
        BtnCleanText.Text = _jobRunning ? Loc.I["job.busy"] : n == 0 ? Loc.I["common.nothing"] : Loc.I.F("common.clean", Format.Bytes(sel));
        BtnClean.IsEnabled = n > 0 && !_jobRunning && BtnCleanRescan.IsEnabled;
        foreach (var g in _groups) g.Refresh();

        long locked = all.Where(i => i.Locked && i.Bytes > 0).Sum(i => i.Bytes);
        AdminBanner.Visibility = !Native.IsAdmin && all.Any(i => i.Locked) ? Visibility.Visible : Visibility.Collapsed;
        AdminText.Text = Loc.I.F("admin.banner", locked > 0 ? Format.Bytes(locked) : "…");
    }

    private void GroupTick_Click(object s, RoutedEventArgs e)
    {
        // Three-state boxes cycle on → partly → off. Read it as two: a click on a ticked box
        // clears the card, any other click ticks all of it.
        if (s is CheckBox { DataContext: Group g } cb) g.AllChecked = cb.IsChecked != null;
        UpdateCleanTotals();
    }

    private async void CleanRescan_Click(object s, RoutedEventArgs e) => await ScanClean();

    private async void Clean_Click(object s, RoutedEventArgs e)
    {
        var items = _groups.SelectMany(g => g.Items).ToList();
        var freed = await RunClean(items);
        if (freed == 0 && items.All(i => i.State == "")) return;

        // Measure again what was cleaned: what is left is what was in use.
        foreach (var it in items.Where(i => i.State is "done" or "partial").ToList())
        {
            await Task.Run(() => { try { Engine.Measure(it, default); } catch { } });
        }
        UpdateCleanTotals();
    }
}
