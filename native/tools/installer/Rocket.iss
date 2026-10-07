; Rocket setup: per-user, no admin prompt. Built by native\tools\make-installer.ps1.
;   ISCC /DAppVersion=2.0.0 /DSourceExe=...\Rocket.exe /DOutDir=...\dist Rocket.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceExe
  #define SourceExe "..\..\dist\stage\Rocket.exe"
#endif
#ifndef OutDir
  #define OutDir "..\..\dist"
#endif

[Setup]
AppId={{B3E1C7A4-5D2F-4E8B-9A61-7C0F3D2E8B15}
AppName=Rocket
AppVersion={#AppVersion}
AppVerName=Rocket {#AppVersion}
AppPublisher=Rocket
AppComments=Free the space your tools and AI models left behind.
VersionInfoVersion={#AppVersion}

; {autopf} is %LOCALAPPDATA%\Programs when installing for the current user.
PrivilegesRequired=lowest
DefaultDirName={autopf}\Rocket
DisableProgramGroupPage=yes
DisableDirPage=auto
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
CloseApplications=yes

SetupIconFile=..\..\Rocket\Assets\rocket.ico
UninstallDisplayIcon={app}\Rocket.exe
UninstallDisplayName=Rocket
WizardStyle=modern

OutputDir={#OutDir}
OutputBaseFilename=Rocket-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Rocket"; Filename: "{app}\Rocket.exe"
Name: "{autodesktop}\Rocket"; Filename: "{app}\Rocket.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Rocket.exe"; Description: "{cm:LaunchProgram,Rocket}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im Rocket.exe"; Flags: runhidden; RunOnceId: "StopRocket"

; Settings and history (%LOCALAPPDATA%\Rocket) are kept.

[Code]
// Rocket is framework-dependent (a few hundred KB instead of 70 MB): it needs the
// .NET 9 Desktop Runtime, which is checked for here rather than bundled.
function HasDesktopRuntime(Root: String): Boolean;
var
  F: TFindRec;
begin
  Result := FindFirst(Root + '\shared\Microsoft.WindowsDesktop.App\9.*', F);
  if Result then FindClose(F);
end;

function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
begin
  Result := True;
  if not (HasDesktopRuntime(ExpandConstant('{commonpf64}\dotnet'))
       or HasDesktopRuntime(ExpandConstant('{localappdata}\Microsoft\dotnet'))) then
  begin
    if MsgBox('Rocket needs the .NET 9 Desktop Runtime, which is not installed.' + #13#10 +
              'Open the download page now?', mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://dotnet.microsoft.com/download/dotnet/9.0', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
    Result := False;
  end;
end;
