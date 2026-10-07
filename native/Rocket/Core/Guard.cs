using System.IO;

namespace Rocket.Core;

/// <summary>
/// The last line of defence: whatever the catalog says, these folders are never deleted
/// themselves, and nothing above them is either. Their contents may be (Temp lives in
/// AppData\Local), but only when the caller keeps the folder.
/// </summary>
public static class Guard
{
    private static readonly HashSet<string> Never = Build();

    private static HashSet<string> Build()
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string? p)
        {
            if (string.IsNullOrWhiteSpace(p)) return;
            try { set.Add(Norm(Path.GetFullPath(p))); } catch { }
        }

        foreach (var f in new[]
        {
            Environment.SpecialFolder.Windows, Environment.SpecialFolder.System, Environment.SpecialFolder.SystemX86,
            Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86,
            Environment.SpecialFolder.CommonApplicationData, Environment.SpecialFolder.UserProfile,
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolder.Desktop, Environment.SpecialFolder.MyDocuments, Environment.SpecialFolder.MyPictures,
            Environment.SpecialFolder.MyVideos, Environment.SpecialFolder.MyMusic, Environment.SpecialFolder.Programs,
            Environment.SpecialFolder.StartMenu, Environment.SpecialFolder.CommonProgramFiles,
        })
            Add(Environment.GetFolderPath(f));

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        Add(Path.Combine(home, "Downloads"));
        Add(Path.Combine(home, "AppData"));
        Add(Path.GetDirectoryName(home)); // C:\Users
        Add(Environment.GetEnvironmentVariable("OneDrive"));
        Add(Environment.GetEnvironmentVariable("TEMP"));
        return set;
    }

    private static string Norm(string p) => p.TrimEnd('\\', '/');

    public static bool MayDelete(string fullPath, bool keepRoot)
    {
        var p = Norm(fullPath);
        if (p.Length <= 3) return false;                       // a drive root
        if (p.StartsWith(@"\\", StringComparison.Ordinal) && !p.StartsWith(@"\\?\", StringComparison.Ordinal))
            return false;                                      // network shares: not ours
        if (Never.Contains(p)) return keepRoot && Emptiable.Contains(p);
        // nothing that holds a protected folder
        foreach (var n in Never)
            if (n.StartsWith(p + "\\", StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }

    // Protected folders whose contents, and only contents, are ours to clear.
    private static readonly HashSet<string> Emptiable = new(StringComparer.OrdinalIgnoreCase)
    {
        Norm(Path.GetFullPath(Path.GetTempPath())),
        Norm(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temp")),
    };

    /// <summary>
    /// The space map lets you delete anything you point at, so it adds a fence of its own:
    /// nothing inside Windows or Program Files, and nothing the general rule refuses.
    /// </summary>
    public static bool MayDeleteFromMap(string fullPath)
    {
        var p = Norm(Path.GetFullPath(fullPath));
        if (!MayDelete(p, keepRoot: false)) return false;
        foreach (var f in new[] { Environment.SpecialFolder.Windows, Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 })
        {
            var root = Norm(Environment.GetFolderPath(f));
            if (root.Length > 0 && p.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)) return false;
        }
        var name = Path.GetFileName(p);
        return !name.Equals("pagefile.sys", StringComparison.OrdinalIgnoreCase)
            && !name.Equals("hiberfil.sys", StringComparison.OrdinalIgnoreCase)
            && !name.Equals("swapfile.sys", StringComparison.OrdinalIgnoreCase)
            && !name.Equals("System Volume Information", StringComparison.OrdinalIgnoreCase);
    }
}
