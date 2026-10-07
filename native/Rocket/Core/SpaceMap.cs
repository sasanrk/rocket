using System.IO;
using System.IO.Enumeration;

namespace Rocket.Core;

/// <summary>A folder in the space map: its own size plus everything under it.</summary>
public sealed class Node
{
    public required string Name { get; init; }
    public Node? Parent { get; init; }
    public long Bytes;
    public long Files;
    public long Newest;
    public List<Node> Children { get; } = [];
    public bool Denied;

    public string FullPath => Parent is null ? Name : Path.Combine(Parent.FullPath, Name);
}

/// <summary>
/// The whole drive, measured folder by folder in one parallel pass. Only folders are kept
/// (a drive has a few hundred thousand of them, against millions of files); the files in
/// a folder are listed again when you open it, which takes a moment, not a rescan.
/// </summary>
public sealed class SpaceMap
{
    private static readonly EnumerationOptions Flat = new()
    {
        RecurseSubdirectories = false, IgnoreInaccessible = false, AttributesToSkip = 0, BufferSize = 64 * 1024,
    };

    public Node Root { get; }
    public long ScannedFiles;
    public long ScannedBytes;
    public string Drive { get; }
    public long Used { get; private set; }

    public SpaceMap(string drive)
    {
        Drive = drive;
        Root = new Node { Name = drive };
    }

    public void Run(CancellationToken ct)
    {
        var di = new DriveInfo(Drive);
        Used = di.TotalSize - di.TotalFreeSpace;
        Walk(Root, Drive, 0, ct);
    }

    private void Walk(Node node, string path, int depth, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var subs = new List<(Node Node, string Path)>();
        long local = 0, files = 0;
        try
        {
            var e = new FileSystemEnumerable<(string Name, bool Dir, bool Link, long Len, long Ticks)>(path,
                (ref FileSystemEntry en) => (en.FileName.ToString(), en.IsDirectory, (en.Attributes & FileAttributes.ReparsePoint) != 0,
                    en.Length, en.LastWriteTimeUtc.UtcTicks), Flat);
            foreach (var x in e)
            {
                if (x.Dir)
                {
                    if (x.Link) continue;
                    var child = new Node { Name = x.Name, Parent = node };
                    lock (node.Children) node.Children.Add(child);
                    subs.Add((child, Path.Combine(path, x.Name)));
                    continue;
                }
                local += Fs.OnDisk(x.Len);
                files++;
                if (x.Ticks > node.Newest) node.Newest = x.Ticks;
            }
        }
        catch (OperationCanceledException) { throw; }
        catch { node.Denied = true; }

        // Sizes flow up as each folder is read, so the map can be shown while it fills.
        if (files > 0)
        {
            for (var n = node; n != null; n = n.Parent)
            {
                Interlocked.Add(ref n.Bytes, local);
                Interlocked.Add(ref n.Files, files);
            }
            Interlocked.Add(ref ScannedFiles, files);
            Interlocked.Add(ref ScannedBytes, local);
        }

        if (depth < 3 && subs.Count > 1)
            Parallel.ForEach(subs, new ParallelOptions { MaxDegreeOfParallelism = Fs.Workers, CancellationToken = ct },
                s => Walk(s.Node, s.Path, depth + 1, ct));
        else
            foreach (var s in subs) Walk(s.Node, s.Path, depth + 1, ct);

        foreach (var (c, _) in subs)
            if (c.Newest > node.Newest) node.Newest = c.Newest;
        lock (node.Children) node.Children.Sort((a, b) => b.Bytes.CompareTo(a.Bytes));
    }

    /// <summary>Drops a deleted folder from the tree and takes its bytes off every parent.</summary>
    /// <summary>The children, biggest first, safe to call while the walk is still adding.</summary>
    public static List<Node> Snapshot(Node n)
    {
        List<Node> list;
        lock (n.Children) list = [.. n.Children];
        list.Sort((a, b) => Interlocked.Read(ref b.Bytes).CompareTo(Interlocked.Read(ref a.Bytes)));
        return list;
    }

    public static void Detach(Node n, long freed)
    {
        if (n.Parent != null) lock (n.Parent.Children) n.Parent.Children.Remove(n);
        for (var p = n.Parent; p != null; p = p.Parent) { p.Bytes -= freed; p.Files -= n.Files; }
    }
}

/// <summary>A row on the space map page: a folder from the tree, or a file listed live.</summary>
public sealed class MapRow : Bindable
{
    public required string Name { get; init; }
    public required string Path { get; init; }
    public Node? Node { get; init; }
    public long Bytes { get; set; }
    public long Files { get; init; }
    public double Share { get; init; }
    /// <summary>Embedded left-to-right, so ".pnpm-store" keeps its dot in a Persian page.</summary>
    public string Display => Format.Ltr(Name);
    public bool IsDir => Node != null;
    public string Glyph => IsDir ? "" : "";
    public string SizeText => Format.Bytes(Bytes);
    public string ShareText => Share >= 0.001 ? (Share * 100).ToString("0.#") + "%" : "";
    public string FilesText => IsDir ? string.Format(Loc.I["map.files"], Format.Count(Files)) : "";
    public double BarWidth => Math.Max(2, Share * 160);
    public DateTime Written { get; init; }
}
