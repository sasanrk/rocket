using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Rocket.Core;

namespace Rocket;

/// <summary>A fixed drive in the rail, refreshed every couple of seconds.</summary>
public sealed class DriveVm : Bindable
{
    public required string Root { get; init; }
    public string Letter => Root.TrimEnd('\\');
    private string _name = "";
    public string Name { get => _name; set => Set(ref _name, value); }
    private long _total, _free;

    public void Update(DriveInfo d)
    {
        try
        {
            _total = d.TotalSize;
            _free = d.AvailableFreeSpace;
            Name = string.IsNullOrWhiteSpace(d.VolumeLabel) ? Letter : $"{Letter}  {d.VolumeLabel}";
        }
        catch { }
        Raise(nameof(FreeText)); Raise(nameof(FreeShort)); Raise(nameof(PercentText)); Raise(nameof(BarWidth)); Raise(nameof(Critical));
    }

    public double Used => _total == 0 ? 0 : 1 - (double)_free / _total;
    public string FreeText => Loc.I.F("drive.free", Format.Bytes(_free), Format.Bytes(_total));
    public string PercentText => (Used * 100).ToString("0") + "%";
    public string FreeShort => Loc.I.F("drive.freeshort", Format.Bytes(_free));
    public double BarWidth => Math.Max(3, Used * 232);
    public bool Critical => _total > 0 && (_free < _total * 0.05 || _free < 5L << 30);
    public long Free => _free;
}

public partial class MainWindow : Window
{
    private readonly ObservableCollection<DriveVm> _drives = [];
    private readonly DispatcherTimer _driveTimer = new() { Interval = TimeSpan.FromSeconds(2) };

    public MainWindow()
    {
        InitializeComponent();
        DriveList.ItemsSource = _drives;
        MapDrives.ItemsSource = _drives;
        RefreshDrives();
        _driveTimer.Tick += (_, _) => RefreshDrives();
        _driveTimer.Start();

        AdminChip.Visibility = Native.IsAdmin ? Visibility.Visible : Visibility.Collapsed;
        ApplyLanguage();
        Loc.I.LanguageChanged += ApplyLanguage;
        StateChanged += (_, _) =>
        {
            MaxGlyph.Text = WindowState == WindowState.Maximized ? "" : "";
            Root.Margin = WindowState == WindowState.Maximized ? new Thickness(7) : new Thickness(0);
        };

        InitProjects();
        Loaded += async (_, _) =>
        {
            if (!AutoScan) return;
            // The disk is the bottleneck, so the scans take turns — but a slow Quick clean
            // item does not get to hold the other pages back for long.
            var clean = ScanClean();
            await Task.WhenAny(clean, Task.Delay(40_000));
            await ScanModels();
            await ScanProjects();
        };
    }

    // ── drives ──────────────────────────────────────────────────────────────

    private void RefreshDrives()
    {
        DriveInfo[] all;
        try { all = DriveInfo.GetDrives(); } catch { return; }
        foreach (var d in all)
        {
            bool ok;
            try { ok = d.DriveType == DriveType.Fixed && d.IsReady && d.TotalSize > 2L << 30; } catch { ok = false; }
            var vm = _drives.FirstOrDefault(x => x.Root.Equals(d.Name, StringComparison.OrdinalIgnoreCase));
            if (!ok) { if (vm != null) _drives.Remove(vm); continue; }
            if (vm is null) { vm = new DriveVm { Root = d.Name }; _drives.Add(vm); }
            vm.Update(d);
        }
    }

    private string FreeSummary() => string.Join("   ", _drives.Select(d => $"{d.Letter} {Format.Bytes(d.Free)}"));

    // ── chrome ──────────────────────────────────────────────────────────────

