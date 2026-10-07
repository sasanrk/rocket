using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Rocket.Core;

/// <summary>
/// Runs a PowerShell script with administrator rights: directly when Rocket already has
/// them, otherwise behind one UAC prompt. The script's output comes back through a file,
/// because an elevated process cannot be read through pipes from an unelevated one.
/// </summary>
public static class Elevated
{
    public sealed record Result(bool Ok, string Output, bool Refused = false);

    public static async Task<Result> PowerShell(string script, bool needsAdmin = true, CancellationToken ct = default)
    {
        var dir = Path.Combine(Path.GetTempPath(), "rocket-ps");
        Directory.CreateDirectory(dir);
        var id = Guid.NewGuid().ToString("N")[..10];
        var file = Path.Combine(dir, id + ".ps1");
        var outFile = Path.Combine(dir, id + ".out");
        var wrapped = new StringBuilder()
            .AppendLine("$ErrorActionPreference = 'Stop'")
            .AppendLine("$ProgressPreference = 'SilentlyContinue'")
            .AppendLine("try {")
            .AppendLine("& {")
            .AppendLine(script)
            .AppendLine($"}} *>&1 | Out-String -Width 400 | Set-Content -Encoding UTF8 -LiteralPath '{outFile}'")
            .AppendLine("exit 0")
            .AppendLine("} catch {")
            .AppendLine($"  ($_ | Out-String) | Set-Content -Encoding UTF8 -LiteralPath '{outFile}'")
            .AppendLine("  exit 1")
            .AppendLine("}")
            .ToString();
        await File.WriteAllTextAsync(file, wrapped, new UTF8Encoding(true), ct);

        bool elevate = needsAdmin && !Native.IsAdmin;
        var psi = new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{file}\"")
        {
            UseShellExecute = elevate,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        if (elevate) psi.Verb = "runas";
        try
        {
            using var p = Process.Start(psi)!;
            await p.WaitForExitAsync(ct);
            var output = File.Exists(outFile) ? (await File.ReadAllTextAsync(outFile, ct)).Trim() : "";
            return new Result(p.ExitCode == 0, output);
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            return new Result(false, "", Refused: true); // the UAC prompt was declined
        }
        catch (Exception ex) { return new Result(false, ex.Message); }
        finally
        {
            try { File.Delete(file); } catch { }
            try { File.Delete(outFile); } catch { }
        }
    }

    /// <summary>Single-quotes a value for a PowerShell script.</summary>
    public static string Q(string s) => "'" + s.Replace("'", "''") + "'";
}
