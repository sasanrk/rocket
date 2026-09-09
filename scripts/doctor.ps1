# Reclaim doctor — why this machine feels slow right now.
#
# Reads only; it changes nothing. Every fix it suggests is printed as a command
# for you to review and run yourself.

$ErrorActionPreference = 'Continue'
$cores = [Environment]::ProcessorCount

function Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Good($text) { Write-Host "  + $text" -ForegroundColor Green }
function Info($text) { Write-Host "  . $text" -ForegroundColor Gray }

Section 'Machine'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$totalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
$usedPct = [math]::Round(100 * (1 - $freeGB / $totalGB))
Info "$($cs.Manufacturer) $($cs.Model)"
Info "$($cpu.Name.Trim()) - $($cpu.NumberOfCores)C/$($cpu.NumberOfLogicalProcessors)T"
Info "RAM $freeGB GB free of $totalGB GB ($usedPct% used)"
Info "Up $([math]::Round(((Get-Date) - $os.LastBootUpTime).TotalMinutes)) minutes"
if ($usedPct -gt 85) { Warn "Memory is $usedPct% full - this is the state where everything feels slow at once" }

Section 'Drives'
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  $pct = [math]::Round(100 * $_.FreeSpace / $_.Size, 1)
  $line = "{0} {1,7:N1} GB free of {2,7:N1} GB ({3}% free)" -f $_.DeviceID, ($_.FreeSpace / 1GB), ($_.Size / 1GB), $pct
  if ($pct -lt 10) { Warn $line } else { Info $line }
}

Section 'Busiest processes'
$before = @{}
Get-Process | ForEach-Object { $before[$_.Id] = $_.TotalProcessorTime.TotalMilliseconds }
$t1 = [DateTime]::UtcNow
Start-Sleep -Seconds 4
$span = ([DateTime]::UtcNow - $t1).TotalMilliseconds
Get-Process | ForEach-Object {
  if (-not $before.ContainsKey($_.Id)) { return }
  [pscustomobject]@{
    Name = $_.ProcessName
    Id = $_.Id
    CPU = [math]::Round(100 * ($_.TotalProcessorTime.TotalMilliseconds - $before[$_.Id]) / ($span * $cores), 1)
    MemMB = [math]::Round($_.WorkingSet64 / 1MB)
  }
} | Sort-Object CPU -Descending | Select-Object -First 8 | Format-Table -AutoSize | Out-String | Write-Host

Section 'Paging and disk pressure'
try {
  $hard = (Get-Counter '\Memory\Pages Input/sec' -ErrorAction Stop).CounterSamples[0].CookedValue
  $busy = (Get-Counter '\PhysicalDisk(_Total)\% Disk Time' -ErrorAction Stop).CounterSamples[0].CookedValue
  $queue = (Get-Counter '\PhysicalDisk(_Total)\Current Disk Queue Length' -ErrorAction Stop).CounterSamples[0].CookedValue
  Info ("Hard faults {0:N0}/s   disk busy {1:N0}%   queue {2:N1}" -f $hard, $busy, $queue)
  if ($hard -gt 2000) { Warn 'A lot of hard page faults - the machine is reading code and data off disk, not RAM' }
  if ($busy -gt 80) { Warn 'The disk is saturated; everything waiting on it will feel slow' }
} catch {
  Info 'Performance counters unavailable'
}

Section 'Antivirus'
$engine = Get-Process MsMpEng -ErrorAction SilentlyContinue | Select-Object -First 1
if ($engine) {
  $c1 = $engine.TotalProcessorTime.TotalMilliseconds
  Start-Sleep -Seconds 3
  $engine.Refresh()
  $avCpu = [math]::Round(100 * ($engine.TotalProcessorTime.TotalMilliseconds - $c1) / (3000 * $cores), 1)
  Info ("MsMpEng: {0}% CPU, {1:N0} MB" -f $avCpu, ($engine.WorkingSet64 / 1MB))
  if ($avCpu -gt 15) {
    Warn 'Defender is busy. It reads almost nothing itself - it is inspecting what other programs write.'
  }
}

