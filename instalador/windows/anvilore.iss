#define NomeProduto "Anvilore"
#ifndef Versao
  #define Versao "0.3.0-dev"
#endif
#ifndef InstallerPs1
  #define InstallerPs1 "..\instalar.ps1"
#endif

[Setup]
AppId={{A8A669A9-B495-4B92-9D54-8770526AFA2A}
AppName={#NomeProduto}
AppVersion={#Versao}
AppPublisher=Anvilore
DefaultDirName={localappdata}\Programs\Anvilore
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\anvilore.ico
OutputBaseFilename=AnviloreSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=anvilore.ico
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "{#InstallerPs1}"; DestDir: "{app}"; DestName: "instalar.ps1"; Flags: ignoreversion
Source: "..\abrir.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "anvilore.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Anvilore\Anvilore"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -Command ""$env:ANVILORE_PASTA = Join-Path $env:USERPROFILE 'Anvilore'; $env:ANVILORE_LANCADOR = Join-Path $env:LOCALAPPDATA 'Programs\Anvilore\abrir.ps1'; Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_LANCADOR | Invoke-Expression"""; WorkingDir: "{app}"; IconFilename: "{app}\anvilore.ico"
Name: "{autodesktop}\Anvilore"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -Command ""$env:ANVILORE_PASTA = Join-Path $env:USERPROFILE 'Anvilore'; $env:ANVILORE_LANCADOR = Join-Path $env:LOCALAPPDATA 'Programs\Anvilore\abrir.ps1'; Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_LANCADOR | Invoke-Expression"""; WorkingDir: "{app}"; IconFilename: "{app}\anvilore.ico"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  Params: String;
  ExitCode: Integer;
  Show: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    Params := '-NoLogo -NoProfile -Command "$env:ANVILORE_ATALHO_SETUP=''1''; Get-Content -Raw -Encoding UTF8 -LiteralPath ''.\instalar.ps1'' | Invoke-Expression; exit $LASTEXITCODE"';
    if WizardSilent then
    begin
      Params := '-NoLogo -NoProfile -Command "$env:ANVILORE_SEM_PERGUNTAS=''1''; $env:ANVILORE_ATALHO_SETUP=''1''; Get-Content -Raw -Encoding UTF8 -LiteralPath ''.\instalar.ps1'' | Invoke-Expression; exit $LASTEXITCODE"';
      Show := SW_HIDE;
    end
    else
      Show := SW_SHOW;

    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params,
      ExpandConstant('{app}'), Show, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Não foi possível abrir o instalador do Anvilore.');

    if (ExitCode <> 0) and (ExitCode <> 10) then
      RaiseException(Format('A instalação do Anvilore falhou (código %d).', [ExitCode]));
  end;
end;
