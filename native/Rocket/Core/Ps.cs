using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace Rocket.Core;

/// <summary>
/// The few things only PowerShell reaches comfortably — CIM classes, Defender, the Store,
/// physical disks — asked once, answered as JSON. No WMI package to ship.
/// </summary>
public static class Ps
{
    public static async Task<JsonElement?> Json(string script, int timeoutSec = 90, CancellationToken ct = default)
    {
        var dir = Path.Combine(Path.GetTempPath(), "rocket-ps");
        Directory.CreateDirectory(dir);
        var id = Guid.NewGuid().ToString("N")[..10];
        var file = Path.Combine(dir, id + ".ps1");
        var outFile = Path.Combine(dir, id + ".json");
        var body = new StringBuilder()
            .AppendLine("$ErrorActionPreference = 'SilentlyContinue'")
            .AppendLine("$ProgressPreference = 'SilentlyContinue'")
            .AppendLine("$__r = & {")
            .AppendLine(script)
            .AppendLine("}")
            .AppendLine($"ConvertTo-Json -InputObject $__r -Depth 6 -Compress | Set-Content -Encoding UTF8 -LiteralPath '{outFile}'")
            .ToString();
        await File.WriteAllTextAsync(file, body, new UTF8Encoding(true), ct);
        try
        {
            using var p = Process.Start(new ProcessStartInfo("powershell.exe",
                $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{file}\"")
            { UseShellExecute = false, CreateNoWindow = true })!;
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(timeoutSec));
            try { await p.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException) { try { p.Kill(true); } catch { } return null; }
            if (!File.Exists(outFile)) return null;
            var text = (await File.ReadAllTextAsync(outFile, ct)).Trim();
            if (text.Length == 0) return null;
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.Clone();
        }
        catch { return null; }
        finally
        {
            try { File.Delete(file); } catch { }
            try { File.Delete(outFile); } catch { }
        }
    }

    /// <summary>Runs a console tool hidden and returns what it printed.</summary>
    public static string Run(string exe, string args, int timeoutMs = 15000)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
            })!;
            var o = p.StandardOutput.ReadToEndAsync();
            p.WaitForExit(timeoutMs);
            return o.Wait(1000) ? o.Result : "";
        }
        catch { return ""; }
    }

    // JsonElement helpers that never throw.
    public static string S(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : "";

    public static long L(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n
        : long.TryParse(e.S(name), out var m) ? m : 0;

    public static bool B(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    /// <summary>An array, or a single object PowerShell did not wrap, as a list.</summary>
    public static List<JsonElement> A(this JsonElement e, string? name = null)
    {
        var x = e;
        if (name != null && !(e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out x))) return [];
        return x.ValueKind switch
        {
            JsonValueKind.Array => x.EnumerateArray().ToList(),
            JsonValueKind.Object => [x],
            _ => [],
        };
    }
}
