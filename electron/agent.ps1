# Long-lived helper for the Reclaim main process.
#
# Spawning powershell.exe costs the better part of a second, which is absurd for
# a tool whose whole point is to stop wasting the machine's time. So we spawn it
# once and speak newline-delimited JSON over stdin/stdout instead.
#
# Protocol: one request object per line -> one response object per line.
#   -> {"id":"1","op":"snapshot"}
#   <- {"id":"1","ok":true,"data":{...}}

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$cores = [Environment]::ProcessorCount

# Restart Manager is how Windows itself works out which programs are holding a
# file open — the same machinery an installer uses before asking you to close
# things. It is far more reliable than guessing from process names.
#
# Compiling this costs about seven seconds, so it is deferred until something
# actually asks who holds a file. Paying it at startup would delay the first
# process snapshot, which is the thing the user waits on.
$script:lockFinderReady = $false

function Initialize-LockFinder {
  if ($script:lockFinderReady) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class LockFinder {
  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }

  const int CCH_RM_MAX_APP_NAME = 255;
  const int CCH_RM_MAX_SVC_NAME = 63;
  const int ERROR_MORE_DATA = 234;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;
    public int ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint pSessionHandle);

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
    uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo,
    [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

  public static List<int> Who(string[] paths) {
    var found = new List<int>();
    uint handle;
    if (RmStartSession(out handle, 0, Guid.NewGuid().ToString()) != 0) return found;
    try {
      if (RmRegisterResources(handle, (uint)paths.Length, paths, 0, null, 0, null) != 0) return found;
      uint needed = 0, count = 0, reasons = 0;
      int status = RmGetList(handle, out needed, ref count, null, ref reasons);
      if (status == ERROR_MORE_DATA && needed > 0) {
        var infos = new RM_PROCESS_INFO[needed];
        count = needed;
        if (RmGetList(handle, out needed, ref count, infos, ref reasons) == 0) {
          for (int i = 0; i < count; i++) found.Add(infos[i].Process.dwProcessId);
        }
      }
    } finally {
      RmEndSession(handle);
    }
    return found;
  }
}
'@
  $script:lockFinderReady = $true
}

# Restart Manager registers files, not folders. Given a folder that will not go,
# walk a little way into it to find real files to ask about.
function Resolve-SampleFiles($paths, $limit) {
  $files = New-Object System.Collections.Generic.List[string]
  foreach ($p in $paths) {
    if ($files.Count -ge $limit) { break }
    try {
      if ([System.IO.File]::Exists($p)) { $files.Add($p); continue }
      if (-not [System.IO.Directory]::Exists($p)) { continue }
      $stack = New-Object System.Collections.Stack
      $stack.Push((New-Object System.IO.DirectoryInfo($p)))
      while ($stack.Count -gt 0 -and $files.Count -lt $limit) {
        $dir = $stack.Pop()
        try {
          foreach ($f in $dir.EnumerateFiles()) {
            $files.Add($f.FullName)
            if ($files.Count -ge $limit) { break }
          }
          if ($files.Count -lt $limit) {
            foreach ($d in $dir.EnumerateDirectories()) { $stack.Push($d) }
          }
        } catch { }
      }
    } catch { }
  }
  $files.ToArray()
}

function Get-Lockers($paths) {
  $files = Resolve-SampleFiles $paths 40
  if ($files.Count -eq 0) { return @() }
  Initialize-LockFinder
  $pids = [LockFinder]::Who($files)
  $result = New-Object System.Collections.ArrayList
  foreach ($id in ($pids | Select-Object -Unique)) {
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    $title = ''
    try { $title = $proc.MainWindowTitle } catch { }
    [void]$result.Add([pscustomobject]@{
      pid       = $id
      name      = $proc.ProcessName
      title     = $title
      protected = $protected -contains $proc.ProcessName.ToLowerInvariant()
    })
  }
  @($result)
}

# CPU time consumed by each pid at the previous snapshot, so a snapshot can
# report a real percentage without ever sleeping.
$previous = @{}
$previousAt = $null

# Killing any of these takes the desktop or the machine down with it.
$protected = @(
  'system', 'idle', 'registry', 'memory compression', 'smss', 'csrss', 'wininit',
  'winlogon', 'services', 'lsass', 'lsaiso', 'fontdrvhost', 'dwm', 'sihost',
  'ctfmon', 'audiodg', 'wudfhost', 'securityhealthservice', 'msmpeng', 'nissrv'
)

function Send($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Depth 6 -Compress))
  [Console]::Out.Flush()
}

