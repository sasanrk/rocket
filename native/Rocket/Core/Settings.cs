using System.IO;
using System.Text.Json;

namespace Rocket.Core;

public sealed class Settings
{
    public static string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rocket");
    private static string File => Path.Combine(Folder, "settings.json");

    public string Lang { get; set; } = "en";
    public string Theme { get; set; } = "";
    public int IdleDays { get; set; } = 14;
    public List<string> ExtraRoots { get; set; } = [];

    public static Settings Current { get; } = Load();

    private static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(System.IO.File.ReadAllText(File)) ?? new(); }
        catch { return new(); }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Folder);
            System.IO.File.WriteAllText(File, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}

/// <summary>One cleaning run, as remembered on the History page.</summary>
public sealed record Run(DateTime When, long Freed, int Items, long Failed, List<string> Titles)
{
    public string WhenText => When.ToLocalTime().ToString("yyyy-MM-dd  HH:mm");
    public string FreedText => Freed > 0 ? Format.Bytes(Freed) : "—";
    public string Summary => string.Join(" · ", Titles.Take(6)) + (Titles.Count > 6 ? $"  +{Titles.Count - 6}" : "");
}

public static class History
{
    private static string File => Path.Combine(Settings.Folder, "history.jsonl");

    public static void Add(Run r)
    {
        try
        {
            Directory.CreateDirectory(Settings.Folder);
            System.IO.File.AppendAllText(File, JsonSerializer.Serialize(r) + "\n");
        }
        catch { }
    }

    public static List<Run> Read()
    {
        var list = new List<Run>();
        try
        {
            if (!System.IO.File.Exists(File)) return list;
            foreach (var l in System.IO.File.ReadLines(File))
                try { if (JsonSerializer.Deserialize<Run>(l) is { } r) list.Add(r); } catch { }
        }
        catch { }
        list.Reverse();
        return list;
    }
}
