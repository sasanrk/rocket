using System.IO;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;
using Rocket.Core;

namespace Rocket;

public partial class App : Application
{
    public static void Ui(Action a)
    {
        var d = Current?.Dispatcher;
        if (d is null) return;
        if (d.CheckAccess()) a();
        else d.BeginInvoke(a);
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Length == 2 && e.Args[0] == "--report")
        {
            Loc.I.Set("en");
            try { Report.Write(e.Args[1]); } catch (Exception ex) { File.WriteAllText(e.Args[1], ex.ToString()); }
            Shutdown();
            return;
        }
        if (e.Args.Length == 4 && e.Args[0] == "--movetest")
        {
            try { SelfTest.MoveTest(e.Args[1], e.Args[2], e.Args[3]); } catch (Exception ex) { File.WriteAllText(e.Args[3], ex.ToString()); }
            Shutdown();
            return;
        }
        if (e.Args.Length >= 3 && e.Args[0] == "--bench")
        {
            try { SelfTest.Bench(e.Args[1], e.Args[2], e.Args.Length > 3 ? int.Parse(e.Args[3]) : 0); } catch (Exception ex) { File.WriteAllText(e.Args[2], ex.ToString()); }
            Shutdown();
            return;
        }
        if (e.Args.Length == 3 && e.Args[0] == "--selftest")
        {
            try { SelfTest.Run(e.Args[1], e.Args[2]); } catch (Exception ex) { File.WriteAllText(e.Args[2], ex.ToString()); }
            Shutdown();
            return;
        }
        if (e.Args.Length > 0 && e.Args[0].StartsWith("--") && e.Args[0] is not "--page" and not "--shot") { Shutdown(); return; }
        DispatcherUnhandledException += OnCrash;
        Loc.I.Set(Settings.Current.Lang);
        ApplyTheme(Settings.Current.Theme);
        SystemEvents.UserPreferenceChanged += (_, ev) =>
        {
            if (ev.Category == UserPreferenceCategory.General && Settings.Current.Theme == "")
                Ui(() => ApplyTheme(""));
        };
        if (e.Args.Length >= 3 && e.Args[0] == "--shot") { Shot(e.Args); return; }
        var w = new MainWindow();
        w.Show();
        // "Restart as administrator" comes back to the page it was asked from.
        int i = Array.IndexOf(e.Args, "--page");
        if (i >= 0 && i + 1 < e.Args.Length) w.ShowPage(e.Args[i + 1]);
    }

    // --shot out.png page seconds [fa|en] [light|dark]: renders the window off-screen after the
    // scans have had `seconds` to run, then quits. Scans only; nothing is deleted.
    private async void Shot(string[] a)
    {
        if (a.Length > 4) Loc.I.Set(a[4]);
        if (a.Length > 5) ApplyTheme(a[5]);
        var w = new MainWindow { WindowStartupLocation = WindowStartupLocation.Manual, Left = -20000, Top = 0, ShowActivated = false, ShowInTaskbar = false };
        w.AutoScan = a[2].Split(',').Any(p => p is "clean" or "projects" or "models" or "overview" || p.StartsWith("job:"));
        w.Show();
        // a map page starts its walk now, so it has the same time to finish
        // open every page once so each starts its own loading, then give them the time
        foreach (var page in a[2].Split(',').Where(p => !p.StartsWith("job:") && p != "wait")) w.ShowPage(page);
        await Task.Delay(TimeSpan.FromSeconds(double.Parse(a.Length > 3 ? a[3] : "5")));
        foreach (var page in a[2].Split(','))
        {
            if (page.StartsWith("job:")) { await w.TestBackgroundJob(page[4..]); w.ShowPage("projects"); }
            else if (page == "wait") { await Task.Delay(30000); continue; }
            else w.ShowPage(page);
            await Task.Delay(900);
            var bmp = new System.Windows.Media.Imaging.RenderTargetBitmap((int)w.ActualWidth, (int)w.ActualHeight, 96, 96, System.Windows.Media.PixelFormats.Pbgra32);
            bmp.Render(w);
            var enc = new System.Windows.Media.Imaging.PngBitmapEncoder();
            enc.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp));
            using var f = File.Create(a[1].Replace(".png", "-" + (page.StartsWith("job:") ? "job" : page.Replace(":", "")) + ".png"));
            enc.Save(f);
        }
        w.ForceClose = true;
        Shutdown();
    }

    private static void OnCrash(object s, DispatcherUnhandledExceptionEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(Settings.Folder);
            File.AppendAllText(Path.Combine(Settings.Folder, "errors.log"), $"{DateTime.Now:s} {e.Exception}\n\n");
        }
        catch { }
        MessageBox.Show(e.Exception.Message, "Rocket", MessageBoxButton.OK, MessageBoxImage.Warning);
        e.Handled = true;
    }

    public static bool IsDark { get; private set; } = true;

    public static void ApplyTheme(string mode)
    {
        IsDark = mode switch { "dark" => true, "light" => false, _ => SystemUsesDark() };
        Current.Resources.MergedDictionaries[0] = new ResourceDictionary
        {
            Source = new Uri($"Ui/Palette.{(IsDark ? "Dark" : "Light")}.xaml", UriKind.Relative),
        };
    }

    private static bool SystemUsesDark()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return (int?)k?.GetValue("AppsUseLightTheme") == 0;
        }
        catch { return true; }
    }
}
