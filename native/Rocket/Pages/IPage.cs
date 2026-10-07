using System.Windows;
using System.Windows.Controls;
using Rocket.Core;

namespace Rocket.Pages;

/// <summary>
/// A page that does work only while it is on screen — live sampling, a first scan — so a
/// page nobody is looking at costs nothing on a machine that is already short of breath.
/// </summary>
public interface IPage
{
    void Shown();
    void Hidden();
}

/// <summary>Shared plumbing for the pages in this folder.</summary>
public abstract class PageBase : UserControl, IPage
{
    private bool _first = true;

    protected PageBase()
    {
        Margin = new Thickness(28, 20, 28, 0);
        Loc.I.LanguageChanged += () => { if (IsLoaded) Relocalize(); };
    }

    public void Shown()
    {
        if (_first) { _first = false; FirstShown(); }
        OnShown();
    }

    public virtual void Hidden() { }

    /// <summary>The first time the page is opened: start its scan.</summary>
    protected virtual void FirstShown() { }
    protected virtual void OnShown() { }
    protected virtual void Relocalize() { }

    protected static MainWindow Main => (MainWindow)Application.Current.MainWindow;
}
