using System.Text.Json;
using System.Text.RegularExpressions;

namespace Rocket.Core;

/// <summary>A line of the "This PC" sheet: a label and its value.</summary>
public sealed record Spec(string Label, string Value);

/// <summary>One piece of upgrade advice.</summary>
public sealed record Advice(string Area, string Tone, string Title, string Why, string Suggestion)
{
    public bool IsUpgrade => Tone == "upgrade";
    public bool IsGood => Tone == "good";
    public string Glyph => Tone switch { "upgrade" => "", "good" => "", _ => "" };
}

/// <summary>A titled card of specs.</summary>
public sealed record SpecCard(string Title, string Glyph, List<Spec> Lines);

/// <summary>
/// What is in the box (one CIM pass through PowerShell) and what the board could take
/// instead: the socket's best processor, free memory slots, the GPU class, NVMe support.
/// </summary>
public static class Specs
{
    public sealed record Platform(string Vendor, string Generation, int? Gen, string Socket, string Ram, string? Best, string? BestCores,
        bool Nvme, int Era, bool Mobile);

    public sealed record Report(List<SpecCard> Cards, List<Advice> Advice, string Text);

    public static async Task<Report?> Read()
    {
        var j = await Ps.Json("""
            $cs = Get-CimInstance Win32_ComputerSystem
            $os = Get-CimInstance Win32_OperatingSystem
            $bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
            $bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
            $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
            $arr = Get-CimInstance Win32_PhysicalMemoryArray | Where-Object { $_.Use -eq 3 } | Select-Object -First 1
            $sys = $env:SystemDrive.Substring(0,1)
            $sysDisk = (Get-Partition -DriveLetter $sys).DiskNumber
            $parts = Get-Partition | Where-Object DriveLetter
            $logical = Get-CimInstance Win32_LogicalDisk
            [pscustomobject]@{
              maker = $cs.Manufacturer; model = $cs.Model; family = $cs.SystemFamily; pcType = [int]$cs.PCSystemType
              totalMem = [int64]$cs.TotalPhysicalMemory
              os = $os.Caption; osVersion = $os.Version; build = $os.BuildNumber; arch = $os.OSArchitecture
              osInstalled = if ($os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-dd') } else { '' }
              board = "$($bb.Manufacturer) $($bb.Product)".Trim(); bios = "$($bios.SMBIOSBIOSVersion)"
              biosDate = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { '' }
              cpu = $cpu.Name; cores = [int]$cpu.NumberOfCores; threads = [int]$cpu.NumberOfLogicalProcessors
              mhz = [int]$cpu.MaxClockSpeed; socket = $cpu.SocketDesignation; l2 = [int]$cpu.L2CacheSize; l3 = [int]$cpu.L3CacheSize
              maxMem = if ($arr.MaxCapacityEx) { [int64]$arr.MaxCapacityEx * 1024 } elseif ($arr.MaxCapacity) { [int64]$arr.MaxCapacity * 1024 } else { 0 }
              slots = [int]$arr.MemoryDevices
              modules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
                $t = [int]$_.SMBIOSMemoryType; if ($t -eq 0) { $t = [int]$_.MemoryType }
                [pscustomobject]@{ slot = $_.DeviceLocator; size = [int64]$_.Capacity; speed = [int]$_.Speed; conf = [int]$_.ConfiguredClockSpeed
                  type = $t; form = [int]$_.FormFactor; maker = "$($_.Manufacturer)".Trim(); part = "$($_.PartNumber)".Trim() } })
              gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
                [pscustomobject]@{ name = $_.Name; ram = [int64]$_.AdapterRAM; driver = $_.DriverVersion
                  res = if ($_.CurrentHorizontalResolution) { "$($_.CurrentHorizontalResolution) x $($_.CurrentVerticalResolution)" } else { '' } } })
              disks = @(Get-PhysicalDisk | ForEach-Object {
                $n = $_.DeviceId
                $letters = @($parts | Where-Object { "$($_.DiskNumber)" -eq "$n" } | Sort-Object Size -Descending | ForEach-Object { "$($_.DriveLetter):" })
                $l = @($logical | Where-Object { $letters -contains $_.DeviceID })
                [pscustomobject]@{ name = $_.FriendlyName; media = "$($_.MediaType)"; bus = "$($_.BusType)"; size = [int64]$_.Size
                  health = "$($_.HealthStatus)"; letters = ($letters -join ' '); total = [int64](($l | Measure-Object Size -Sum).Sum)
                  free = [int64](($l | Measure-Object FreeSpace -Sum).Sum); system = ("$n" -eq "$sysDisk") } })
              nets = @(Get-CimInstance Win32_NetworkAdapter -Filter 'PhysicalAdapter=True' |
                Where-Object { $_.Name -notmatch 'Wintun|TAP-Windows|OpenVPN|PdaNet|Hyper-V|VMware|VirtualBox|Bluetooth Device \(Personal' } |
                ForEach-Object { [pscustomobject]@{ name = $_.Name; speed = [int64]$_.Speed; up = [bool]$_.NetEnabled } })
            }
            """, 120);
        return j is { } e ? Build(e) : null;
    }