function Get-Snapshot {
  $now = [DateTime]::UtcNow
  $spanMs = if ($previousAt) { ($now - $previousAt).TotalMilliseconds } else { 0 }

  $processes = Get-Process -ErrorAction SilentlyContinue
  $current = @{}
  $list = New-Object System.Collections.ArrayList
  $busiest = 0.0

  foreach ($p in $processes) {
    $cpuMs = 0.0
    try { $cpuMs = $p.TotalProcessorTime.TotalMilliseconds } catch { continue }
    $current[$p.Id] = $cpuMs

    $cpu = 0.0
    if ($spanMs -gt 50 -and $previous.ContainsKey($p.Id)) {
      $delta = $cpuMs - $previous[$p.Id]
      if ($delta -gt 0) { $cpu = [math]::Round(100 * $delta / ($spanMs * $cores), 1) }
      # A pid that was recycled can produce nonsense; clamp rather than lie.
      if ($cpu -gt 100) { $cpu = 100 }
    }
    $busiest += $cpu

    $priority = ''
    try { $priority = [string]$p.PriorityClass } catch { $priority = '' }

    $started = $null
    try { $started = $p.StartTime.ToUniversalTime().ToString('o') } catch { $started = $null }

    [void]$list.Add([pscustomobject]@{
      pid         = $p.Id
      name        = $p.ProcessName
      title       = $p.MainWindowTitle
      cpu         = $cpu
      memoryBytes = [int64]$p.WorkingSet64
      priority    = $priority
      threads     = $p.Threads.Count
      startedAt   = $started
      protected   = $protected -contains $p.ProcessName.ToLowerInvariant()
    })
  }

  $script:previous = $current
  $script:previousAt = $now

  @{
    cores      = $cores
    sampleMs   = [math]::Round($spanMs)
    cpuPercent = [math]::Round([math]::Min(100, $busiest), 1)
    processes  = @($list)
  }
}

# Command lines are only available through WMI, which is slow, so they are
# fetched for the handful of names a developer actually needs to tell apart.
function Get-CommandLines($names) {
  $result = @{}
  foreach ($name in $names) {
    try {
      Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction Stop |
        ForEach-Object { $result["$($_.ProcessId)"] = $_.CommandLine }
    } catch {
      # A name with no running processes is normal, not an error.
    }
  }
  $result
}

# Folders a developer's tooling writes to constantly. Real-time scanning
# inspects every one of those writes, which is what turns an npm install into a
# stalled machine. Reported so the app can say which are still unprotected.
function Get-DevCachePaths {
  function Join-Under([string]$base, [string[]]$parts) {
    if ([string]::IsNullOrEmpty($base)) { return $null }
    $p = $base
    foreach ($part in $parts) { $p = [System.IO.Path]::Combine($p, $part) }
    $p
  }

  $candidates = @(
    @{ path = (Join-Under $env:LOCALAPPDATA @('Temp'));               label = 'Temp files' },
    @{ path = (Join-Under $env:APPDATA      @('npm-cache'));          label = 'npm cache' },
    @{ path = (Join-Under $env:LOCALAPPDATA @('npm-cache'));          label = 'npm cache' },
    @{ path = (Join-Under $env:USERPROFILE  @('.npm'));               label = 'npm cache' },
    @{ path = (Join-Under $env:LOCALAPPDATA @('Yarn', 'Cache'));      label = 'Yarn cache' },
    @{ path = (Join-Under $env:LOCALAPPDATA @('pnpm'));               label = 'pnpm store' },
    @{ path = (Join-Under $env:USERPROFILE  @('.gradle'));            label = 'Gradle cache' },
    @{ path = (Join-Under $env:USERPROFILE  @('.m2'));                label = 'Maven cache' },
    @{ path = (Join-Under $env:USERPROFILE  @('.cargo'));             label = 'Cargo cache' },
    @{ path = (Join-Under $env:APPDATA      @('Docker'));             label = 'Docker' },
    @{ path = (Join-Under $env:LOCALAPPDATA @('Docker'));             label = 'Docker' },
    @{ path = (Join-Under $env:USERPROFILE  @('.vscode', 'extensions')); label = 'VS Code extensions' },
    @{ path = (Join-Under $env:LOCALAPPDATA @('Programs'));           label = 'User-installed apps' }
  )

  $found = New-Object System.Collections.ArrayList
  foreach ($c in $candidates) {
    if ($c.path -and [System.IO.Directory]::Exists($c.path)) {
      [void]$found.Add([pscustomobject]@{ path = $c.path; label = $c.label })
    }
  }
  @($found)
}

