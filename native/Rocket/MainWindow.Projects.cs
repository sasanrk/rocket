using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Win32;
using Rocket.Core;

namespace Rocket;

// Projects: one walk over the drives finds node_modules, build outputs and caches,
// grouped one row per project and kind. The same walk turns up loose model files.
public partial class MainWindow
{
    private static readonly int[] IdleChoices = [0, 3, 7, 14, 30, 60, 90];

    private readonly ObservableCollection<Item> _projectItems = [];
    private readonly ObservableCollection<Item> _modelItems = [];
    private CancellationTokenSource? _projScan;
    private bool _projQueued, _modelQueued, _projScanning;
    private List<string> _roots = [];

    private void InitProjects()
    {
        ProjectList.ItemsSource = _projectItems;
        ModelList.ItemsSource = _modelItems;
        FillIdleCombo();
        _roots = Projects.DefaultRoots().Concat(Settings.Current.ExtraRoots.Where(Directory.Exists))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        ShowRoots();
    }

    private bool _fillingIdle;
    private void FillIdleCombo()
    {
        _fillingIdle = true;
        IdleCombo.ItemsSource = IdleChoices.Select(d => Loc.I.F("projects.days", d)).ToList();
        IdleCombo.SelectedIndex = Math.Max(0, Array.IndexOf(IdleChoices, Settings.Current.IdleDays));
        _fillingIdle = false;
    }

    private void ShowRoots()
    {
        var drives = _roots.Select(r => Path.GetPathRoot(r)!.TrimEnd('\\')).Distinct(StringComparer.OrdinalIgnoreCase);
        ProjRoots.Text = Loc.I.F("projects.where", string.Join(", ", drives));
        ProjRoots.ToolTip = string.Join("\n", _roots);
    }

    private static string KindLabel(string kind) => Loc.I["kind." + kind];

    private static bool Rebuildable(string kind) => kind is Projects.BuildCache or Projects.BuildOutput or Projects.PyCache;

    /// <summary>Caches always; node_modules and virtualenvs once the project has been idle long enough.</summary>
    private void ApplyIdleRule(Item it)
    {
        if (it.Payload is null) return;
        it.IsChecked = it.Risk == Risk.Safe && (Rebuildable(it.Payload) || it.IdleDays >= Settings.Current.IdleDays);
    }

