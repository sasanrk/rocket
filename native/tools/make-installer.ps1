# Rocket-Setup-<version>.exe in native\dist: publish the single-file exe, then wrap it with Inno Setup.
#   powershell -ExecutionPolicy Bypass -File native\tools\make-installer.ps1
# Needs Inno Setup 6 once:  winget install --id JRSoftware.InnoSetup -e --scope user
#
# Publishes into dist\stage, so a copy of Rocket running from dist does not block a build.

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$proj = Join-Path $root "Rocket\Rocket.csproj"
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "stage"

# The SDK lives in the per-user dotnet; the machine-wide one only has runtimes.
$dotnet = @("$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe", "dotnet") | Where-Object { $_ -eq "dotnet" -or (Test-Path $_) } | Select-Object -First 1

$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 not found. winget install --id JRSoftware.InnoSetup -e --scope user" }

$version = ([xml](Get-Content $proj)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if (-not $version) { throw "No <Version> in $proj" }

# Framework-dependent: .NET 9 Desktop is already on the machine, and the exe stays under 1 MB.
& $dotnet publish $proj -c Release -r win-x64 -o $stage --self-contained false `
    -p:PublishSingleFile=true -p:DebugType=none -nologo
if ($LASTEXITCODE -ne 0) { throw "publish failed" }

& $iscc /Q "/DAppVersion=$version" "/DSourceExe=$stage\Rocket.exe" "/DOutDir=$dist" `
    (Join-Path $PSScriptRoot "installer\Rocket.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }

Get-Item (Join-Path $dist "Rocket-Setup-$version.exe") | ForEach-Object {
    "{0}  {1:N2} MB" -f $_.FullName, ($_.Length / 1MB)
}
