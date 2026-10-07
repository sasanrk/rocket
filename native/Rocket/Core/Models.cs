using System.IO;
using System.Text.Json;

namespace Rocket.Core;

/// <summary>
/// Downloaded AI models, one row each: the Hugging Face hub cache, Ollama, LM Studio,
/// GPT4All, torch and whisper caches. Never selected by default — a model is a choice,
/// and downloading it again is slow.
/// </summary>
public static class Models
{
    private static readonly string H = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static readonly string L = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

    public static List<Item> Find()
    {
        var list = new List<Item>();
        HuggingFace(list);
        Ollama(list);
        Folders(list, "LM Studio", [Path.Combine(H, @".lmstudio\models"), Path.Combine(H, @".cache\lm-studio\models")], depth: 2);
        Folders(list, "GPT4All", [Path.Combine(L, @"nomic.ai\GPT4All")], depth: 0, filesOnly: true);
        Folders(list, "Jan", [Path.Combine(H, @"jan\models"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Jan\data\models")], depth: 1);
        Single(list, "torch", "PyTorch hub", Path.Combine(H, @".cache\torch"));
        Single(list, "whisper", "Whisper", Path.Combine(H, @".cache\whisper"));
        Single(list, "hfdata", "Hugging Face datasets", Path.Combine(H, @".cache\huggingface\datasets"));
        return list;
    }

    private static Item Make(string id, string source, string name, IEnumerable<string> paths, Kind kind = Kind.Remove, string? payload = null) => new()
    {
        Id = id, Group = "models", Kind = kind, Risk = Risk.Review, Paths = paths.ToList(), Name = name, Badge = source,
        Payload = payload, Glyph = "",
    };

    private static void HuggingFace(List<Item> list)
    {
        var hub = Environment.GetEnvironmentVariable("HF_HUB_CACHE")
                  ?? (Environment.GetEnvironmentVariable("HF_HOME") is { } home ? Path.Combine(home, "hub") : null)
                  ?? Path.Combine(H, @".cache\huggingface\hub");
        foreach (var d in Fs.Dirs(hub))
        {
            var n = Path.GetFileName(d);
            string? kind = n.StartsWith("models--") ? "model" : n.StartsWith("datasets--") ? "dataset" : n.StartsWith("spaces--") ? "space" : null;
            if (kind is null) continue;
            var name = n[(n.IndexOf("--", StringComparison.Ordinal) + 2)..].Replace("--", "/");
            list.Add(Make("hf." + n, "Hugging Face", name, [d]));
        }
    }

    /// <summary>
    /// Ollama stores a model as a manifest plus content-addressed blobs that models share.
    /// Removing one deletes its manifest and only the blobs no other manifest points at.
    /// </summary>
    private static void Ollama(List<Item> list)
    {
        var root = Environment.GetEnvironmentVariable("OLLAMA_MODELS") ?? Path.Combine(H, @".ollama\models");
        var manifests = Path.Combine(root, "manifests");
        if (!Directory.Exists(manifests)) return;

        var all = new List<(string File, string Name, List<(string Digest, long Size)> Layers)>();
        foreach (var f in Directory.EnumerateFiles(manifests, "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true }))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(f));
                var layers = new List<(string, long)>();
                if (doc.RootElement.TryGetProperty("config", out var c)) layers.Add((c.GetProperty("digest").GetString()!, c.GetProperty("size").GetInt64()));
                foreach (var l in doc.RootElement.GetProperty("layers").EnumerateArray())
                    layers.Add((l.GetProperty("digest").GetString()!, l.GetProperty("size").GetInt64()));
                var rel = Path.GetRelativePath(manifests, f).Split('\\');
                // registry.ollama.ai\library\llama3\8b → llama3:8b
                var name = rel.Length >= 3 ? $"{(rel[^3] == "library" ? "" : rel[^3] + "/")}{rel[^2]}:{rel[^1]}" : string.Join('/', rel);
                all.Add((f, name, layers));
            }
            catch { }
        }
        foreach (var m in all)
        {
            var shared = all.Where(o => o.File != m.File).SelectMany(o => o.Layers.Select(x => x.Digest)).ToHashSet();
            var own = m.Layers.Where(l => !shared.Contains(l.Digest)).ToList();
            var blobs = own.Select(l => Path.Combine(root, "blobs", l.Digest.Replace(':', '-'))).Where(File.Exists).ToList();
            var item = Make("ollama." + m.Name, "Ollama", m.Name, [m.File, .. blobs]);
            list.Add(item);
        }
    }

    private static void Folders(List<Item> list, string source, string[] roots, int depth, bool filesOnly = false)
    {
        foreach (var root in roots.Where(Directory.Exists))
        {
            if (filesOnly)
            {
                foreach (var f in Fs.Files(root).Where(f => f.Length > 50L << 20))
                    list.Add(Make(source + "." + f.Path, source, Path.GetFileName(f.Path), [f.Path]));
                continue;
            }
            IEnumerable<string> level = [root];
            for (int i = 0; i < depth; i++) level = level.SelectMany(Fs.Dirs).ToList();
            foreach (var d in level)
                list.Add(Make(source + "." + d, source, Path.GetRelativePath(root, d).Replace('\\', '/'), [d]));
        }
    }

    private static void Single(List<Item> list, string id, string name, string path)
    {
        if (Directory.Exists(path)) list.Add(Make(id, name, name, [path]));
    }

    /// <summary>A model file found loose on a drive during the project walk.</summary>
    public static Item Loose(string path) => Make("file." + path, Loc.I["models.file"], Path.GetFileName(path), [path]);
}