    private static string Clean(string cpu) => Regex.Replace(cpu.Replace("(R)", "").Replace("(TM)", ""), @"\s+CPU\s+@.*$|\s{2,}", " ").Trim();

    private static readonly Dictionary<int, string> RamTypes = new() { [20] = "DDR", [21] = "DDR2", [24] = "DDR3", [26] = "DDR4", [34] = "DDR5", [35] = "DDR5" };
    private static readonly Dictionary<int, string> Forms = new() { [8] = "DIMM", [12] = "SODIMM", [9] = "RIMM", [13] = "SRIMM" };
    private static readonly Regex Integrated = new(@"Intel\(R\) (?:HD|UHD|Iris|Arc\(TM\) Graphics$)|Radeon\(TM\) (?:Vega \d+ )?Graphics|AMD Radeon Graphics$|Radeon Graphics$|Microsoft Basic", RegexOptions.IgnoreCase);
    private static readonly Regex Weak = new(@"RX ?5[0-9]{2}\b|RX ?4[0-9]{2}\b|GT ?7[0-9]{2}\b|GT ?1030|GTX ?(?:7|9)[0-9]{2}\b|GTX ?10[0-5]0\b|Radeon R[579] ", RegexOptions.IgnoreCase);

    public static Platform Identify(string cpu, bool laptop)
    {
        bool mobile = laptop || Regex.IsMatch(cpu, @"\b(?:i[3579]|Ryzen [3579])[- ]?\d{3,5}(?:[A-Z]*)?(U|H|HQ|HK|HS|HX|P|G\d|Y)\b");
        if (Regex.IsMatch(cpu, "GenuineIntel|Intel", RegexOptions.IgnoreCase))
        {
            if (Regex.IsMatch(cpu, @"Core\(TM\) Ultra|Core Ultra"))
                return new("Intel", "Core Ultra", null, mobile ? "soldered (mobile)" : "LGA1851", "DDR5", mobile ? null : "Core Ultra 9 285K", "24 cores", true, 2024, mobile);
            var m = Regex.Match(cpu, @"i[3579][- ](\d{4,5})");
            int? gen = m.Success ? int.Parse(m.Groups[1].Value.Length == 5 ? m.Groups[1].Value[..2] : m.Groups[1].Value[..1]) : null;
            (string Socket, string Ram, string Best, string Cores, bool Nvme, int Era)? row = gen switch
            {
                2 or 3 => ("LGA1155", "DDR3", "Core i7-3770K", "4 cores / 8 threads", false, 2011),
                4 or 5 => ("LGA1150", "DDR3", "Core i7-4790K", "4 cores / 8 threads, 4.4 GHz turbo", false, 2013),
                6 or 7 => ("LGA1151", "DDR4", "Core i7-7700K", "4 cores / 8 threads", true, 2015),
                8 or 9 => ("LGA1151 (300-series)", "DDR4", "Core i9-9900K", "8 cores / 16 threads", true, 2017),
                10 or 11 => ("LGA1200", "DDR4", "Core i9-11900K", "8 cores / 16 threads", true, 2020),
                12 or 13 or 14 => ("LGA1700", "DDR4 / DDR5", "Core i9-14900K", "24 cores / 32 threads", true, 2021),
                _ => null,
            };
            var label = gen is { } g ? $"{g}th gen" : "";
            if (row is { } r)
                return new("Intel", label, gen, mobile ? "soldered (mobile)" : r.Socket, r.Ram, mobile ? null : r.Best, r.Cores, r.Nvme, r.Era, mobile);
            return new("Intel", label, gen, mobile ? "soldered (mobile)" : "unknown", "", null, null, gen >= 6, 0, mobile);
        }
        var a = Regex.Match(cpu, @"Ryzen\s+(?:[3579]|AI)\s+(?:PRO\s+)?(\d{4})");
        if (Regex.IsMatch(cpu, "AMD|Ryzen") && a.Success)
        {
            int model = int.Parse(a.Groups[1].Value);
            var label = $"Ryzen {a.Groups[1].Value[0]}000";
            if (model < 7000)
                return new("AMD", label, null, mobile ? "soldered (mobile)" : "AM4", "DDR4", mobile ? null : "Ryzen 7 5800X3D (gaming) or Ryzen 9 5950X (16 cores)", null, true, 2017, mobile);
            return new("AMD", label, null, mobile ? "soldered (mobile)" : "AM5", "DDR5", mobile ? null : "Ryzen 7 9800X3D (gaming) or Ryzen 9 9950X (16 cores)", null, true, 2022, mobile);
        }
        return new("", "", null, mobile ? "soldered (mobile)" : "unknown", "", null, null, false, 0, mobile);
    }