function Get-DefenderInfo {
  $info = @{
    running          = $false
    cpu              = 0.0
    memoryMB         = 0
    exclusions       = @()
    exclusionProcess = @()
    realTime         = $null
    behaviorMonitor  = $null
    scanInProgress   = $false
    cpuLoadFactor    = $null
    onlyWhenIdle     = $null
    catchUpQuick     = $null
    catchUpFull      = $null
    lastQuickScan    = $null
    devPaths         = @()
    available        = $false
    tamperProtected  = $null
  }

  $engine = Get-Process -Name MsMpEng -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($engine) {
    $info.running = $true
    $info.memoryMB = [math]::Round($engine.WorkingSet64 / 1MB)
  }

  try {
    $preference = Get-MpPreference -ErrorAction Stop
    $info.exclusions = @($preference.ExclusionPath | Where-Object { $_ })
    $info.exclusionProcess = @($preference.ExclusionProcess | Where-Object { $_ })
    $info.cpuLoadFactor = $preference.ScanAvgCPULoadFactor
    $info.onlyWhenIdle = [bool]$preference.ScanOnlyIfIdleEnabled
    # These read as "catch-up is disabled", so invert to "a missed scan reruns".
    $info.catchUpQuick = -not [bool]$preference.DisableCatchupQuickScan
    $info.catchUpFull = -not [bool]$preference.DisableCatchupFullScan

    $status = Get-MpComputerStatus -ErrorAction Stop
    $info.realTime = [bool]$status.RealTimeProtectionEnabled
    $info.behaviorMonitor = [bool]$status.BehaviorMonitorEnabled
    $info.scanInProgress = [bool]($status.QuickScanInProgress -or $status.FullScanInProgress)
    if ($status.QuickScanStartTime) { $info.lastQuickScan = $status.QuickScanStartTime.ToUniversalTime().ToString('o') }
    # Tamper Protection is what actually decides whether Set-MpPreference can
    # touch real-time protection at all — Windows silently ignores the change
    # otherwise. The property is only on newer builds, so a missing one reads
    # as "unknown" rather than "off".
    $tamperProperty = $status.PSObject.Properties['IsTamperProtected']
    if ($tamperProperty) { $info.tamperProtected = [bool]$tamperProperty.Value }
    $info.devPaths = Get-DevCachePaths
    $info.available = $true
  } catch {
    # Defender may be replaced by another product, or the cmdlets unavailable.
  }

  $info
}

# ---------------------------------------------------------------- CPU & power

# Processor power settings live under this subgroup of every power scheme.
$SUB_PROCESSOR = '54533251-82be-4824-96c1-47b60b740d00'
$PROC_SETTINGS = @{
  min      = '893dee8e-2bef-41e0-89c6-b55d0929964c'   # minimum processor state, %
  max      = 'bc5038f7-23e0-4960-96da-33abaf5935ec'   # maximum processor state, %
  boost    = 'be337238-0d82-4146-a960-4f3749d470c7'   # performance boost mode, 0 off .. 2 aggressive
  minCores = '0cc5b647-c1df-4637-891a-dec35c318583'   # core parking: minimum unparked cores, %
  cooling  = '94d3a615-a899-4ac5-ae2b-e4d8f634367f'   # cooling policy, 0 passive / 1 active
}
$OVERLAYS = @{
  'ded574b5-45a0-4f42-8737-46345c09c238' = 'max'
  '3af9b8d9-7c97-431d-ad78-34a8bfea439f' = 'high'
  '961cc777-2547-4f9d-8174-7d86181b8a7a' = 'saver'
  '00000000-0000-0000-0000-000000000000' = 'balanced'
}
# Chassis types Windows reports for anything with a battery and a lid.
$LAPTOP_CHASSIS = @(8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32)

# powercfg reports "does not exist" on stderr for hidden settings and for
# overlays on machines without them; under $ErrorActionPreference = 'Stop'
# that would abort the whole reading, so stderr is dropped before it reaches
# PowerShell at all.
function Invoke-PowerCfg([string]$arguments) {
  try { @(& cmd.exe /d /c "powercfg $arguments 2>nul") } catch { @() }
}

function Get-PowerSchemes {
  $list = New-Object System.Collections.ArrayList
  foreach ($line in (Invoke-PowerCfg '/list')) {
    if ($line -match 'GUID:\s*([0-9a-f-]{36})\s+\((.+?)\)\s*(\*)?\s*$') {
      [void]$list.Add([pscustomobject]@{ guid = $Matches[1]; name = $Matches[2]; active = [bool]$Matches[3] })
    }
  }
  @($list)
}

# A scheme's value is only written to the User\PowerSchemes hive once someone
# changes it; before that the answer lives with the setting's defaults.
function Get-PowerValue([string]$scheme, [string]$setting) {
  $user = "HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes\$scheme\$SUB_PROCESSOR\$setting"
  if (Test-Path $user) {
    $p = Get-ItemProperty $user -ErrorAction SilentlyContinue
    if ($null -ne $p.ACSettingIndex) { return @{ ac = [int]$p.ACSettingIndex; dc = [int]$p.DCSettingIndex } }
  }
  $default = "HKLM:\SYSTEM\CurrentControlSet\Control\Power\PowerSettings\$SUB_PROCESSOR\$setting\DefaultPowerSchemeValues\$scheme"
  if (Test-Path $default) {
    $p = Get-ItemProperty $default -ErrorAction SilentlyContinue
    if ($null -ne $p.AcSettingIndex) { return @{ ac = [int]$p.AcSettingIndex; dc = [int]$p.DcSettingIndex } }
  }
  # A duplicated scheme (Ultimate Performance) has no defaults under its own guid.
  $ac = $null; $dc = $null
  foreach ($line in (Invoke-PowerCfg "/q $scheme $SUB_PROCESSOR $setting")) {
    if ($line -match 'Current AC Power Setting Index:\s*0x([0-9a-f]+)') { $ac = [Convert]::ToInt32($Matches[1], 16) }
    if ($line -match 'Current DC Power Setting Index:\s*0x([0-9a-f]+)') { $dc = [Convert]::ToInt32($Matches[1], 16) }
  }
  if ($null -ne $ac) { return @{ ac = $ac; dc = $dc } }
  $null
}

