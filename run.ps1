# A menu, so none of this has to be remembered.
#
#   powershell -ExecutionPolicy Bypass -File run.ps1
# or double-click run.bat

$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

$actions = @(
  @{ key = '1'; name = 'Run the app';                 cmd = { npm start } },
  @{ key = '2'; name = 'Run the app on D:\Dev';       cmd = { npm start -- --scan D:\Dev } },
  @{ key = '3'; name = 'Browser preview only';        cmd = { npm run dev } },
  @{ key = '4'; name = 'Build the installer';         cmd = { npm run dist } },
  @{ key = '5'; name = 'Check everything';            cmd = { npm run check } },
  @{ key = '6'; name = 'Self-test';                   cmd = { npm run selftest } },
  @{ key = '7'; name = 'Diagnose this machine';       cmd = { npm run doctor } },
  @{ key = '8'; name = 'Stop everything';             cmd = { npm run stop } },
  @{ key = '9'; name = 'Install dependencies';        cmd = { npm install } }
)

while ($true) {
  Write-Host ""
  Write-Host "  Reclaim" -ForegroundColor Green
  Write-Host "  $($PSScriptRoot)" -ForegroundColor DarkGray
  Write-Host ""
  foreach ($a in $actions) {
    Write-Host ("   {0}) {1}" -f $a.key, $a.name)
  }
  Write-Host "   q) Quit"
  Write-Host ""

  $choice = Read-Host "  Choose"
  if ($choice -eq 'q') { break }

  $action = $actions | Where-Object { $_.key -eq $choice } | Select-Object -First 1
  if (-not $action) { Write-Host "  no such option" -ForegroundColor Yellow; continue }

  Write-Host ""
  Write-Host "  > $($action.name)" -ForegroundColor Cyan
  Write-Host ""
  & $action.cmd

  Write-Host ""
  Write-Host "  finished with exit code $LASTEXITCODE" -ForegroundColor DarkGray
  Read-Host "  press Enter for the menu" | Out-Null
}