try {
  $pref = Get-MpPreference -ErrorAction Stop
  $status = Get-MpComputerStatus -ErrorAction Stop
  Info "Real-time protection: $($status.RealTimeProtectionEnabled)   scan running: $($status.QuickScanInProgress -or $status.FullScanInProgress)"
  Info "Scheduled scan CPU cap: $($pref.ScanAvgCPULoadFactor)%   only when idle: $($pref.ScanOnlyIfIdleEnabled)"
  if (-not $pref.DisableCatchupQuickScan) {
    Warn 'A scan missed while the machine was off will rerun at next boot - fix: Set-MpPreference -DisableCatchupQuickScan $true'
  }

  # The folders developer tooling writes to constantly.
  function Join-Under([string]$base, [string[]]$parts) {
    if ([string]::IsNullOrEmpty($base)) { return $null }
    $p = $base
    foreach ($part in $parts) { $p = [System.IO.Path]::Combine($p, $part) }
    $p
  }
  $candidates = @(
    (Join-Under $env:LOCALAPPDATA @('Temp')),
    (Join-Under $env:APPDATA      @('npm-cache')),
    (Join-Under $env:LOCALAPPDATA @('npm-cache')),
    (Join-Under $env:USERPROFILE  @('.npm')),
    (Join-Under $env:LOCALAPPDATA @('Yarn', 'Cache')),
    (Join-Under $env:LOCALAPPDATA @('pnpm')),
    (Join-Under $env:USERPROFILE  @('.gradle')),
    (Join-Under $env:USERPROFILE  @('.m2')),
    (Join-Under $env:USERPROFILE  @('.cargo')),
    (Join-Under $env:APPDATA      @('Docker')),
    (Join-Under $env:LOCALAPPDATA @('Docker')),
    (Join-Under $env:USERPROFILE  @('.vscode', 'extensions'))
  ) | Where-Object { $_ -and [System.IO.Directory]::Exists($_) }

  $exclusions = @($pref.ExclusionPath | Where-Object { $_ })
  $exposed = @()
  foreach ($path in $candidates) {
    $covered = $false
    foreach ($e in $exclusions) {
      $parent = $e.TrimEnd('\', '/').ToLower()
      if ($path.ToLower() -eq $parent -or $path.ToLower().StartsWith($parent + [System.IO.Path]::DirectorySeparatorChar)) { $covered = $true }
    }
    if (-not $covered) { $exposed += $path }
  }

  if ($exposed.Count -eq 0) {
    Good 'Every build cache found is already excluded from real-time scanning'
  } else {
    Warn "$($exposed.Count) folder(s) your tooling writes to constantly are scanned on every write:"
    $exposed | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkYellow }
    Write-Host ""
    Write-Host "  Review, then run in an ADMIN PowerShell if you agree:" -ForegroundColor Gray
    $exposed | ForEach-Object { Write-Host "      Add-MpPreference -ExclusionPath '$_'" -ForegroundColor White }
  }

  if (@($pref.ExclusionProcess | Where-Object { $_ }).Count -eq 0) {
    Info 'No process exclusions set. Optionally also spare the tools themselves:'
    'node.exe', 'npm.exe', 'Code.exe', 'java.exe', 'git.exe' | ForEach-Object {
      Write-Host "      Add-MpPreference -ExclusionProcess '$_'" -ForegroundColor White
    }
  }
} catch {
  Info "Defender settings unreadable: $($_.Exception.Message)"
}

Section 'Startup load'
$enabled = 0
foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run') {
  if (-not (Test-Path $k)) { continue }
  $approved = if ($k -like 'HKLM*') {
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
  } else {
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
  }
  (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
    $state = 'enabled'
    try {
      $v = (Get-ItemProperty -Path $approved -Name $_.Name -ErrorAction Stop).($_.Name)
      if ($v -is [byte[]] -and $v.Length -gt 0 -and ($v[0] -band 1)) { $state = 'disabled' }
    } catch { }
    if ($state -eq 'enabled') { $enabled++ ; Info "enabled  $($_.Name)" }
  }
}
Info "$enabled Run entries start with Windows"
if ($enabled -gt 8) { Warn 'That is a lot to load at once on a four-core machine; disable what you do not need in Task Manager > Startup' }

Write-Host ""
Write-Host "Done. Nothing was changed." -ForegroundColor Cyan
