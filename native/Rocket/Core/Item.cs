using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace Rocket.Core;

public enum Risk { Safe, Review }

public enum Kind
{
    /// <summary>Empty each path, keep the folder.</summary>
    Contents,
    /// <summary>Delete each path itself (file or folder).</summary>
    Remove,
    /// <summary>Delete files older than <see cref="Item.MinAge"/>, keep the folder.</summary>
    OldFiles,
    RecycleBin,
    Hibernate,
    ComponentStore,
    OllamaModel,
}

public abstract class Bindable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected void Raise([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        Raise(name);
        return true;
    }
}

/// <summary>One thing that can be cleaned: a cache, a project's node_modules, a model.</summary>
public sealed class Item : Bindable
{
    public required string Id { get; init; }
    public required string Group { get; init; }
    public required Kind Kind { get; init; }
    public Risk Risk { get; init; }
    public bool Admin { get; init; }
    public List<string> Paths { get; init; } = [];
    public TimeSpan MinAge { get; init; }

    /// <summary>A Loc key for the title, or a literal name when <see cref="Name"/> is set.</summary>
    public string TitleKey { get; init; } = "";
    public string DetailKey { get; init; } = "";
    public string? Name { get; init; }
    public string? Note { get; init; }
    public object[] DetailArgs { get; init; } = [];
    public string Glyph { get; init; } = "";

    // projects / models
    public string? Project { get; init; }
    public string? ProjectPath { get; init; }
    private string? _badge;
    public string? Badge { get => _badge; set => Set(ref _badge, value); }
    public int IdleDays { get; init; } = -1;
    public string? Payload { get; init; }

    public string Title => Name is null ? Loc.I[TitleKey] : Format.Ltr(Name);
    public string Detail
    {
        get
        {
            var d = DetailKey.Length == 0 ? "" : Loc.I[DetailKey];
            if (DetailArgs.Length > 0) try { d = string.Format(d, DetailArgs); } catch { }
            return Note is null ? d : (d.Length == 0 ? Note : d + " · " + Note);
        }
    }
    public string PathText => Paths.Count == 0 ? "" : Paths.Count == 1 ? Paths[0] : $"{Paths[0]}  (+{Paths.Count - 1})";
    public string IdleText => IdleDays < 0 ? "" : IdleDays == 0 ? Loc.I["idle.today"] : string.Format(Loc.I["idle.days"], IdleDays);
    public bool IsReview => Risk == Risk.Review;
    public bool CanMove => ProjectPath != null;
    public bool Locked => Admin && !Native.IsAdmin;

    private long _bytes = -1;
    /// <summary>-1 while measuring, -2 when the size cannot be known up front.</summary>
    public long Bytes { get => _bytes; set { if (Set(ref _bytes, value)) { Raise(nameof(SizeText)); Raise(nameof(Measured)); } } }
    public bool Measured => _bytes != -1;
    public string SizeText => _bytes == -1 ? "…" : _bytes == -2 ? "?" : Format.Bytes(_bytes);

    public long Files { get; set; }

    private bool _checked;
    public bool IsChecked { get => _checked; set { if (Locked && value) value = false; if (Set(ref _checked, value)) Changed?.Invoke(); } }

    private string _state = "";
    /// <summary>"" idle, "cleaning", "done", "partial", "failed".</summary>
    public string State { get => _state; set => Set(ref _state, value); }

    private long _freed;
    public long Freed { get => _freed; set { if (Set(ref _freed, value)) Raise(nameof(FreedText)); } }
    public string FreedText => Format.Bytes(_freed);

    public event Action? Changed;

    public void Relocalize()
    {
        Raise(nameof(Title)); Raise(nameof(Detail)); Raise(nameof(IdleText));
    }
}

/// <summary>A titled card of items with a total and a select-all box.</summary>
public sealed class Group : Bindable
{
    public required string Key { get; init; }
    public required string Glyph { get; init; }
    public ObservableCollection<Item> Items { get; } = [];

    public string Title => Loc.I["g." + Key];
    public string Hint => Loc.I["g." + Key + ".hint"];

    public long Total => Items.Where(i => i.Bytes > 0).Sum(i => i.Bytes);
    public long Selected => Items.Where(i => i.IsChecked && i.Bytes > 0).Sum(i => i.Bytes);
    public string TotalText => Format.Bytes(Total);
    public bool Any => Items.Count > 0;

    public bool? AllChecked
    {
        get
        {
            var open = Items.Where(i => !i.Locked).ToList();
            if (open.Count == 0) return false;
            int n = open.Count(i => i.IsChecked);
            return n == 0 ? false : n == open.Count ? true : null;
        }
        set
        {
            bool on = value ?? false;
            foreach (var i in Items) if (!i.Locked) i.IsChecked = on;
        }
    }

    private bool _expanded = true;
    public bool Expanded { get => _expanded; set => Set(ref _expanded, value); }

    public void Refresh()
    {
        Raise(nameof(Total)); Raise(nameof(TotalText)); Raise(nameof(Selected));
        Raise(nameof(AllChecked)); Raise(nameof(Any));
    }

    public void Relocalize()
    {
        Raise(nameof(Title)); Raise(nameof(Hint));
        foreach (var i in Items) i.Relocalize();
    }
}

public static class Format
{
    public static string Bytes(long b)
    {
        if (b < 0) return "…";
        string[] u = Loc.I.IsFa ? ["بایت", "KB", "MB", "GB", "TB"] : ["B", "KB", "MB", "GB", "TB"];
        double v = b; int i = 0;
        while (v >= 1024 && i < u.Length - 1) { v /= 1024; i++; }
        var n = i == 0 ? v.ToString("0") : v >= 100 ? v.ToString("0") : v >= 10 ? v.ToString("0.0") : v.ToString("0.00");
        return $"{n} {u[i]}";
    }

    public static string Count(long n) => n.ToString("N0");

    /// <summary>
    /// A Latin name inside a Persian line: left-to-right marks on both ends keep its
    /// brackets and dots where they belong ("Devin (User)", ".pnpm-store").
    /// </summary>
    public static string Ltr(string s) => "\u200E" + s + "\u200E";
}
