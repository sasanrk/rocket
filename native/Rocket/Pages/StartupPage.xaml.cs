using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using Rocket.Core;

namespace Rocket.Pages;

public partial class StartupPage : PageBase
{
    private readonly ObservableCollection<StartupEntry> _items = [];

    public StartupPage()
    {
        InitializeComponent();
        List.ItemsSource = _items;
    }

    protected override void FirstShown() => _ = Load();

    protected override void Relocalize() => Summarize();

    private async Task Load()
    {
        var list = await Task.Run(() =>
        {
            var entries = Startup.List();
            // What each one costs right now, if it is running.
            var running = Process.GetProcesses();
            foreach (var e in entries)
            {
                if (e.Exe is null) continue;
                var name = Path.GetFileNameWithoutExtension(e.Exe);
                long mem = 0; int n = 0;
                foreach (var p in running)
                    try { if (p.ProcessName.Equals(name, StringComparison.OrdinalIgnoreCase)) { mem += p.PrivateMemorySize64; n++; } } catch { }
                if (n > 0) e.Usage = Loc.I.F("startup.running", Format.Bytes(mem));
            }
            foreach (var p in running) p.Dispose();
            return entries;
        });
        _items.Clear();
        foreach (var e in list) _items.Add(e);
        Summarize();
    }

    private void Summarize()
    {
        int on = _items.Count(i => i.Enabled);
        Count.Text = Loc.I.F("startup.count", on, _items.Count);
        Summary.Text = Loc.I["startup.hint"];
        BtnElevate.Visibility = !Native.IsAdmin && _items.Any(i => i.Machine) ? Visibility.Visible : Visibility.Collapsed;
        foreach (var i in _items) i.Relocalize();
    }

    private async void Toggle_Click(object s, RoutedEventArgs e)
    {
        if (s is not CheckBox { DataContext: StartupEntry entry } cb) return;
        bool want = cb.IsChecked == true;
        cb.IsEnabled = false;
        var ok = await Startup.Set(entry, want);
        cb.IsEnabled = true;
        cb.IsChecked = entry.Enabled; // back to the truth when the change was refused
        if (ok) History.Add(new Run(DateTime.UtcNow, 0, 1, 0, [Loc.I.F(want ? "startup.log.on" : "startup.log.off", entry.Name)]));
        Summarize();
    }

    private void Reveal_Click(object s, RoutedEventArgs e)
    {
        if ((s as FrameworkElement)?.DataContext is StartupEntry { Exe: { } exe }) Native.Reveal(exe);
    }

    private void Refresh_Click(object s, RoutedEventArgs e) => _ = Load();

    private void Elevate_Click(object s, RoutedEventArgs e)
    {
        if (Native.RestartElevated("--page startup")) Application.Current.Shutdown();
    }
}