# Raw performance counters so a reading never sleeps: the ratio of two deltas
# is the same number the formatted class would spend a second computing.
$script:perfPrevious = $null

function Get-CpuLive {
  $live = @{
    perfPercent    = $null
    utilityPercent = $null
    currentMHz     = $null
    onBattery      = $null
    batteryPercent = $null
  }
  try {
    $raw = Get-CimInstance Win32_PerfRawData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction Stop
    if ($script:perfPrevious) {
      $dBase = $raw.PercentProcessorPerformance_Base - $script:perfPrevious.PercentProcessorPerformance_Base
      if ($dBase -gt 0) {
        $live.perfPercent = [math]::Round(($raw.PercentProcessorPerformance - $script:perfPrevious.PercentProcessorPerformance) / $dBase, 1)
      }
      $uBase = $raw.PercentProcessorUtility_Base - $script:perfPrevious.PercentProcessorUtility_Base
      if ($uBase -gt 0) {
        # Utility can read a hair over 100 while turbo is engaged; the bar cannot.
        $live.utilityPercent = [math]::Min(100, [math]::Round(($raw.PercentProcessorUtility - $script:perfPrevious.PercentProcessorUtility) / $uBase, 1))
      }
    }
    if ($null -ne $live.perfPercent -and $raw.ProcessorFrequency) {
      $live.currentMHz = [math]::Round($raw.ProcessorFrequency * $live.perfPercent / 100)
    }
    $script:perfPrevious = $raw
  } catch { }
  try {
    $battery = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1
    if ($battery) {
      $live.onBattery = ($battery.BatteryStatus -eq 1)
      $live.batteryPercent = [int]$battery.EstimatedChargeRemaining
    }
  } catch { }
  $live
}

$script:cpuStatic = $null

function Get-CpuStatic {
  if ($script:cpuStatic) { return $script:cpuStatic }
  $static = @{ name = ''; cores = $cores; logical = $cores; maxMHz = $null; isLaptop = $false; systemDriveIsSsd = $null }
  try {
    $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
    $static.name = [string]$cpu.Name.Trim()
    $static.cores = [int]$cpu.NumberOfCores
    $static.logical = [int]$cpu.NumberOfLogicalProcessors
    $static.maxMHz = [int]$cpu.MaxClockSpeed
  } catch { }
  try {
    $chassis = @((Get-CimInstance Win32_SystemEnclosure -ErrorAction Stop).ChassisTypes)
    $static.isLaptop = [bool]($chassis | Where-Object { $LAPTOP_CHASSIS -contains $_ })
  } catch { }
  try {
    $disk = (Get-Partition -DriveLetter ($env:SystemDrive.TrimEnd(':')) -ErrorAction Stop | Select-Object -First 1).DiskNumber
    $physical = Get-PhysicalDisk -ErrorAction Stop | Where-Object { [int]$_.DeviceId -eq $disk } | Select-Object -First 1
    if ($physical) { $static.systemDriveIsSsd = ($physical.MediaType -eq 'SSD') }
  } catch { }
  $script:cpuStatic = $static
  $static
}

