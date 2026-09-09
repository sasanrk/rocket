# Stops anything Reclaim left running: the packaged app, a dev Electron window,
# and the Vite server that holds port 5173.

$stopped = 0

Get-Process Reclaim -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "stopping Reclaim (pid $($_.Id))"
  $_ | Stop-Process -Force
  $stopped++
}

# Only the Electron belonging to this project, not some other app's.
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*reclaim*' } |
  ForEach-Object {
    Write-Host "stopping electron (pid $($_.ProcessId))"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
  }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*vite*' -and $_.CommandLine -like '*reclaim*' } |
  ForEach-Object {
    Write-Host "stopping vite (pid $($_.ProcessId))"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
  }

if ($stopped -eq 0) { Write-Host "nothing was running" } else { Write-Host "stopped $stopped process(es)" }