    private static Report Build(JsonElement e)
    {
        var L = Loc.I;
        const double GiB = 1L << 30;
        string cpu = Clean(e.S("cpu"));
        bool laptop = e.L("pcType") == 2 || Power.IsLaptop;
        var plat = Identify(e.S("cpu"), laptop);

        var modules = e.A("modules");
        var gpus = e.A("gpus");
        var disks = e.A("disks");
        long total = e.L("totalMem");
        long max = e.L("maxMem");
        int slots = Math.Max((int)e.L("slots"), modules.Count);
        string ramType = modules.Select(m => RamTypes.GetValueOrDefault((int)m.L("type"), "")).FirstOrDefault(t => t.Length > 0) ?? plat.Ram;
        int speed = modules.Select(m => (int)m.L("speed")).DefaultIfEmpty(0).Max();
        string form = modules.Select(m => Forms.GetValueOrDefault((int)m.L("form"), "DIMM")).FirstOrDefault() ?? "DIMM";

        // ── cards ──
        var cards = new List<SpecCard>
        {
            new(L["pc.cpu"], "",
            [
                new(L["pc.model"], cpu),
                new(L["pc.cores"], L.F("pc.coresval", e.L("cores"), e.L("threads"))),
                new(L["pc.clock"], $"{e.L("mhz") / 1000.0:0.00} GHz"),
                new(L["pc.cache"], $"L2 {e.L("l2") / 1024.0:0.#} MB · L3 {e.L("l3") / 1024.0:0.#} MB"),
                new(L["pc.socket"], plat.Socket + (plat.Generation.Length > 0 ? $" · {plat.Generation}" : "")),
            ]),
            new(L["pc.memory"], "",
            [
                new(L["pc.total"], $"{Math.Round(total / GiB)} GB {ramType}" + (speed > 0 ? $" · {speed} MHz" : "")),
                new(L["pc.slots"], L.F("pc.slotsval", modules.Count, slots)),
                new(L["pc.max"], max > 0 ? $"{Math.Round(max / GiB)} GB" : "—"),
                .. modules.Select(m => new Spec(m.S("slot"), $"{m.L("size") / GiB:0} GB {RamTypes.GetValueOrDefault((int)m.L("type"), "")} {m.L("speed")} MHz · {m.S("maker")} {m.S("part")}".Trim())),
            ]),
            new(L["pc.gpu"], "",
            [
                .. gpus.Select(g => new Spec(g.S("name"), string.Join(" · ", new[]
                {
                    g.L("ram") > 0 ? $"{g.L("ram") / GiB:0.#} GB" : "", g.S("res"), g.S("driver"),
                }.Where(s => s.Length > 0)))),
            ]),
            new(L["pc.storage"], "",
            [
                .. disks.Select(d => new Spec(d.S("name") + (d.S("letters").Length > 0 ? $"  ({d.S("letters")})" : ""),
                    string.Join(" · ", new[]
                    {
                        $"{d.L("size") / 1e9:0} GB", d.S("media"), d.S("bus"), d.L("total") > 0 ? L.F("pc.freeof", Format.Bytes(d.L("free"))) : "", d.S("health"),
                    }.Where(s => s.Length > 0 && s != "Unspecified")))),
            ]),
            new(L["pc.board"], "",
            [
                new(L["pc.computer"], $"{e.S("maker")} {e.S("model")}".Trim()),
                new(L["pc.boardname"], e.S("board")),
                new("BIOS", $"{e.S("bios")} · {e.S("biosDate")}"),
            ]),
            new(L["pc.windows"], "",
            [
                new(L["pc.edition"], e.S("os")),
                new(L["pc.build"], $"{e.S("osVersion")} · {e.S("arch")}"),
                new(L["pc.installed"], e.S("osInstalled")),
                .. e.A("nets").Select(n => new Spec(n.S("name"), n.B("up") ? (n.L("speed") > 0 && n.L("speed") < 1_000_000_000_000 ? $"{n.L("speed") / 1e6:0} Mbps" : L["pc.up"]) : L["pc.down"])),
            ]),
        };

        // ── advice ──
        var adv = new List<Advice>();
        int totalGB = (int)Math.Round(total / GiB), maxGB = (int)Math.Round(max / GiB);
        int free = slots - modules.Count;
        int perSlot = slots > 0 && maxGB > 0 ? maxGB / slots : 0;
        bool soldered = plat.Mobile && !modules.Any(m => (int)m.L("form") == 12);
        if (soldered) adv.Add(new("ram", "info", L["adv.ram.soldered"], L["adv.ram.soldered.w"], ""));
        else if (maxGB > 0 && totalGB >= maxGB) adv.Add(new("ram", "good", L.F("adv.ram.maxed", totalGB), L["adv.ram.maxed.w"], ""));
        else if (free > 0)
        {
            int add = perSlot > 0 ? Math.Min(perSlot, maxGB - totalGB > 0 ? maxGB - totalGB : perSlot) : 8;
            adv.Add(new("ram", "upgrade", L.F("adv.ram.add", add * free, free, slots), L.F("adv.ram.add.w", totalGB),
                L.F("adv.ram.add.s", free, add, ramType, speed, form)));
        }
        else if (perSlot > 0 && modules.Any(m => m.L("size") / GiB < perSlot - 0.5))
            adv.Add(new("ram", "upgrade", L.F("adv.ram.replace", maxGB - totalGB), L.F("adv.ram.replace.w", perSlot), ""));
        if (modules.Select(m => m.L("speed")).Where(s => s > 0).Distinct().Count() > 1)
            adv.Add(new("ram", "info", L.F("adv.ram.mixed", modules.Select(m => m.L("conf")).Where(s => s > 0).DefaultIfEmpty(0).Min()), L["adv.ram.mixed.w"], ""));
        if (totalGB is > 0 and < 16) adv.Add(new("ram", "upgrade", L.F("adv.ram.tight", totalGB), L["adv.ram.tight.w"], ""));

        if (plat.Mobile) adv.Add(new("cpu", "info", L["adv.cpu.mobile"], L["adv.cpu.mobile.w"], ""));
        else if (plat.Best is { } best)
        {
            var last = Regex.Replace(best, @"\(.*?\)", "").Trim().Split(' ').Last();
            if (cpu.Contains(last, StringComparison.OrdinalIgnoreCase))
                adv.Add(new("cpu", "good", L.F("adv.cpu.top", cpu, plat.Socket), L["adv.cpu.top.w"], ""));
            else
                adv.Add(new("cpu", "upgrade", L.F("adv.cpu.fits", best), L.F("adv.cpu.fits.w", plat.Socket, DateTime.Now.Year - plat.Era, plat.BestCores ?? ""),
                    L.F("adv.cpu.fits.s", plat.Era + 1)));
        }
        else adv.Add(new("cpu", "info", L["adv.cpu.unknown"], L["adv.cpu.unknown.w"], ""));

        var dedicated = gpus.Where(g => !Integrated.IsMatch(g.S("name"))).ToList();
        if (dedicated.Count == 0)
            adv.Add(plat.Mobile ? new("gpu", "info", L["adv.gpu.igpu.mobile"], L["adv.gpu.igpu.mobile.w"], "")
                                : new("gpu", "upgrade", L["adv.gpu.none"], L["adv.gpu.none.w"], L["adv.gpu.none.s"]));
        else
        {
            var g = dedicated[0];
            bool weak = Weak.IsMatch(g.S("name")) || (g.L("ram") > 0 && g.L("ram") <= 4L << 30);
            adv.Add(weak ? new("gpu", "info", L.F("adv.gpu.weak", g.S("name")), L["adv.gpu.weak.w"], "")
                         : new("gpu", "good", L.F("adv.gpu.good", g.S("name")), "", ""));
        }

        var sysDisk = disks.FirstOrDefault(d => d.B("system"));
        if (sysDisk.ValueKind == JsonValueKind.Undefined && disks.Count > 0) sysDisk = disks[0];
        if (sysDisk.ValueKind != JsonValueKind.Undefined)
        {
            var media = sysDisk.S("media");
            if (Regex.IsMatch(media, "HDD", RegexOptions.IgnoreCase))
                adv.Add(new("disk", "upgrade", L["adv.disk.hdd"], L["adv.disk.hdd.w"], plat.Nvme ? L["adv.disk.nvme.s"] : L["adv.disk.sata.s"]));
            else if (sysDisk.S("bus").Equals("SATA", StringComparison.OrdinalIgnoreCase))
                adv.Add(plat.Nvme ? new("disk", "info", L["adv.disk.satanvme"], L["adv.disk.satanvme.w"], "")
                                  : new("disk", "good", L["adv.disk.sataceil"], L["adv.disk.sataceil.w"], ""));
            else adv.Add(new("disk", "good", L["adv.disk.fast"], "", ""));
        }
        foreach (var d in disks.Where(d => d.L("total") > 0 && (double)d.L("free") / d.L("total") < 0.1))
            adv.Add(new("disk", "upgrade", L.F("adv.disk.full", Format.Ltr(d.S("letters"))), L["adv.disk.full.w"], ""));

        var os = e.S("os");
        if (os.Contains("Windows 11") && plat.Vendor == "Intel" && plat.Gen is int gen && gen < 8)
            adv.Add(new("os", "info", L["adv.os.unsupported"], L["adv.os.unsupported.w"], ""));
        else if (os.Contains("Windows 10"))
            adv.Add(new("os", "info", L["adv.os.win10"], L["adv.os.win10.w"], ""));

        var text = string.Join("\n\n", cards.Select(c => c.Title + "\n" + string.Join("\n", c.Lines.Select(l => $"  {l.Label}: {l.Value}"))));
        return new Report(cards, adv.OrderBy(a => a.Tone switch { "upgrade" => 0, "info" => 1, _ => 2 }).ToList(), text);
    }
}
