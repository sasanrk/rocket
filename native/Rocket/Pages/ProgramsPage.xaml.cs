using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using Rocket.Core;

namespace Rocket.Pages;

public partial class ProgramsPage : PageBase
{
    private static readonly string[] FilterIds = ["all", "desktop", "store", "large", "recent", "broken"];
    private readonly ObservableCollection<Program> _items = [];
    private readonly ListCollectionView _view;
    private string _filter = "all";
    private CancellationTokenSource? _cts;

    public ProgramsPage()
    {
        InitializeComponent();
        _view = new ListCollectionView(_items) { Filter = Keep };
        List.ItemsSource = _view;
        BuildChrome();
    }

    protected override void FirstShown() => _ = Load();

    protected override void Relocalize() { BuildChrome(); Summarize(); }

    private void BuildChrome()
    {
        int sort = SortBox.SelectedIndex;
        SortBox.ItemsSource = new[] { Loc.I["prog.sort.size"], Loc.I["prog.sort.name"], Loc.I["prog.sort.date"], Loc.I["prog.sort.publisher"] };
        SortBox.SelectedIndex = Math.Max(0, sort);
        Filters.Children.Clear();
        foreach (var f in FilterIds)
        {
            var rb = new RadioButton
            {
                Style = (Style)FindResource("Pill"), GroupName = "progfilter", Tag = f, IsChecked = f == _filter,
                Content = new TextBlock { Text = Loc.I["prog.f." + f], FontSize = 12 },
            };
            rb.Checked += (s, _) => { _filter = (string)((RadioButton)s).Tag; _view.Refresh(); };
            Filters.Children.Add(rb);
        }
    }

    private async Task Load()
    {
        _cts?.Cancel();
        var cts = _cts = new CancellationTokenSource();
        _items.Clear();
        Total.Text = "…";
        foreach (var p in await Task.Run(Programs.Desktop)) _items.Add(p);
        Summarize();
        // Store apps take a few seconds through PowerShell; they join when ready.
        var store = Programs.StoreApps();
        // Programs that did not report a size are measured from their folder, a few at a time.
        await Task.Run(() => Parallel.ForEach(_items.ToList(), new ParallelOptions { MaxDegreeOfParallelism = 3, CancellationToken = cts.Token },
            p => Programs.Measure(p, cts.Token)));
        foreach (var s in await store)
        {
            if (cts.IsCancellationRequested) return;
            _items.Add(s);
            await Task.Run(() => Programs.Measure(s, cts.Token));
        }
        _view.Refresh();
        Summarize();
    }

    private void Summarize()
    {
        long total = _items.Where(p => p.State != "removed").Sum(p => Math.Max(0, p.Bytes));
        Total.Text = Format.Bytes(total);
        Summary.Text = Loc.I.F("prog.summary", _items.Count(p => p.State != "removed"), _items.Count(p => p.Store));
    }

    private bool Keep(object o)
    {
        if (o is not Program p) return false;
        bool f = _filter switch
        {
            "desktop" => !p.Store,
            "store" => p.Store,
            "large" => p.Bytes >= 500L << 20,
            "recent" => p.Installed is { } d && d > DateTime.Now.AddDays(-30),
            "broken" => !p.HasUninstaller,
            _ => true,
        };
        var q = Search.Text.Trim();
        return f && (q.Length == 0 || p.Name.Contains(q, StringComparison.OrdinalIgnoreCase) || p.Publisher.Contains(q, StringComparison.OrdinalIgnoreCase));
    }

    private void Sort_Changed(object s, SelectionChangedEventArgs e)
    {
        _view.SortDescriptions.Clear();
        _view.SortDescriptions.Add(SortBox.SelectedIndex switch
        {
            1 => new SortDescription(nameof(Program.Name), ListSortDirection.Ascending),
            2 => new SortDescription(nameof(Program.Installed), ListSortDirection.Descending),
            3 => new SortDescription(nameof(Program.Publisher), ListSortDirection.Ascending),
            _ => new SortDescription(nameof(Program.Bytes), ListSortDirection.Descending),
        });
    }

    private void Search_Changed(object s, TextChangedEventArgs e) => _view.Refresh();

    private void Refresh_Click(object s, RoutedEventArgs e) => _ = Load();

    private void Reveal_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is Program { InstallLocation: { Length: > 0 } loc }) Native.Reveal(loc);
    }

    private async void Uninstall_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is not Program p || p.State is "removing" or "removed") return;
        bool force = !p.HasUninstaller;
        var body = force ? Loc.I.F("prog.force.q", p.Name) : Loc.I.F("prog.uninstall.q", p.Name) + (p.Dependency ? "\n\n" + Loc.I["prog.dep.warn"] : "");
        if (!await Main.Ask(Loc.I[force ? "prog.force" : "prog.uninstall"], body, Loc.I[force ? "prog.force" : "prog.uninstall"])) return;

        // Leftovers are found while the program's install folder is still known.
        var before = force ? await Task.Run(() => Programs.Leftovers(p)) : null;
        p.State = "removing";
        var outcome = force ? await Programs.ForceRemove(p) : await Programs.Uninstall(p, Quiet.IsChecked == true);
        if (!outcome.Removed && outcome.CanForce && !force)
        {
            p.State = "";
            if (await Main.Ask(Loc.I["prog.force"], outcome.Message + "\n\n" + Loc.I.F("prog.force.q", p.Name), Loc.I["prog.force"]))
            {
                before = await Task.Run(() => Programs.Leftovers(p));
                p.State = "removing";
                outcome = await Programs.ForceRemove(p);
            }
            else return;
        }
        if (!outcome.Removed)
        {
            p.State = "";
            Main.Toast(outcome.Message.Length > 0 ? outcome.Message : Loc.I["prog.notremoved"], false);
            return;
        }
        p.State = "removed";
        History.Add(new Run(DateTime.UtcNow, 0, 1, 0, [Loc.I.F("prog.log", p.Name)]));
        Summarize();

        // What it left behind goes through the same sheet as every other clean-up.
        var leftovers = before ?? await Task.Run(() => Programs.Leftovers(p));
        if (leftovers.Count == 0) { Main.Toast(Loc.I.F("prog.done", p.Name)); return; }
        Main.Toast(Loc.I.F("prog.done.lo", p.Name, Format.Bytes(leftovers.Sum(i => i.Bytes))));
        await Main.Clean(leftovers);
    }
}
