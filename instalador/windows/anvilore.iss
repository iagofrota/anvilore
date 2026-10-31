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
Name: "{autoprograms}\Anvilore\Anvilore"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -Command ""$ErrorActionPreference = 'Stop'; $env:ANVILORE_PASTA = Get-Content -Raw -Encoding UTF8 -LiteralPath '.\pasta.txt'; $env:ANVILORE_LANCADOR = (Resolve-Path -LiteralPath '.\abrir.ps1').Path; Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_LANCADOR | Invoke-Expression"""; WorkingDir: "{app}"; IconFilename: "{app}\anvilore.ico"
Name: "{autodesktop}\Anvilore"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -Command ""$ErrorActionPreference = 'Stop'; $env:ANVILORE_PASTA = Get-Content -Raw -Encoding UTF8 -LiteralPath '.\pasta.txt'; $env:ANVILORE_LANCADOR = (Resolve-Path -LiteralPath '.\abrir.ps1').Path; Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_LANCADOR | Invoke-Expression"""; WorkingDir: "{app}"; IconFilename: "{app}\anvilore.ico"

[UninstallDelete]
Type: files; Name: "{app}\pasta.txt"

[Code]
var
  ResultadoSetup: Integer;

function GetCustomSetupExitCode: Integer;
begin
  // Uma exceção em ssPostInstall mostra o erro, mas o Inno ainda pode terminar com 0.
  Result := ResultadoSetup;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Params: String;
  ExitCode: Integer;
  Show: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ResultadoSetup := 4;
    // O valor inicial e o catch impedem exit $null (sucesso) se a leitura ou o parse falhar.
    // Sem escolha explícita, recupera o destino anterior como dados UTF-8 antes de executar o instalador.
    Params := '-NoLogo -NoProfile -Command "$ErrorActionPreference=''Stop''; $global:LASTEXITCODE=1; $env:ANVILORE_ESPERAR_ENTER=''1''; $env:ANVILORE_ATALHO_SETUP=''1''; $env:ANVILORE_CONFIG_SETUP=Join-Path (Get-Location).Path ''pasta.txt''; try { if (-not $env:ANVILORE_PASTA -and (Test-Path -LiteralPath $env:ANVILORE_CONFIG_SETUP)) { $env:ANVILORE_PASTA = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_CONFIG_SETUP -ErrorAction Stop }; Get-Content -Raw -Encoding UTF8 -LiteralPath ''.\instalar.ps1'' -ErrorAction Stop | Invoke-Expression -ErrorAction Stop; exit $LASTEXITCODE } catch { Write-Host $_; exit 1 }"';
    if WizardSilent then
    begin
      Params := '-NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference=''Stop''; $global:LASTEXITCODE=1; $env:ANVILORE_SEM_PERGUNTAS=''1''; $env:ANVILORE_ESPERAR_ENTER=''0''; $env:ANVILORE_ATALHO_SETUP=''1''; $env:ANVILORE_CONFIG_SETUP=Join-Path (Get-Location).Path ''pasta.txt''; try { if (-not $env:ANVILORE_PASTA -and (Test-Path -LiteralPath $env:ANVILORE_CONFIG_SETUP)) { $env:ANVILORE_PASTA = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_CONFIG_SETUP -ErrorAction Stop }; Get-Content -Raw -Encoding UTF8 -LiteralPath ''.\instalar.ps1'' -ErrorAction Stop | Invoke-Expression -ErrorAction Stop; exit $LASTEXITCODE } catch { Write-Host $_; exit 1 }"';
      Show := SW_HIDE;
    end
    else
      Show := SW_SHOW;

    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params,
      ExpandConstant('{app}'), Show, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Não foi possível abrir o instalador do Anvilore.');

    if (ExitCode <> 0) and (ExitCode <> 10) then
      RaiseException(Format('A instalação do Anvilore falhou (código %d).', [ExitCode]));

    ResultadoSetup := 0;
  end;
end;
