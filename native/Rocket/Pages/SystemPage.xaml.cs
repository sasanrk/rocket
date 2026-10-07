using System.Windows;
using Rocket.Core;

namespace Rocket.Pages;

public partial class SystemPage : PageBase
{
    private Specs.Report? _report;

    public SystemPage() => InitializeComponent();

    protected override void FirstShown() => _ = Load();

    protected override void Relocalize() => _ = Load();

    private async Task Load()
    {
        Loading.Visibility = Visibility.Visible;
        Bar.Visibility = Visibility.Visible;
        _report = await Specs.Read();
        Loading.Visibility = Visibility.Collapsed;
        Bar.Visibility = Visibility.Collapsed;
        if (_report is null)
        {
            Loading.Text = Loc.I["pc.failed"];
            Loading.Visibility = Visibility.Visible;
            return;
        }
        Cards.ItemsSource = _report.Cards;
        AdviceList.ItemsSource = _report.Advice;
        int n = _report.Advice.Count(a => a.IsUpgrade);
        Banner.Text = n > 0 ? Loc.I.F("pc.banner", n) : Loc.I["pc.banner.none"];
        Banner.Visibility = Visibility.Visible;
    }

    private void Copy_Click(object s, RoutedEventArgs e)
    {
        if (_report is null) return;
        try { Clipboard.SetText(_report.Text); Main.Toast(Loc.I["pc.copied"]); } catch { }
    }

    private void Refresh_Click(object s, RoutedEventArgs e) => _ = Load();
}
