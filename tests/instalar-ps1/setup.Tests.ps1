# Runtime do contrato Inno/PowerShell, sem rede nem dados pessoais; Windows PowerShell 5.1 no CI descartável.
BeforeDiscovery { $script:WindowsSetup = $env:OS -eq 'Windows_NT' }
Describe 'AnviloreSetup: resultados e pausa' -Skip:(-not $script:WindowsSetup) {
  BeforeAll {
    $script:RaizSetup = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:IssSetup = Join-Path $script:RaizSetup 'instalador\windows\anvilore.iss'
    $script:BaseSetup = Join-Path $env:TEMP ('setup testes ' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:BaseSetup -Force | Out-Null
    $script:IsccSetup = (Get-ChildItem 'C:\Program Files*\Inno Setup*\ISCC.exe' | Select-Object -First 1).FullName
    if (-not $script:IsccSetup) { throw 'ISCC ausente' }
    $script:ModeloSetup = Join-Path $script:BaseSetup 'fixture.ps1'
    Set-Content -LiteralPath $script:ModeloSetup -Encoding UTF8 -Value '$global:LASTEXITCODE = [int]$env:ANVILORE_TEST_CODIGO'
    $script:BuildSetup = Join-Path $script:BaseSetup 'build'
    & $script:IsccSetup "/DInstallerPs1=$script:ModeloSetup" /DVersao=0.0.1 "/O$script:BuildSetup" $script:IssSetup | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'ISCC falhou' }
    $script:ExeSetup = Join-Path $script:BuildSetup 'AnviloreSetup.exe'
    $script:AppSetup = Join-Path $script:BaseSetup 'app'
    $script:CodigoAntesSetup = $env:ANVILORE_TEST_CODIGO
    function script:RemoverSetup {
      $exe = Get-ChildItem -LiteralPath $script:AppSetup -Filter 'unins*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($exe) { Start-Process $exe.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait | Out-Null }
    }
    function script:ExecutarSetup {
      $p = Start-Process $script:ExeSetup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/DIR="' + $script:AppSetup + '"') -PassThru
      $null = $p.Handle
      if (-not $p.WaitForExit(20000)) { $p.Kill(); throw 'Setup silencioso bloqueado' }
      $p.WaitForExit()
      Write-Host "SETUP_RESULTADO instalador=$env:ANVILORE_TEST_CODIGO setup=$($p.ExitCode)"
      return $p.ExitCode
    }
    function script:ComandoSetup([bool]$Silencioso) {
      $texto = Get-Content -Raw -Encoding UTF8 -LiteralPath $script:IssSetup
      $opcoes = [regex]::Matches($texto, "Params := '((?:''|[^'])*)';")
      if ($opcoes.Count -ne 2) { throw 'Esperava os comandos interativo e silencioso do Inno' }
      $i = if ($Silencioso) { 1 } else { 0 }
      return $opcoes[$i].Groups[1].Value.Replace("''", "'")
    }
    function script:RodarComandoSetup([string]$Texto, [bool]$Silencioso = $true, [bool]$Ausente = $false, [bool]$Bloqueado = $false, [string]$Registro = '', [string]$Comando = '') {
      $dir = Join-Path $script:BaseSetup ('comando ' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
      $arquivo = Join-Path $dir 'instalar.ps1'
      if (-not $Ausente) { Set-Content -LiteralPath $arquivo -Encoding UTF8 -Value $Texto }
      if ($Registro) { Set-Content -LiteralPath (Join-Path $dir 'pasta.txt') -Encoding UTF8 -NoNewline -Value $Registro }
      $params = if ($Comando) { $Comando } else { ComandoSetup $Silencioso }
      # Mock observável fora do pipeline descartado por [void]. O restante é o comando real do .iss.
      # Protocolo da captura: o filho escreve UTF-8 e o pai lê UTF-8, sem depender de OEM/ANSI do runner.
      $params = $params.Replace('-Command "', '-Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; function global:Read-Host { Write-Host ''PAUSA_OBSERVADA''; return '''' }; ')
      $trava = $null
      try {
        if ($Bloqueado) { $trava = [IO.File]::Open($arquivo, 'Open', 'ReadWrite', 'None') }
        $p = Start-Process powershell.exe -ArgumentList $params -WorkingDirectory $dir -RedirectStandardOutput (Join-Path $dir 'out') -RedirectStandardError (Join-Path $dir 'err') -PassThru -WindowStyle Hidden
        # No Windows PowerShell 5.1, adquirir o handle antes da espera preserva ExitCode.
        $null = $p.Handle
        if (-not $p.WaitForExit(10000)) { $p.Kill(); throw 'Comando bloqueado' }
        $p.WaitForExit()
        return @{ Codigo = $p.ExitCode; Saida = (Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'out')) + (Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'err')) }
      } finally { if ($trava) { $trava.Dispose() } }
    }
  }
  AfterEach { RemoverSetup }
  AfterAll {
    $env:ANVILORE_TEST_CODIGO = $script:CodigoAntesSetup
    Remove-Item -LiteralPath $script:BaseSetup -Recurse -Force -ErrorAction SilentlyContinue
  }
  It 'Dado stdout nativo do PowerShell 5.1, Quando confiro bytes e páginas OEM/ANSI, Então a decodificação fiel conserva o acento' {
    $dir = Join-Path $script:BaseSetup 'captura nativa'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    # Controle sem o protocolo UTF-8 do helper: registra a página efetiva antes de emitir U+00ED.
    $params = '-NoLogo -NoProfile -NonInteractive -Command "Set-Content -LiteralPath ''.\cp.txt'' -Encoding UTF8 -Value ([Console]::OutputEncoding.CodePage); Write-Host ([char]0x00ED)"'
    $out = Join-Path $dir 'out'
    $p = Start-Process powershell.exe -ArgumentList $params -WorkingDirectory $dir -RedirectStandardOutput $out -RedirectStandardError (Join-Path $dir 'err') -PassThru -WindowStyle Hidden
    $null = $p.Handle
    if (-not $p.WaitForExit(10000)) { $p.Kill(); throw 'Sonda de captura bloqueada' }
    $p.WaitForExit()
    $p.ExitCode | Should -Be 0
    $cp = [int]((Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'cp.txt')).Trim())
    $bytes = [IO.File]::ReadAllBytes($out)
    $fiel = [Text.Encoding]::GetEncoding($cp).GetString($bytes).Trim()
    # Reproduz a leitura antiga sem Encoding para diagnosticar a diferença, sem alterar a página do sistema.
    $antigo = (Get-Content -Raw -LiteralPath $out).Trim()
    $pontos = ($antigo.ToCharArray() | ForEach-Object { 'U+{0:X4}' -f [int]$_ }) -join ','
    Write-Host "CAPTURA_NATIVA cp_stdout=$cp cp_leitor_ansi=$([Text.Encoding]::Default.CodePage) bytes=$([BitConverter]::ToString($bytes)) leitura_antiga=$pontos"
    $fiel | Should -Be 'í'
  }
  It 'Dado instalador com código <Codigo>, Quando executo o exe silencioso, Então aceito apenas completo ou parcial' -ForEach @(
    @{ Codigo = 0; Esperado = 0 }, @{ Codigo = 10; Esperado = 0 },
    @{ Codigo = 1; Esperado = 4 }, @{ Codigo = 2; Esperado = 4 },
    @{ Codigo = 3; Esperado = 4 }, @{ Codigo = 4; Esperado = 4 }
  ) {
    $env:ANVILORE_TEST_CODIGO = [string]$Codigo
    (ExecutarSetup) | Should -Be $Esperado
  }
  It 'Dado pacote com script <Caso>, Quando executo o exe silencioso, Então a falha pré-execução reprova o setup' -ForEach @(
    @{ Caso = 'inválido'; Ausente = $false }, @{ Caso = 'ausente'; Ausente = $true }
  ) {
    $fixture = Join-Path $script:BaseSetup ('pacote ' + $Caso)
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    $modelo = Join-Path $fixture 'instalar.ps1'
    Set-Content -LiteralPath $modelo -Encoding UTF8 -Value 'function {'
    $iss = Get-Content -Raw -Encoding UTF8 -LiteralPath $script:IssSetup
    $iss = $iss.Replace('"..\abrir.ps1"', ('"' + (Join-Path $script:RaizSetup 'instalador\abrir.ps1') + '"'))
    $icone = Join-Path $script:RaizSetup 'instalador\windows\anvilore.ico'
    $iss = $iss.Replace('Source: "anvilore.ico"', ('Source: "' + $icone + '"')).Replace('SetupIconFile=anvilore.ico', ('SetupIconFile=' + $icone))
    if ($Ausente) { $iss = $iss.Replace('DestName: "instalar.ps1"', 'DestName: "ausente.ps1"') }
    $arquivo = Join-Path $fixture 'fixture.iss'
    Set-Content -LiteralPath $arquivo -Encoding UTF8 -Value $iss
    & $script:IsccSetup "/DInstallerPs1=$modelo" /DVersao=0.0.1 "/O$fixture" $arquivo | Out-Null
    $LASTEXITCODE | Should -Be 0
    $exeAntes = $script:ExeSetup
    try {
      $script:ExeSetup = Join-Path $fixture 'AnviloreSetup.exe'
      (ExecutarSetup) | Should -Be 4
    } finally { $script:ExeSetup = $exeAntes }
  }
  It 'Dado script <Caso>, Quando falha antes de definir LASTEXITCODE, Então o comando real sai diferente de zero' -ForEach @(
    @{ Caso = 'ausente'; Texto = ''; Ausente = $true; Bloqueado = $false },
    @{ Caso = 'ilegível por lock'; Texto = '$global:LASTEXITCODE = 0'; Ausente = $false; Bloqueado = $true },
    @{ Caso = 'sintaxe inválida'; Texto = 'function {'; Ausente = $false; Bloqueado = $false },
    @{ Caso = 'cmdlet falha'; Texto = "Get-Content -LiteralPath '.\nao-existe'"; Ausente = $false; Bloqueado = $false }
  ) {
    $r = RodarComandoSetup $Texto $true $Ausente $Bloqueado
    Write-Host "PRE_EXECUCAO caso=$Caso codigo=$($r.Codigo)"
    $r.Codigo | Should -Be 1 -Because $r.Saida
  }
  It 'Dado modo interativo, Quando o instalador termina, Então recebe a opção de esperar Enter e a pausa é observável' {
    $r = RodarComandoSetup 'if ($env:ANVILORE_ESPERAR_ENTER -eq "1" -and $env:ANVILORE_SEM_PERGUNTAS -ne "1") { [void](Read-Host "resumo") }; $global:LASTEXITCODE = 0' $false
    $r.Codigo | Should -Be 0
    $r.Saida | Should -Match 'PAUSA_OBSERVADA'
  }
  It 'Dado modo silencioso com esperar Enter herdado, Quando termina, Então desliga a pausa e não bloqueia' {
    $antes = $env:ANVILORE_ESPERAR_ENTER
    try {
      $env:ANVILORE_ESPERAR_ENTER = '1'
      $r = RodarComandoSetup 'if ($env:ANVILORE_ESPERAR_ENTER -eq "1" -and $env:ANVILORE_SEM_PERGUNTAS -ne "1") { [void](Read-Host "resumo") }; $global:LASTEXITCODE = 0'
      $r.Codigo | Should -Be 0
      $r.Saida | Should -Not -Match 'PAUSA_OBSERVADA'
    } finally { $env:ANVILORE_ESPERAR_ENTER = $antes }
  }
  It 'Dado destino registrado com aspas e expressão, Quando o comando <Modo> o recupera, Então recebe o texto exato como dados' -ForEach @(
    @{ Modo = 'GUI'; Silencioso = $false }, @{ Modo = 'silent'; Silencioso = $true }
  ) {
    $antes = $env:ANVILORE_PASTA
    # Se avaliado, este valor lança erro; se interpolado como fonte, o apóstrofo quebra a execução.
    $registro = 'C:\a wiki da Lia''s $(throw "REGISTRO_EXECUTADO")'
    try {
      $env:ANVILORE_PASTA = $null
      $r = RodarComandoSetup -Texto 'Write-Host ("DESTINO=" + $env:ANVILORE_PASTA); $global:LASTEXITCODE=0' -Silencioso $Silencioso -Registro $registro
      $r.Codigo | Should -Be 0 -Because $r.Saida
      $r.Saida.Trim() | Should -Be ('DESTINO=' + $registro)
    } finally { $env:ANVILORE_PASTA = $antes }
  }
  It 'Dado mutação que ignora escolha explícita no comando <Modo>, Quando confiro a prioridade em PowerShell real, Então o oráculo a rejeita' -ForEach @(
    @{ Modo = 'GUI'; Silencioso = $false }, @{ Modo = 'silent'; Silencioso = $true }
  ) {
    $antes = $env:ANVILORE_PASTA
    $texto = 'Write-Host ("DESTINO=" + $env:ANVILORE_PASTA); $global:LASTEXITCODE=0'
    try {
      $env:ANVILORE_PASTA = 'C:\escolha explícita da Lia''s'
      $r = RodarComandoSetup -Texto $texto -Silencioso $Silencioso -Registro 'C:\registro anterior'
      $r.Codigo | Should -Be 0 -Because $r.Saida
      $esperado = 'DESTINO=' + $env:ANVILORE_PASTA
      $r.Saida.Trim() | Should -Be $esperado
      # Muda apenas o texto transitório: o .iss versionado permanece intacto.
      $original = ComandoSetup $Silencioso
      $mutante = $original.Replace('-not $env:ANVILORE_PASTA -and ', '')
      $mutante | Should -Not -Be $original
      $r = RodarComandoSetup -Texto $texto -Silencioso $Silencioso -Registro 'C:\registro anterior' -Comando $mutante
      $r.Codigo | Should -Be 0 -Because $r.Saida
      $r.Saida.Trim() | Should -Be 'DESTINO=C:\registro anterior'
      { $r.Saida.Trim() | Should -Be $esperado } | Should -Throw
      Write-Host "MUTACAO_REJEITADA modo=$Modo regra=explicito_antes_de_registro"
    } finally { $env:ANVILORE_PASTA = $antes }
  }
}