    private async Task ScanProjects()
    {
        _projScan?.Cancel();
        var cts = _projScan = new CancellationTokenSource();
        var ct = cts.Token;
        var sw = Stopwatch.StartNew();
        _projScanning = true;
        BtnProjectsScan.IsEnabled = false;
        BtnProjClean.IsEnabled = false;
        _projectItems.Clear();
        ProjBar.IsIndeterminate = true;
        Projects.ResetActivity();

        // Walk and measure at once: the walk queues what it finds, two workers measure it.
        // One row per project and kind — a monorepo's twelve node_modules are one decision.
        var rows = new ConcurrentDictionary<string, Item>(StringComparer.OrdinalIgnoreCase);
        var queue = new BlockingCollection<(Item Row, string Path)>();
        var loose = new ConcurrentQueue<(string Path, long Len, DateTime W)>();
        int found = 0, measured = 0;
        bool walking = true;

        void OnArtifact(Artifact a)
        {
            Interlocked.Increment(ref found);
            var row = rows.GetOrAdd(a.ProjectRoot + "|" + a.Kind, _ =>
            {
                var root = a.ProjectRoot;
                var idle = (int)Math.Max(0, (DateTime.UtcNow - Projects.LastActivity(root)).TotalDays);
                var name = Path.GetFileName(root.TrimEnd('\\'));
                var parent = Path.GetFileName(Path.GetDirectoryName(root.TrimEnd('\\')) ?? "");
                var it = new Item
                {
                    Id = root + "|" + a.Kind, Group = "projects", Kind = Kind.Remove, Risk = a.Risk,
                    Name = string.IsNullOrEmpty(parent) ? name : $"{name}   ·  {parent}",
                    Project = root, ProjectPath = root, IdleDays = idle, Payload = a.Kind, Badge = KindLabel(a.Kind),
                };
                App.Ui(() => { it.Changed += QueueProjectTotals; _projectItems.Add(it); });
                return it;
            });
            int n;
            lock (row) { row.Paths.Add(a.Path); n = row.Paths.Count; }
            if (n > 1) row.Badge = KindLabel(a.Kind) + $" ×{n}";
            queue.Add((row, a.Path));
        }

        var measurers = Enumerable.Range(0, 2).Select(_ => Task.Run(() =>
        {
            foreach (var (row, path) in queue.GetConsumingEnumerable())
            {
                if (ct.IsCancellationRequested) continue;
                Tally t;
                try { t = Fs.Measure(path, ct); } catch { t = default; }
                lock (row)
                {
                    row.Files += t.Files;
                    row.Bytes = Math.Max(0, row.Bytes) + t.Bytes;
                }
                Interlocked.Increment(ref measured);
                App.Ui(() => ApplyIdleRule(row));
            }
        })).ToList();

        var tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        tick.Tick += (_, _) =>
        {
            int f = Volatile.Read(ref found), m = Volatile.Read(ref measured);
            ProjBar.IsIndeterminate = walking;
            if (!walking) ProjBar.Value = f == 0 ? 1 : (double)m / f;
            ProjStatus.Text = walking
                ? Loc.I.F("projects.walking", string.Join(", ", _roots.Select(r => Path.GetPathRoot(r)!.TrimEnd('\\')).Distinct()))
                  + "   " + Loc.I.F("projects.folders", f)
                : Loc.I.F("common.measuring", m, f);
            UpdateProjectTotals();
        };
        tick.Start();

        var roots = _roots.ToList();
        try
        {
            await Task.Run(() => Projects.Discover(roots, OnArtifact, (p, len, w) => loose.Enqueue((p, len, w)), ct), ct);
        }
        catch (OperationCanceledException) { }
        walking = false;
        queue.CompleteAdding();
        await Task.WhenAll(measurers);
        tick.Stop();
        if (ct.IsCancellationRequested) return;

        // Loose model files go to the models page.
        foreach (var (p, len, _) in loose)
        {
            if (_modelItems.Any(m => m.Paths.Contains(p, StringComparer.OrdinalIgnoreCase))) continue;
            var m = Models.Loose(p);
            m.Bytes = Fs.OnDisk(len);
            m.Changed += QueueModelTotals;
            _modelItems.Add(m);
        }
        SortModels();

        // let the last row additions land before sorting
        await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Background);
        var sorted = _projectItems.Where(i => i.Bytes >= 256 << 10).OrderByDescending(i => i.Bytes).ToList();
        _projectItems.Clear();
        foreach (var i in sorted) _projectItems.Add(i);