    private void TitleBar_Drag(object s, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2) { Maximize_Click(s, e); return; }
        if (e.ButtonState == MouseButtonState.Pressed) DragMove();
    }

    private void Minimize_Click(object s, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Maximize_Click(object s, RoutedEventArgs e)
        => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
    private void Close_Click(object s, RoutedEventArgs e) => Close();

    private void Lang_Click(object s, RoutedEventArgs e)
    {
        Settings.Current.Lang = Loc.I.IsFa ? "en" : "fa";
        Settings.Current.Save();
        Loc.I.Set(Settings.Current.Lang);
    }

    private void Theme_Click(object s, RoutedEventArgs e)
    {
        Settings.Current.Theme = App.IsDark ? "light" : "dark";
        Settings.Current.Save();
        App.ApplyTheme(Settings.Current.Theme);
        ThemeGlyph.Text = App.IsDark ? "" : "";
    }

    private void ApplyLanguage()
    {
        Root.FlowDirection = Loc.I.IsFa ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
        LangLabel.Text = Loc.I.IsFa ? "EN" : "FA";
        ThemeGlyph.Text = App.IsDark ? "" : "";
        MapUpGlyph.Text = "";
        foreach (var g in _groups) g.Relocalize();
        foreach (var i in _projectItems) i.Relocalize();
        foreach (var i in _modelItems) i.Relocalize();
        foreach (var d in _drives) d.Update(new DriveInfo(d.Root));
        UpdateCleanTotals();
        UpdateProjectTotals();
        UpdateModelTotals();
        FillIdleCombo();
        ShowRoots();
        if (_mapNode != null) ShowNode(_mapNode);
        ShowHistory();
    }

    // ── navigation ──────────────────────────────────────────────────────────

    private (RadioButton Nav, FrameworkElement Page)[] Pages => [
        (NavOverview, PageOverview), (NavClean, PageClean), (NavProjects, PageProjects), (NavModels, PageModels),
        (NavPrograms, PagePrograms), (NavMap, PageMap), (NavStartup, PageStartup), (NavProcesses, PageProcesses),
        (NavTune, PageTune), (NavSystem, PageSystem), (NavHistory, PageHistory),
    ];

    private void Nav_Checked(object s, RoutedEventArgs e)
    {
        if (PageClean is null || PageSystem is null) return;
        foreach (var (nav, page) in Pages)
        {
            bool on = nav.IsChecked == true;
            page.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
            // Pages that sample live data only do so while they are on screen.
            if (page is Pages.IPage p) { if (on) p.Shown(); else p.Hidden(); }
        }
        if (NavHistory.IsChecked == true) ShowHistory();
    }

    /// <summary>
    /// For --shot only: cleans a scratch tree it builds itself, accepts the confirmation and
    /// sends the job to the background, so the pill can be seen. Touches nothing else.
    /// </summary>
    public async Task TestBackgroundJob(string dir)
    {
        await Task.Run(() =>
        {
            var buf = new byte[3000];
            Parallel.For(0, 64, a =>
            {
                for (int b = 0; b < 16; b++)
                {
                    var d = Path.Combine(dir, a.ToString("x2"), b.ToString("x2"));
                    Directory.CreateDirectory(d);
                    for (int f = 0; f < 6; f++) File.WriteAllBytes(Path.Combine(d, f + ".bin"), buf);
                }
            });
        });
        var it = new Item { Id = "test", Group = "test", Kind = Kind.Remove, Paths = [dir], Name = "scratch test" };
        Engine.Measure(it, default);
        it.IsChecked = true;
        _ = RunClean([it]);
        _sheetAnswer?.TrySetResult(true);
        await Task.Delay(400);
        SheetHide_Click(this, new RoutedEventArgs());
    }

    /// <summary>Off in --shot runs that only look at pages which do not need the disk scans.</summary>
    public bool AutoScan { get; set; } = true;

    public void ShowPage(string page)
    {
        if (page.StartsWith("map:"))
        {
            NavMap.IsChecked = true;
            if (_drives.FirstOrDefault(d => d.Letter.StartsWith(page[4..], StringComparison.OrdinalIgnoreCase)) is { } d && _map?.Drive != d.Root)
                _ = MapDrive(d);
            return;
        }
        (page switch
        {
            "projects" => NavProjects, "models" => NavModels, "map" => NavMap, "history" => NavHistory,
            "clean" => NavClean, "programs" => NavPrograms, "startup" => NavStartup, "processes" => NavProcesses,
            "tune" => NavTune, "system" => NavSystem, _ => NavOverview,
        }).IsChecked = true;
    }

    private void Reveal_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is Item it && it.Paths.Count > 0) Native.Reveal(it.Paths[0]);
    }

    private void Elevate_Click(object s, RoutedEventArgs e)
    {
        if (Native.RestartElevated()) Close();
    }

    // ── history ─────────────────────────────────────────────────────────────

    private void ShowHistory()
    {
        var runs = History.Read();
        HistoryList.ItemsSource = runs;
        HistoryEmpty.Visibility = runs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        HistoryTotal.Text = runs.Count == 0 ? Loc.I["history.sub"] : Loc.I.F("history.total", Format.Bytes(runs.Sum(r => r.Freed)));
    }

    // ── the sheet: confirm, then progress, then the result ──────────────────

    private TaskCompletionSource<bool>? _sheetAnswer;
    private CancellationTokenSource? _cleanCts;

    /// <summary>A clean-up is running (in the sheet or in the background); no second one starts.</summary>
    private bool _jobRunning;
    /// <summary>The sheet was sent away; progress shows in the title-bar pill and the taskbar.</summary>
    private bool _jobInBackground;

    private Task<bool> Confirm(string title, string body, string note, string go)
    {
        SheetTitle.Text = title;
        SheetBody.Text = body;
        SheetNote.Text = note;
        SheetNote.Visibility = note.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        SheetProgress.Visibility = Visibility.Collapsed;
        SheetHide.Visibility = Visibility.Collapsed;
        SheetCancel.Content = Loc.I["common.cancel"];
        SheetCancel.Visibility = Visibility.Visible;
        SheetCancel.IsEnabled = true;
        SheetGo.Content = go;
        SheetGo.Visibility = Visibility.Visible;
        Sheet.Visibility = Visibility.Visible;
        _sheetAnswer = new TaskCompletionSource<bool>();
        return _sheetAnswer.Task;
    }

    private void SheetGo_Click(object s, RoutedEventArgs e) => _sheetAnswer?.TrySetResult(true);

    private void SheetCancel_Click(object s, RoutedEventArgs e)
    {
        if (_jobRunning && _cleanCts is { IsCancellationRequested: false } c && _sheetAnswer is null)
        {
            c.Cancel();
            SheetCancel.IsEnabled = false;
            return;
        }
        if (_sheetAnswer is { } a) { _sheetAnswer = null; a.TrySetResult(false); }
        Sheet.Visibility = Visibility.Collapsed;
        if (!_jobRunning) HideJobPill();
    }

    // Send the running clean-up behind the app: the pages stay usable, the pill reports.
    private void SheetHide_Click(object s, RoutedEventArgs e)
    {
        _jobInBackground = true;
        Sheet.Visibility = Visibility.Collapsed;
        JobPill.Visibility = Visibility.Visible;
    }

    private void JobPill_Click(object s, RoutedEventArgs e)
    {
        Sheet.Visibility = Visibility.Visible;
        if (_jobRunning) { _jobInBackground = false; JobPill.Visibility = Visibility.Collapsed; }
        else HideJobPill();
    }

    private void HideJobPill()
    {
        JobPill.Visibility = Visibility.Collapsed;
        Taskbar.ProgressState = System.Windows.Shell.TaskbarItemProgressState.None;
    }

    private readonly DispatcherTimer _toastTimer = new() { Interval = TimeSpan.FromSeconds(4) };

    /// <summary>One line at the bottom of the window about what just happened.</summary>
    public void Toast(string text, bool ok = true)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        ToastText.Text = text.Length > 300 ? text[..300] + "…" : text;
        ToastGlyph.Text = ok ? "" : "";
        ToastGlyph.Foreground = (System.Windows.Media.Brush)FindResource(ok ? "Success" : "Warn");
        ToastBox.Visibility = Visibility.Visible;
        _toastTimer.Stop();
        _toastTimer.Tick -= HideToast;
        _toastTimer.Tick += HideToast;
        _toastTimer.Start();
    }

    private void HideToast(object? s, EventArgs e) { _toastTimer.Stop(); ToastBox.Visibility = Visibility.Collapsed; }

    /// <summary>A yes/no question in the app's own sheet, for the pages.</summary>
    public async Task<bool> Ask(string title, string body, string go)
    {
        if (_jobRunning && !_jobInBackground) return false;
        var ok = await Confirm(title, body, "", go);
        _sheetAnswer = null;
        Sheet.Visibility = Visibility.Collapsed;
        return ok;
    }

    /// <summary>Lets a page run a clean-up through the shared sheet (programs' leftovers).</summary>
    public Task<long> Clean(List<Item> items) => RunClean(items);

    /// <summary>Set by --shot: close without asking about a running job.</summary>
    public bool ForceClose { get; set; }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        if (_jobRunning && !ForceClose)
        {
            if (MessageBox.Show(this, Loc.I["job.quit"], "Rocket", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            {
                e.Cancel = true;
                return;
            }
            _cleanCts?.Cancel();
        }
        base.OnClosing(e);
    }

    /// <summary>Clean buttons say "Cleaning…" and stay off while a job runs.</summary>
    private void SetJobRunning(bool on)
    {
        _jobRunning = on;
        UpdateCleanTotals();
        UpdateProjectTotals();
        UpdateModelTotals();
    }

    /// <summary>
    /// Asks, then deletes <paramref name="items"/> one after another with a live counter.
    /// The sheet can be sent to the background; the pages stay usable meanwhile.
    /// Returns the bytes freed (0 when the user said no).
    /// </summary>
    private async Task<long> RunClean(List<Item> items)
    {
        items = items.Where(i => i.IsChecked && !i.Locked).ToList();
        if (items.Count == 0 || _jobRunning) return 0;
        long total = items.Sum(i => Math.Max(0, i.Bytes));
        int review = items.Count(i => i.IsReview);
        var ok = await Confirm(Loc.I["confirm.title"],
            Loc.I.F("confirm.body", items.Count, Format.Bytes(total)),
            review > 0 ? Loc.I.F("confirm.review", review) : "",
            Loc.I["confirm.go"]);
        _sheetAnswer = null;
        if (!ok) { Sheet.Visibility = Visibility.Collapsed; return 0; }

        var st = new DeleteStats();
        using var cts = new CancellationTokenSource();
        _cleanCts = cts;
        _jobInBackground = false;
        HideJobPill();
        SetJobRunning(true);

        SheetTitle.Text = Loc.I["progress.title"];
        SheetBody.Text = "";
        SheetNote.Visibility = Visibility.Collapsed;
        SheetProgress.Visibility = Visibility.Visible;
        SheetGo.Visibility = Visibility.Collapsed;
        SheetHide.Visibility = Visibility.Visible;
        SheetCancel.Content = Loc.I["progress.stop"];
        SheetCancel.IsEnabled = true;
        SheetFreed.Text = Format.Bytes(0);
        SheetBar.IsIndeterminate = total <= 0;
        SheetBar.Value = 0;
        JobBar.Value = 0;
        JobText.Text = Loc.I.F("job.running", Format.Bytes(0));
        JobGlyph.Text = "";
        JobGlyph.Foreground = (System.Windows.Media.Brush)FindResource("Accent");
        Taskbar.ProgressState = System.Windows.Shell.TaskbarItemProgressState.Normal;

        int beat = 0;
        var tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(150) };
        tick.Tick += (_, _) =>
        {
            var b = Interlocked.Read(ref st.Bytes);
            double share = total > 0 ? Math.Min(1, (double)b / total) : 0;
            SheetFreed.Text = Format.Bytes(b);
            SheetBar.Value = share;
            JobText.Text = Loc.I.F("job.running", Format.Bytes(b));
            JobBar.Value = share;
            Taskbar.ProgressValue = share;
            if (++beat % 7 == 0) RefreshDrives();
        };
        tick.Start();

        var titles = new List<string>();
        foreach (var it in items)
        {
            if (cts.IsCancellationRequested) break;
            it.State = "cleaning";
            SheetCurrent.Text = it.Title + "   " + it.PathText;
            long before = Interlocked.Read(ref st.Bytes), failed = Interlocked.Read(ref st.Failed);
            try { await Engine.Clean(it, st, cts.Token); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { st.LastError = ex.Message; Interlocked.Increment(ref st.Failed); }
            it.Freed = Interlocked.Read(ref st.Bytes) - before;
            it.State = Interlocked.Read(ref st.Failed) > failed ? "partial" : "done";
            it.IsChecked = false;
            if (it.Freed > 0) titles.Add($"{it.Title} ({Format.Bytes(it.Freed)})");
        }
        tick.Stop();
        _cleanCts = null;

        long freed = Interlocked.Read(ref st.Bytes);
        History.Add(new Run(DateTime.UtcNow, freed, items.Count, st.Failed, titles));
        RefreshDrives();
        SetJobRunning(false);

        SheetTitle.Text = Loc.I["progress.done"];
        SheetFreed.Text = Format.Bytes(freed);
        SheetBar.IsIndeterminate = false;
        SheetBar.Value = 1;
        SheetCurrent.Text = Loc.I.F("progress.drives", FreeSummary());
        SheetBody.Text = st.Failed > 0 ? Loc.I.F("progress.skipped", Format.Count(st.Failed)) : "";
        SheetHide.Visibility = Visibility.Collapsed;
        SheetCancel.IsEnabled = true;
        SheetCancel.Content = Loc.I["common.close"];
        Taskbar.ProgressState = System.Windows.Shell.TaskbarItemProgressState.None;

        if (_jobInBackground)
        {
            // Done behind the user's back: the pill becomes the result (click it for the
            // details), and the taskbar button blinks if another window is in front.
            JobText.Text = Loc.I.F("job.done", Format.Bytes(freed));
            JobBar.Value = 1;
            JobGlyph.Text = "";
            JobGlyph.Foreground = (System.Windows.Media.Brush)FindResource("Success");
            Native.Flash(this);
        }
        return freed;
    }
}
