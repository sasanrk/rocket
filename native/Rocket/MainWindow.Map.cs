using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Rocket.Core;

namespace Rocket;

// Space map: one parallel walk of a drive, then browse it folder by folder.
public partial class MainWindow
{
    private SpaceMap? _map;
    private Node? _mapNode;
    private CancellationTokenSource? _mapCts;

    private async void MapDrive_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is DriveVm d) await MapDrive(d);
    }

    public async Task MapDrive(DriveVm d)
    {
        _mapCts?.Cancel();
        var cts = _mapCts = new CancellationTokenSource();
        var map = new SpaceMap(d.Root);
        _map = map;
        _mapNode = null;
        MapList.ItemsSource = null;
        MapPath.Text = d.Root;
        MapSize.Text = "";
        BtnMapUp.IsEnabled = false;
        var sw = Stopwatch.StartNew();

        long used = 0;
        try { var di = new DriveInfo(d.Root); used = di.TotalSize - di.TotalFreeSpace; } catch { }
        int beat = 0;
        var tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
        tick.Tick += (_, _) =>
        {
            var b = Interlocked.Read(ref map.ScannedBytes);
            MapBar.Value = used > 0 ? Math.Min(1, (double)b / used) : 0;
            MapStatus.Text = Loc.I.F("map.walking", Format.Count(Interlocked.Read(ref map.ScannedFiles)), Format.Bytes(b));
            // live: refresh the folder on screen about once a second while the walk fills it
            if (++beat % 5 == 0) ShowNode(_mapNode ?? map.Root, live: true);
        };
        tick.Start();
        try { await Task.Run(() => map.Run(cts.Token), cts.Token); }
        catch (OperationCanceledException) { tick.Stop(); return; }
        tick.Stop();
        if (_map != map) return;

        MapBar.Value = 1;
        var hidden = map.Used - map.Root.Bytes;
        MapStatus.Text = Loc.I.F("map.done", Format.Count(map.ScannedFiles), $"{sw.Elapsed.TotalSeconds:0.0}s")
                         + (hidden > 1L << 30 ? "   ·   " + Loc.I.F("map.hidden", Format.Bytes(hidden)) : "");
        ShowNode(_mapNode ?? map.Root);
    }

    private void ShowNode(Node n, bool live = false)
    {
        _mapNode = n;
        MapPath.Text = n.FullPath;
        MapSize.Text = Format.Bytes(n.Bytes);
        BtnMapUp.IsEnabled = n.Parent != null;

        double total = Math.Max(1, n.Bytes);
        var rows = SpaceMap.Snapshot(n).Take(400).Select(c => new MapRow
        {
            Name = c.Name, Path = c.FullPath, Node = c, Bytes = c.Bytes, Files = c.Files, Share = c.Bytes / total,
        }).ToList();
        // The folder's own files are not in the tree; list them now.
        if (!live) rows.AddRange(Fs.Files(n.FullPath).OrderByDescending(f => f.Length).Take(200).Select(f => new MapRow
        {
            Name = Path.GetFileName(f.Path), Path = f.Path, Bytes = Fs.OnDisk(f.Length), Share = Fs.OnDisk(f.Length) / total, Written = f.Written,
        }));
        MapList.ItemsSource = rows.Where(r => r.Bytes > 0 || r.IsDir).OrderByDescending(r => r.Bytes).ToList();
    }

    private void MapUp_Click(object s, RoutedEventArgs e)
    {
        if (_mapNode?.Parent is { } p) ShowNode(p);
    }

    private void MapList_DoubleClick(object s, MouseButtonEventArgs e)
    {
        if ((e.OriginalSource as FrameworkElement)?.DataContext is MapRow { Node: { } n }) ShowNode(n);
    }

    private void MapReveal_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is MapRow r) Native.Reveal(r.Path);
    }

    private async void MapDelete_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is not MapRow r || _mapNode is null) return;
        if (!Guard.MayDeleteFromMap(r.Path))
        {
            await Confirm(Loc.I["confirm.title"], Loc.I["map.protected"], "", Loc.I["common.close"]);
            _sheetAnswer = null;
            Sheet.Visibility = Visibility.Collapsed;
            return;
        }
        var item = new Item
        {
            Id = "map." + r.Path, Group = "map", Kind = Kind.Remove, Risk = Risk.Review, Paths = [r.Path], Name = r.Name,
            Bytes = r.Bytes, IsChecked = true,
        };
        item.IsChecked = true;
        var ok = await Confirm(Loc.I["confirm.title"], Loc.I.F("confirm.map", r.Name, Format.Bytes(r.Bytes)), "", Loc.I["confirm.go"]);
        _sheetAnswer = null;
        if (!ok) { Sheet.Visibility = Visibility.Collapsed; return; }

        // RunClean asks again; skip that by answering for it.
        var freedTask = RunCleanConfirmed(item);
        var freed = await freedTask;
        if (r.Node != null) SpaceMap.Detach(r.Node, freed);
        else for (var p = _mapNode; p != null; p = p.Parent) p.Bytes -= freed;
        ShowNode(_mapNode);
    }

    private async void MapMove_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is not MapRow { Node: { } n } r || _mapNode is null) return;
        if (!Guard.MayDeleteFromMap(r.Path)) { Toast(Loc.I["map.protected"], false); return; }
        var current = _mapNode;
        if (await MoveFolder(r.Path))
        {
            SpaceMap.Detach(n, r.Bytes);
            ShowNode(current);
        }
    }

    private async Task<long> RunCleanConfirmed(Item item)
    {
        var t = RunClean([item]);
        // RunClean opened its own confirmation; accept it straight away.
        _sheetAnswer?.TrySetResult(true);
        return await t;
    }
}
