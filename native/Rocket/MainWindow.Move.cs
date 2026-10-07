using System.IO;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;
using Rocket.Core;

namespace Rocket;

// Moving a folder or a project to another drive, through the same sheet and job pill as cleaning.
public partial class MainWindow
{
    /// <summary>Asks where to, shows the plan, then moves. Returns true when the folder moved.</summary>
    public async Task<bool> MoveFolder(string source)
    {
        if (_jobRunning) return false;
        var dlg = new OpenFolderDialog { Title = Loc.I["move.pick"] };
        if (Mover.Suggest(source) is { } s)
        {
            try { Directory.CreateDirectory(s); } catch { }
            if (Directory.Exists(s)) dlg.InitialDirectory = s;
        }
        if (dlg.ShowDialog(this) != true) return false;

        Toast(Loc.I["move.weighing"]);
        var plan = await Task.Run(() => Mover.Make(source, dlg.FolderName));
        if (plan.Problem is { } problem) { Toast(problem, false); return false; }

        var body = Loc.I.F("move.body", Format.Ltr(plan.Source), Format.Ltr(plan.Destination), Format.Bytes(plan.Bytes), Format.Count(plan.Files));
        var note = plan.IsProject && plan.LeftBehind > 0 ? Loc.I.F("move.rebuilt", Format.Bytes(plan.LeftBehind)) : "";
        var ok = await Confirm(Loc.I["move.title"], body, note, Loc.I["move.go"]);
        _sheetAnswer = null;
        if (!ok) { Sheet.Visibility = Visibility.Collapsed; return false; }

        var st = new DeleteStats();
        using var cts = new CancellationTokenSource();
        _cleanCts = cts;
        _jobInBackground = false;
        HideJobPill();
        SetJobRunning(true);
        SheetTitle.Text = Loc.I["move.running"];
        SheetBody.Text = "";
        SheetNote.Visibility = Visibility.Collapsed;
        SheetProgress.Visibility = Visibility.Visible;
        SheetGo.Visibility = Visibility.Collapsed;
        SheetHide.Visibility = Visibility.Visible;
        SheetCancel.Content = Loc.I["progress.stop"];
        SheetCancel.IsEnabled = true;
        SheetFreed.Text = Format.Bytes(0);
        SheetBar.IsIndeterminate = false;
        SheetBar.Value = 0;
        SheetCurrent.Text = plan.Destination;
        Taskbar.ProgressState = System.Windows.Shell.TaskbarItemProgressState.Normal;

        var tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
        tick.Tick += (_, _) =>
        {
            var b = Interlocked.Read(ref st.Bytes);
            double share = plan.Bytes > 0 ? Math.Min(1, (double)b / plan.Bytes) : 0;
            SheetFreed.Text = Format.Bytes(b);
            SheetBar.Value = share;
            JobText.Text = Loc.I.F("move.pill", Format.Bytes(b));
            JobBar.Value = share;
            Taskbar.ProgressValue = share;
        };
        tick.Start();

        string? error;
        try { error = await Mover.Run(plan, st, cts.Token); }
        catch (OperationCanceledException) { error = Loc.I["move.cancelled"]; }
        catch (Exception ex) { error = ex.Message; }
        tick.Stop();
        _cleanCts = null;
        SetJobRunning(false);
        RefreshDrives();

        if (error is null)
            History.Add(new Run(DateTime.UtcNow, plan.SameDrive ? 0 : plan.Bytes + plan.LeftBehind, 1, 0,
                [Loc.I.F("move.log", Path.GetFileName(plan.Source), Path.GetPathRoot(plan.Destination)!.TrimEnd('\\'))]));

        SheetTitle.Text = error is null ? Loc.I["move.done"] : Loc.I["move.failed"];
        SheetFreed.Text = Format.Bytes(Interlocked.Read(ref st.Bytes));
        SheetBar.Value = error is null ? 1 : SheetBar.Value;
        SheetBody.Text = error ?? Loc.I.F("move.now", Format.Ltr(plan.Destination));
        SheetCurrent.Text = Loc.I.F("progress.drives", FreeSummary());
        SheetHide.Visibility = Visibility.Collapsed;
        SheetCancel.Content = Loc.I["common.close"];
        Taskbar.ProgressState = System.Windows.Shell.TaskbarItemProgressState.None;
        if (_jobInBackground)
        {
            JobText.Text = error is null ? Loc.I["move.done"] : Loc.I["move.failed"];
            JobBar.Value = 1;
            JobGlyph.Text = error is null ? "" : "";
            JobGlyph.Foreground = (System.Windows.Media.Brush)FindResource(error is null ? "Success" : "Warn");
            Native.Flash(this);
        }
        return error is null;
    }
}