        _projScanning = false;
        ProjBar.IsIndeterminate = false;
        ProjBar.Value = 1;
        ProjStatus.Text = Loc.I.F("common.ready", $"{sw.Elapsed.TotalSeconds:0.0}s");
        BtnProjectsScan.IsEnabled = true;
        UpdateProjectTotals();
    }

    private void QueueProjectTotals()
    {
        if (_projQueued) return;
        _projQueued = true;
        Dispatcher.BeginInvoke(() => { _projQueued = false; UpdateProjectTotals(); }, DispatcherPriority.Background);
    }

    private void UpdateProjectTotals()
    {
        long found = _projectItems.Where(i => i.Bytes > 0).Sum(i => i.Bytes);
        long sel = _projectItems.Where(i => i.IsChecked && i.Bytes > 0).Sum(i => i.Bytes);
        int n = _projectItems.Count(i => i.IsChecked);
        int projects = _projectItems.Select(i => i.Project).Distinct().Count();
        ProjSelected.Text = Format.Bytes(sel);
        ProjFound.Text = Loc.I.F("common.found", Format.Bytes(found), projects);
        BtnProjCleanText.Text = _jobRunning ? Loc.I["job.busy"] : n == 0 ? Loc.I["common.nothing"] : Loc.I.F("common.clean", Format.Bytes(sel));
        BtnProjClean.IsEnabled = n > 0 && !_projScanning && !_jobRunning;
        NavProjectsHint.Text = found > 0 ? $"{Format.Bytes(found)} · {Loc.I["nav.projects.hint"]}" : Loc.I["nav.projects.hint"];
    }

    private void Idle_Changed(object s, SelectionChangedEventArgs e)
    {
        if (_fillingIdle || IdleCombo.SelectedIndex < 0) return;
        Settings.Current.IdleDays = IdleChoices[IdleCombo.SelectedIndex];
        Settings.Current.Save();
        foreach (var it in _projectItems) ApplyIdleRule(it);
        UpdateProjectTotals();
    }

    private void ProjCachesOnly_Click(object s, RoutedEventArgs e)
    {
        foreach (var it in _projectItems) it.IsChecked = it.Payload is { } k && Rebuildable(k) && it.Risk == Risk.Safe;
    }

    private void ProjAll_Click(object s, RoutedEventArgs e) { foreach (var it in _projectItems) it.IsChecked = true; }
    private void ProjNone_Click(object s, RoutedEventArgs e) { foreach (var it in _projectItems) it.IsChecked = false; }

    private async void ProjAddRoot_Click(object s, RoutedEventArgs e)
    {
        var dlg = new OpenFolderDialog();
        if (dlg.ShowDialog(this) != true) return;
        if (!Settings.Current.ExtraRoots.Contains(dlg.FolderName, StringComparer.OrdinalIgnoreCase))
        {
            Settings.Current.ExtraRoots.Add(dlg.FolderName);
            Settings.Current.Save();
        }
        if (!_roots.Contains(dlg.FolderName, StringComparer.OrdinalIgnoreCase)) _roots.Add(dlg.FolderName);
        ShowRoots();
        await ScanProjects();
    }

    private async void ProjectsScan_Click(object s, RoutedEventArgs e) => await ScanProjects();

    private async void ProjectMove_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is not Item { ProjectPath: { } root }) return;
        if (await MoveFolder(root))
        {
            foreach (var it in _projectItems.Where(i => string.Equals(i.ProjectPath, root, StringComparison.OrdinalIgnoreCase)).ToList())
                _projectItems.Remove(it);
            UpdateProjectTotals();
        }
    }

    private async void ProjClean_Click(object s, RoutedEventArgs e)
    {
        await RunClean(_projectItems.ToList());
        foreach (var it in _projectItems.Where(i => i.State == "done").ToList()) _projectItems.Remove(it);
        UpdateProjectTotals();
    }

    // ── AI models ───────────────────────────────────────────────────────────

    private async Task ScanModels()
    {
        var keepLoose = _modelItems.Where(m => m.Id.StartsWith("file.")).ToList();
        _modelItems.Clear();
        var list = await Task.Run(Models.Find);
        foreach (var m in list.Concat(keepLoose))
        {
            m.Changed += QueueModelTotals;
            _modelItems.Add(m);
        }
        UpdateModelTotals();
        await Parallel.ForEachAsync(list, new ParallelOptions { MaxDegreeOfParallelism = 3 }, (it, ct) =>
        {
            try { Engine.Measure(it, ct); } catch { it.Bytes = 0; }
            return ValueTask.CompletedTask;
        });
        SortModels();
    }

    private void SortModels()
    {
        var sorted = _modelItems.Where(m => m.Bytes != 0).OrderByDescending(m => m.Bytes).ToList();
        _modelItems.Clear();
        foreach (var m in sorted) _modelItems.Add(m);
        UpdateModelTotals();
    }

    private void QueueModelTotals()
    {
        if (_modelQueued) return;
        _modelQueued = true;
        Dispatcher.BeginInvoke(() => { _modelQueued = false; UpdateModelTotals(); }, DispatcherPriority.Background);
    }

    private void UpdateModelTotals()
    {
        long found = _modelItems.Where(i => i.Bytes > 0).Sum(i => i.Bytes);
        long sel = _modelItems.Where(i => i.IsChecked && i.Bytes > 0).Sum(i => i.Bytes);
        int n = _modelItems.Count(i => i.IsChecked);
        ModelsSelected.Text = Format.Bytes(found);
        ModelsFound.Text = Loc.I.F("common.found", Format.Bytes(found), _modelItems.Count) + "   ·   " + Loc.I["models.loose"];
        BtnModelsCleanText.Text = _jobRunning ? Loc.I["job.busy"] : n == 0 ? Loc.I["common.nothing"] : Loc.I.F("common.clean", Format.Bytes(sel));
        BtnModelsClean.IsEnabled = n > 0 && !_jobRunning;
        ModelsEmpty.Text = Loc.I["models.none"];
        ModelsEmpty.Visibility = _modelItems.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void ModelsScan_Click(object s, RoutedEventArgs e) => await ScanModels();

    private async void ModelsClean_Click(object s, RoutedEventArgs e)
    {
        await RunClean(_modelItems.ToList());
        foreach (var it in _modelItems.Where(i => i.State == "done").ToList()) _modelItems.Remove(it);
        UpdateModelTotals();
    }
}