function Get-CpuInfo {
  $static = Get-CpuStatic
  $info = @{
    name               = $static.name
    cores              = $static.cores
    logical            = $static.logical
    maxMHz             = $static.maxMHz
    isLaptop           = $static.isLaptop
    systemDriveIsSsd   = $static.systemDriveIsSsd
    schemes            = @()
    activeScheme       = $null
    overlay            = 'unsupported'
    settings           = @{}
    prioritySeparation = $null
    services           = @{}
    live               = (Get-CpuLive)
  }

  if ($null -ne $info.live.onBattery) { $info.isLaptop = $true }

  $schemes = Get-PowerSchemes
  $info.schemes = @($schemes | ForEach-Object { @{ guid = $_.guid; name = $_.name } })
  $active = $schemes | Where-Object { $_.active } | Select-Object -First 1
  if ($active) {
    $info.activeScheme = @{ guid = $active.guid; name = $active.name }
    foreach ($key in $PROC_SETTINGS.Keys) {
      $info.settings[$key] = Get-PowerValue $active.guid $PROC_SETTINGS[$key]
    }
  }

  foreach ($line in (Invoke-PowerCfg '/getactiveoverlayscheme')) {
    if ($line -match 'GUID:\s*([0-9a-f-]{36})') {
      $guid = $Matches[1]
      $info.overlay = if ($OVERLAYS.ContainsKey($guid)) { $OVERLAYS[$guid] } else { 'balanced' }
    }
  }

  try {
    $info.prioritySeparation = [int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl' -ErrorAction Stop).Win32PrioritySeparation
  } catch { }

  foreach ($name in @('SysMain', 'WSearch')) {
    try {
      $service = Get-Service -Name $name -ErrorAction Stop
      $info.services[$name] = @{ status = [string]$service.Status; startType = [string]$service.StartType }
    } catch { }
  }

  $info
}

# ------------------------------------------------------------------- startup

# What Task Manager's Startup tab reads and writes: the Run keys and the
# startup folders, gated by the StartupApproved values (02 = on, 03 = off).
$STARTUP_SOURCES = @(
  @{ id = 'hkcu';   scope = 'user';    run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';             approved = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ id = 'hklm';   scope = 'machine'; run = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run';             approved = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ id = 'hklm32'; scope = 'machine'; run = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; approved = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32' },
  @{ id = 'folder-user';    scope = 'user';    folder = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup');     approved = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' },
  @{ id = 'folder-machine'; scope = 'machine'; folder = (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\StartUp'); approved = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
)

function Get-StartupSource([string]$id) {
  $STARTUP_SOURCES | Where-Object { $_.id -eq $id } | Select-Object -First 1
}

function Get-ApprovedState([string]$key, [string]$name) {
  try {
    $value = (Get-ItemProperty -Path $key -Name $name -ErrorAction Stop).$name
    if ($value -is [byte[]] -and $value.Length -gt 0) { return ($value[0] % 2 -eq 0) }
  } catch { }
  # No approval record means Windows has never been told to skip it.
  $true
}

function Get-StartupEntries {
  $list = New-Object System.Collections.ArrayList
  foreach ($source in $STARTUP_SOURCES) {
    if ($source.run) {
      try {
        $props = Get-ItemProperty -Path $source.run -ErrorAction Stop
        foreach ($prop in $props.PSObject.Properties) {
          if ($prop.Name -like 'PS*') { continue }
          [void]$list.Add([pscustomobject]@{
            id      = "$($source.id):$($prop.Name)"
            source  = $source.id
            scope   = $source.scope
            name    = $prop.Name
            command = [string]$prop.Value
            enabled = (Get-ApprovedState $source.approved $prop.Name)
          })
        }
      } catch { }
    } elseif ($source.folder -and (Test-Path $source.folder)) {
      foreach ($file in (Get-ChildItem -Path $source.folder -File -ErrorAction SilentlyContinue)) {
        if ($file.Name -eq 'desktop.ini') { continue }
        [void]$list.Add([pscustomobject]@{
          id      = "$($source.id):$($file.Name)"
          source  = $source.id
          scope   = $source.scope
          name    = $file.Name
          command = $file.FullName
          enabled = (Get-ApprovedState $source.approved $file.Name)
        })
      }
    }
  }
  @($list)
}

function Set-StartupEnabled([string]$sourceId, [string]$name, [bool]$enabled) {
  $source = Get-StartupSource $sourceId
  if (-not $source) { throw "unknown startup source '$sourceId'" }
  $bytes = if ($enabled) {
    [byte[]](2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  } else {
    [byte[]](3, 0, 0, 0) + [BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTime())
  }
  if (-not (Test-Path $source.approved)) { New-Item -Path $source.approved -Force -ErrorAction Stop | Out-Null }
  Set-ItemProperty -Path $source.approved -Name $name -Value $bytes -Type Binary -ErrorAction Stop
  @{ id = "$($source.id):$name"; enabled = (Get-ApprovedState $source.approved $name) }
}

# --------------------------------------------------------------- recycle bin

function Get-RecycleBin {
  $items = 0
  $bytes = [int64]0
  try {
    $shell = New-Object -ComObject Shell.Application
    $bin = $shell.NameSpace(10)
    foreach ($item in $bin.Items()) {
      $items += 1
      $bytes += [int64]$item.Size
    }
  } catch { }
  @{ items = $items; bytes = $bytes }
}


# ------------------------------------------------------------------ programs

# Where Windows keeps its Add/Remove list: three registry hives plus the
# Store's own package database.
$UNINSTALL_ROOTS = @(
  @{ key = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall';             scope = 'machine'; arch = 'x64' },
  @{ key = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'; scope = 'machine'; arch = 'x86' },
  @{ key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall';             scope = 'user';    arch = 'x64' }
)

function Get-RegistryPrograms {
  $list = New-Object System.Collections.ArrayList
  foreach ($root in $UNINSTALL_ROOTS) {
    if (-not (Test-Path $root.key)) { continue }
    foreach ($item in (Get-ChildItem -Path $root.key -ErrorAction SilentlyContinue)) {
      $p = $null
      try { $p = Get-ItemProperty -Path $item.PSPath -ErrorAction Stop } catch { continue }
      $name = [string]$p.DisplayName
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      # Windows' own components and per-update entries are not programs.
      if ($p.SystemComponent -eq 1) { continue }
      if ($p.ParentKeyName) { continue }
      if ($p.ReleaseType -match 'Update|Hotfix|Security Update') { continue }
      if ($name -match '^(Update for|Security Update for|Hotfix for) ') { continue }

      $date = $null
      if ($p.InstallDate -match '^(\d{4})(\d{2})(\d{2})$') { $date = "$($Matches[1])-$($Matches[2])-$($Matches[3])" }

      [void]$list.Add([pscustomobject]@{
        id                   = "$($root.scope):$($root.arch):$($item.PSChildName)"
        kind                 = 'desktop'
        scope                = $root.scope
        keyPath              = ($item.PSPath -replace '^Microsoft\.PowerShell\.Core\\Registry::', '')
        keyName              = $item.PSChildName
        name                 = $name.Trim()
        publisher            = [string]$p.Publisher
        version              = [string]$p.DisplayVersion
        installDate          = $date
        sizeBytes            = if ($p.EstimatedSize) { [int64]$p.EstimatedSize * 1024 } else { 0 }
        installLocation      = [string]$p.InstallLocation
        uninstallString      = [string]$p.UninstallString
        quietUninstallString = [string]$p.QuietUninstallString
        icon                 = [string]$p.DisplayIcon
        isMsi                = ($p.WindowsInstaller -eq 1) -or ([string]$p.UninstallString -match '^\s*"?msiexec')
        noModify             = ($p.NoRemove -eq 1)
      })
    }
  }
  @($list)
}

function Get-StorePrograms {
  $list = New-Object System.Collections.ArrayList
  $packages = @()
  try { $packages = Get-AppxPackage -ErrorAction Stop } catch { return @() }

  # The Start menu is the list of Store apps a person would recognise, and it
  # carries the resolved display names; runtimes and plumbing packages have
  # no tile and are left out.
  $startNames = @{}
  $haveStart = $false
  try {
    foreach ($app in (Get-StartApps -ErrorAction Stop)) {
      if ($app.AppID -match '^([^!]+)!') {
        $family = $Matches[1]
        if (-not $startNames.ContainsKey($family)) { $startNames[$family] = [string]$app.Name }
      }
    }
    $haveStart = $startNames.Count -gt 0
  } catch { }

  foreach ($pkg in $packages) {
    if ($pkg.IsFramework -or $pkg.IsResourcePackage -or $pkg.NonRemovable) { continue }
    if ($pkg.SignatureKind -eq 'System') { continue }
    if ($haveStart -and -not $startNames.ContainsKey($pkg.PackageFamilyName)) { continue }
    $display = if ($haveStart) { $startNames[$pkg.PackageFamilyName] } else { $pkg.Name }
    $publisher = ''
    try {
      $manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName -ErrorAction Stop
      $candidate = [string]$manifest.Package.Properties.PublisherDisplayName
      if ($candidate -and $candidate -notmatch '^ms-resource:') { $publisher = $candidate }
    } catch { }
    if (-not $publisher -and $pkg.Publisher -match 'CN=([^,]+)') { $publisher = $Matches[1] }

    [void]$list.Add([pscustomobject]@{
      id                   = "store:$($pkg.PackageFullName)"
      kind                 = 'store'
      scope                = 'user'
      keyPath              = ''
      keyName              = $pkg.PackageFullName
      name                 = $display
      publisher            = $publisher
      version              = [string]$pkg.Version
      installDate          = $null
      sizeBytes            = 0
      installLocation      = [string]$pkg.InstallLocation
      uninstallString      = ''
      quietUninstallString = ''
      icon                 = ''
      isMsi                = $false
      noModify             = $false
    })
  }
  @($list)
}

function Get-Programs {
  @((Get-RegistryPrograms) + (Get-StorePrograms))
}

# Runs a program and waits for it to finish; the caller decides what to run.
function Invoke-Program([string]$file, [string]$arguments, [int]$timeoutSeconds) {
  $started = if ([string]::IsNullOrWhiteSpace($arguments)) {
    Start-Process -FilePath $file -PassThru -ErrorAction Stop
  } else {
    Start-Process -FilePath $file -ArgumentList $arguments -PassThru -ErrorAction Stop
  }
  $finished = $started.WaitForExit($timeoutSeconds * 1000)
  @{ pid = $started.Id; finished = $finished; exitCode = if ($finished) { $started.ExitCode } else { $null } }
}

# --------------------------------------------------------------------- specs

# Everything the This PC page shows, read once from WMI/SMBIOS. Slow on the
# first call (the providers load), so it is cached; hardware does not change
# while the app runs.
$script:specsCache = $null

function Get-SystemSpecs {
  if ($script:specsCache) { return $script:specsCache }
  $specs = @{
    computer = @{ manufacturer = ''; model = ''; family = ''; pcType = 0 }
    os       = @{ name = ''; version = ''; build = ''; arch = ''; installedAt = $null }
    board    = @{ manufacturer = ''; product = ''; version = ''; bios = ''; biosDate = $null }
    cpu      = @{ name = ''; cores = $cores; threads = $cores; maxMHz = $null; socket = ''; l2KB = $null; l3KB = $null }
    memory   = @{ totalBytes = 0; maxBytes = $null; slots = $null; modules = @() }
    gpus     = @()
    disks    = @()
    network  = @()
    monitors = @()
  }
  try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $specs.computer = @{ manufacturer = [string]$cs.Manufacturer; model = [string]$cs.Model; family = [string]$cs.SystemFamily; pcType = [int]$cs.PCSystemType }
    $specs.memory.totalBytes = [int64]$cs.TotalPhysicalMemory
  } catch { }
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $installed = $null
    if ($os.InstallDate) { $installed = $os.InstallDate.ToUniversalTime().ToString('o') }
    $specs.os = @{ name = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; arch = [string]$os.OSArchitecture; installedAt = $installed }
  } catch { }
  try {
    $board = Get-CimInstance Win32_BaseBoard -ErrorAction Stop | Select-Object -First 1
    $bios = Get-CimInstance Win32_BIOS -ErrorAction Stop | Select-Object -First 1
    $biosDate = $null
    if ($bios.ReleaseDate) { $biosDate = $bios.ReleaseDate.ToUniversalTime().ToString('o') }
    $specs.board = @{ manufacturer = [string]$board.Manufacturer; product = [string]$board.Product; version = [string]$board.Version; bios = [string]$bios.SMBIOSBIOSVersion; biosDate = $biosDate }
  } catch { }
  try {
    $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
    $specs.cpu = @{ name = ([string]$cpu.Name).Trim(); cores = [int]$cpu.NumberOfCores; threads = [int]$cpu.NumberOfLogicalProcessors; maxMHz = [int]$cpu.MaxClockSpeed; socket = [string]$cpu.SocketDesignation; l2KB = [int]$cpu.L2CacheSize; l3KB = [int]$cpu.L3CacheSize }
  } catch { }
  try {
    $modules = New-Object System.Collections.ArrayList
    foreach ($m in (Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop)) {
      $typeCode = [int]$m.SMBIOSMemoryType
      if ($typeCode -eq 0) { $typeCode = [int]$m.MemoryType }
      [void]$modules.Add(@{
        slot            = [string]$m.DeviceLocator
        bank            = [string]$m.BankLabel
        bytes           = [int64]$m.Capacity
        speed           = [int]$m.Speed
        configuredSpeed = [int]$m.ConfiguredClockSpeed
        typeCode        = $typeCode
        formFactor      = [int]$m.FormFactor
        manufacturer    = ([string]$m.Manufacturer).Trim()
        partNumber      = ([string]$m.PartNumber).Trim()
      })
    }
    $specs.memory.modules = @($modules)
    $array = Get-CimInstance Win32_PhysicalMemoryArray -ErrorAction Stop | Where-Object { $_.Use -eq 3 } | Select-Object -First 1
    if ($array) {
      $maxKB = [int64]$array.MaxCapacity
      if ($array.PSObject.Properties['MaxCapacityEx'] -and $array.MaxCapacityEx) { $maxKB = [int64]$array.MaxCapacityEx }
      $specs.memory.maxBytes = $maxKB * 1024
      $specs.memory.slots = [int]$array.MemoryDevices
    }
  } catch { }
  try {
    $gpus = New-Object System.Collections.ArrayList
    foreach ($g in (Get-CimInstance Win32_VideoController -ErrorAction Stop)) {
      $res = $null
      if ($g.CurrentHorizontalResolution) { $res = "$($g.CurrentHorizontalResolution) x $($g.CurrentVerticalResolution)" }
      [void]$gpus.Add(@{ name = [string]$g.Name; vramBytes = [int64]$g.AdapterRAM; driver = [string]$g.DriverVersion; resolution = $res })
    }
    $specs.gpus = @($gpus)
  } catch { }
  try {
    $systemDisk = $null
    try { $systemDisk = (Get-Partition -DriveLetter ($env:SystemDrive.TrimEnd(':')) -ErrorAction Stop | Select-Object -First 1).DiskNumber } catch { }
    # A disk can carry several lettered partitions; the biggest one names it
    # and the totals add every one up.
    $partitions = @{}
    try {
      foreach ($p in (Get-Partition -ErrorAction Stop | Where-Object { $_.DriveLetter })) {
        $key = "$($p.DiskNumber)"
        if (-not $partitions.ContainsKey($key)) { $partitions[$key] = New-Object System.Collections.ArrayList }
        [void]$partitions[$key].Add(@{ letter = "$($p.DriveLetter):"; size = [int64]$p.Size })
      }
    } catch { }
    $disks = New-Object System.Collections.ArrayList
    foreach ($d in (Get-PhysicalDisk -ErrorAction Stop)) {
      $number = [int]$d.DeviceId
      $letter = $null
      $total = 0; $free = $null
      $parts = $partitions["$number"]
      if ($parts) {
        $ordered = @($parts | Sort-Object { $_.size } -Descending)
        $letter = ($ordered | ForEach-Object { $_.letter }) -join ' '
        foreach ($part in $ordered) {
          try {
            $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($part.letter)'" -ErrorAction Stop
            $total += [int64]$drive.Size
            if ($null -eq $free) { $free = [int64]0 }
            $free += [int64]$drive.FreeSpace
          } catch { }
        }
      }
      [void]$disks.Add(@{ name = [string]$d.FriendlyName; mediaType = [string]$d.MediaType; bus = [string]$d.BusType; bytes = [int64]$d.Size; health = [string]$d.HealthStatus; system = ($null -ne $systemDisk -and $number -eq $systemDisk); letter = $letter; totalBytes = $total; freeBytes = $free })
    }
    $specs.disks = @($disks)
  } catch { }
  try {
    $nics = New-Object System.Collections.ArrayList
    foreach ($n in (Get-CimInstance Win32_NetworkAdapter -Filter 'PhysicalAdapter=True' -ErrorAction Stop)) {
      if ($n.Name -match 'Wintun|TAP-Windows|OpenVPN|PdaNet|Hyper-V|VMware|VirtualBox|Bluetooth Device \(Personal') { continue }
      $speed = $null
      if ($n.Speed -and [int64]$n.Speed -lt 1000000000000) { $speed = [int64]$n.Speed }
      [void]$nics.Add(@{ name = [string]$n.Name; speedBps = $speed; up = [bool]$n.NetEnabled })
    }
    $specs.network = @($nics)
  } catch { }
  try {
    $monitors = New-Object System.Collections.ArrayList
    foreach ($mon in (Get-CimInstance Win32_DesktopMonitor -ErrorAction Stop)) {
      if (-not $mon.ScreenWidth) { continue }
      [void]$monitors.Add(@{ name = [string]$mon.Name; width = [int]$mon.ScreenWidth; height = [int]$mon.ScreenHeight })
    }
    $specs.monitors = @($monitors)
  } catch { }
  $script:specsCache = $specs
  $specs
}


while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  $id = ''
  try {
    $request = $line | ConvertFrom-Json
    $id = $request.id

    switch ($request.op) {
      'snapshot' {
        Send @{ id = $id; ok = $true; data = (Get-Snapshot) }
      }
      'commandLines' {
        Send @{ id = $id; ok = $true; data = (Get-CommandLines @($request.names)) }
      }
      'defender' {
        Send @{ id = $id; ok = $true; data = (Get-DefenderInfo) }
      }
      'lockers' {
        Send @{ id = $id; ok = $true; data = (Get-Lockers @($request.paths)) }
      }
      'cpu' {
        Send @{ id = $id; ok = $true; data = (Get-CpuInfo) }
      }
      'cpuLive' {
        Send @{ id = $id; ok = $true; data = (Get-CpuLive) }
      }
      'specs' {
        Send @{ id = $id; ok = $true; data = (Get-SystemSpecs) }
      }
      'powerValues' {
        $values = @{}
        foreach ($key in $PROC_SETTINGS.Keys) { $values[$key] = Get-PowerValue $request.scheme $PROC_SETTINGS[$key] }
        Send @{ id = $id; ok = $true; data = $values }
      }
      'startup' {
        Send @{ id = $id; ok = $true; data = (Get-StartupEntries) }
      }
      'startupToggle' {
        Send @{ id = $id; ok = $true; data = (Set-StartupEnabled $request.source $request.name ([bool]$request.enabled)) }
      }
      'programs' {
        Send @{ id = $id; ok = $true; data = (Get-Programs) }
      }
      'run' {
        $timeout = if ($request.timeoutSeconds) { [int]$request.timeoutSeconds } else { 600 }
        Send @{ id = $id; ok = $true; data = (Invoke-Program $request.file $request.arguments $timeout) }
      }
      'removeAppx' {
        Remove-AppxPackage -Package $request.package -ErrorAction Stop
        Send @{ id = $id; ok = $true; data = @{ package = $request.package } }
      }
      'removeUninstallKey' {
        # Only the per-user hive; machine-wide keys go through the elevated path.
        if ($request.keyPath -notmatch '^HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\]+$') {
          throw "refusing to remove '$($request.keyPath)'"
        }
        Remove-Item -Path ("Registry::" + $request.keyPath) -Recurse -ErrorAction Stop
        Send @{ id = $id; ok = $true; data = @{ keyPath = $request.keyPath } }
      }
      'recycleBin' {
        Send @{ id = $id; ok = $true; data = (Get-RecycleBin) }
      }
      'emptyRecycleBin' {
        $before = Get-RecycleBin
        # Throws when the bin is already empty, which is not a failure.
        try { Clear-RecycleBin -Force -ErrorAction Stop } catch { }
        Send @{ id = $id; ok = $true; data = @{ items = $before.items; bytes = $before.bytes; after = (Get-RecycleBin) } }
      }
      'kill' {
        $target = Get-Process -Id $request.pid -ErrorAction Stop
        if ($protected -contains $target.ProcessName.ToLowerInvariant()) {
          throw "$($target.ProcessName) is a protected system process"
        }
        Stop-Process -Id $request.pid -Force -ErrorAction Stop
        Send @{ id = $id; ok = $true; data = @{ pid = $request.pid } }
      }
      'priority' {
        $target = Get-Process -Id $request.pid -ErrorAction Stop
        $target.PriorityClass = [System.Diagnostics.ProcessPriorityClass]$request.priority
        Send @{ id = $id; ok = $true; data = @{ pid = $request.pid; priority = [string]$target.PriorityClass } }
      }
      default {
        throw "unknown op '$($request.op)'"
      }
    }
  } catch {
    Send @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
}
