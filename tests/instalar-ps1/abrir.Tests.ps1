# Provas em Windows PowerShell 5.1 do lançador do pacote e da atualização silenciosa.
BeforeDiscovery { $script:EhWindowsAbrir = $env:OS -eq 'Windows_NT' }

Describe 'abrir.ps1: atualização automática do pacote' -Skip:(-not $script:EhWindowsAbrir) {
  BeforeAll {
    $script:AbrirRaizTeste = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:AbrirArquivoTeste = Join-Path $script:AbrirRaizTeste 'instalador\abrir.ps1'
    $script:AbrirBaseTeste = Join-Path $env:TEMP ('Anvilore abrir runtime é ' + [guid]::NewGuid().ToString('N'))
    $script:AbrirPastaTeste = Join-Path $script:AbrirBaseTeste "kit da Lia's"
    $script:AbrirPacoteTeste = Join-Path $script:AbrirBaseTeste 'pacote Anvilore'
    $script:AbrirBinTeste = Join-Path $script:AbrirBaseTeste 'bin'
    $script:AbrirLocalTeste = Join-Path $script:AbrirBaseTeste 'AppData\Local'
    $script:AbrirAppDataTeste = Join-Path $script:AbrirBaseTeste 'AppData\Roaming'
    $script:AbrirBunGerenciadoTeste = Join-Path $script:AbrirBaseTeste '.bun\bin'
    $script:AbrirGitGerenciadoTeste = Join-Path $script:AbrirLocalTeste 'Anvilore\git\cmd'
    $script:AbrirConfigSetupTeste = Join-Path $script:AbrirPacoteTeste 'pasta.txt'
    $script:AbrirRecebidaTeste = Join-Path $script:AbrirBaseTeste 'versao recebida.txt'
    $script:AbrirDetalheTeste = Join-Path $script:AbrirBaseTeste 'ambiente recebido.txt'
    $script:AbrirPathAntesTeste = $env:Path
    $script:AbrirPerfilAntesTeste = $env:USERPROFILE
    $script:AbrirLocalAntesTeste = $env:LOCALAPPDATA
    $script:AbrirAppDataAntesTeste = $env:APPDATA
    $script:AbrirPastaAntesTeste = $env:ANVILORE_PASTA
    $script:AbrirLancadorAntesTeste = $env:ANVILORE_LANCADOR
    $script:AbrirVersaoAntesTeste = $env:ANVILORE_VERSAO
    $script:AbrirRecebidaAntesTeste = $env:ANVILORE_TEST_RECEBIDA
    $script:AbrirAtalhoSetupAntesTeste = $env:ANVILORE_ATALHO_SETUP
    $script:AbrirConfigSetupAntesTeste = $env:ANVILORE_CONFIG_SETUP
    $script:AbrirDetalheAntesTeste = $env:ANVILORE_TEST_DETALHE
    $script:AbrirFuncoesAntesTeste = $env:ANVILORE_PS1_SO_FUNCOES

    $script:AbrirInstaladorRealTeste = Join-Path $script:AbrirRaizTeste 'instalador\instalar.ps1'
    $env:ANVILORE_PS1_SO_FUNCOES = '1'
    . ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $script:AbrirInstaladorRealTeste)))

    New-Item -ItemType Directory -Path @(
      (Join-Path $script:AbrirPastaTeste '.git'),
      (Join-Path $script:AbrirPastaTeste 'src'),
      (Join-Path $script:AbrirPastaTeste 'skills'),
      $script:AbrirPacoteTeste,
      $script:AbrirBinTeste,
      $script:AbrirBunGerenciadoTeste,
      $script:AbrirGitGerenciadoTeste,
      $script:AbrirLocalTeste,
      $script:AbrirAppDataTeste
    ) -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $script:AbrirPastaTeste 'AGENTS.md') -Value ''
    Set-Content -LiteralPath (Join-Path $script:AbrirPastaTeste 'src\cli.ts') -Value ''
    $script:AbrirLancadorPacoteTeste = Join-Path $script:AbrirPacoteTeste 'abrir.ps1'
    Copy-Item -LiteralPath $script:AbrirArquivoTeste -Destination $script:AbrirLancadorPacoteTeste
    $script:AbrirInstaladorPacoteTeste = Join-Path $script:AbrirPacoteTeste 'instalar.ps1'
    @'
[IO.File]::WriteAllText($env:ANVILORE_TEST_RECEBIDA, ($env:ANVILORE_VERSAO + '|' + $env:ANVILORE_PASTA + '|' + $env:ANVILORE_SEM_PERGUNTAS))
if ($env:ANVILORE_TEST_DETALHE) {
  $bun = (Get-Command bun -ErrorAction Stop).Source
  $git = (Get-Command git -ErrorAction Stop).Source
  $linhas = @($env:ANVILORE_ATALHO_SETUP, $env:ANVILORE_CONFIG_SETUP, $bun, $git)
  [IO.File]::WriteAllText($env:ANVILORE_TEST_DETALHE, ($linhas -join [Environment]::NewLine))
  $null = AnvCriarAtalho -Pasta $env:ANVILORE_PASTA
}
if ($env:ANVILORE_TEST_FALHA -eq '1') { $global:LASTEXITCODE = 5; return }
$arquivo = Join-Path $env:ANVILORE_PASTA 'package.json'
$pacote = [IO.File]::ReadAllText($arquivo) | ConvertFrom-Json
$pacote.version = $env:ANVILORE_VERSAO
Set-Content -LiteralPath $arquivo -Encoding UTF8 -Value ($pacote | ConvertTo-Json -Depth 5)
$global:LASTEXITCODE = 0
'@ | Set-Content -LiteralPath $script:AbrirInstaladorPacoteTeste -Encoding UTF8
    $script:AbrirBunTeste = Join-Path $script:AbrirBinTeste 'bun.cmd'
    Set-Content -LiteralPath $script:AbrirBunTeste -Encoding ASCII -Value "@echo off`r`nexit /b 7`r`n"

    function script:PrepararAbrirTeste([string]$VersaoPacote = '1.0.0', [string]$VersaoInstalada = '0.9.0') {
      $pkg = Join-Path $script:AbrirPastaTeste 'package.json'
      Set-Content -LiteralPath $pkg -Encoding UTF8 -Value (@{ name = 'anvilore'; version = $VersaoInstalada } | ConvertTo-Json)
      Set-Content -LiteralPath (Join-Path $script:AbrirPacoteTeste 'VERSAO') -Encoding ASCII -Value $VersaoPacote
      Remove-Item -LiteralPath $script:AbrirRecebidaTeste -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $script:AbrirDetalheTeste -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $script:AbrirConfigSetupTeste -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Join-Path $script:AbrirLocalTeste 'Anvilore') -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Path $script:AbrirGitGerenciadoTeste -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $script:AbrirGitGerenciadoTeste 'git.cmd') -Encoding ASCII -Value "@echo off`r`nexit /b 0`r`n"
      Set-Content -LiteralPath (Join-Path $script:AbrirBunGerenciadoTeste 'bun.cmd') -Encoding ASCII -Value "@echo off`r`nexit /b 7`r`n"
      $env:ANVILORE_PASTA = $script:AbrirPastaTeste
      $env:ANVILORE_LANCADOR = $script:AbrirLancadorPacoteTeste
      $env:USERPROFILE = $script:AbrirBaseTeste
      $env:LOCALAPPDATA = $script:AbrirLocalTeste
      $env:APPDATA = $script:AbrirAppDataTeste
      $env:ANVILORE_TEST_RECEBIDA = $script:AbrirRecebidaTeste
      $env:ANVILORE_TEST_FALHA = '0'
      $env:Path = "$script:AbrirBinTeste;$script:AbrirPathAntesTeste"
      $global:LASTEXITCODE = 0
    }

    function script:ExecutarAbrirTeste {
      $consoleAntes = [Console]::OutputEncoding
      $outputAntes = $global:OutputEncoding
      try { $saida = & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $script:AbrirArquivoTeste))) *>&1 | Out-String }
      finally { [Console]::OutputEncoding = $consoleAntes; $global:OutputEncoding = $outputAntes }
      return $saida
    }
  }

  BeforeEach {
    PrepararAbrirTeste
    Mock Read-Host { '' }
  }

  AfterEach {
    $env:Path = $script:AbrirPathAntesTeste
    $env:USERPROFILE = $script:AbrirPerfilAntesTeste
    $env:LOCALAPPDATA = $script:AbrirLocalAntesTeste
    $env:APPDATA = $script:AbrirAppDataAntesTeste
    $env:ANVILORE_PASTA = $script:AbrirPastaAntesTeste
    $env:ANVILORE_LANCADOR = $script:AbrirLancadorAntesTeste
    $env:ANVILORE_VERSAO = $script:AbrirVersaoAntesTeste
    $env:ANVILORE_TEST_RECEBIDA = $script:AbrirRecebidaAntesTeste
    if ($null -eq $script:AbrirAtalhoSetupAntesTeste) { Remove-Item Env:ANVILORE_ATALHO_SETUP -ErrorAction SilentlyContinue }
    else { $env:ANVILORE_ATALHO_SETUP = $script:AbrirAtalhoSetupAntesTeste }
    if ($null -eq $script:AbrirConfigSetupAntesTeste) { Remove-Item Env:ANVILORE_CONFIG_SETUP -ErrorAction SilentlyContinue }
    else { $env:ANVILORE_CONFIG_SETUP = $script:AbrirConfigSetupAntesTeste }
    if ($null -eq $script:AbrirDetalheAntesTeste) { Remove-Item Env:ANVILORE_TEST_DETALHE -ErrorAction SilentlyContinue }
    else { $env:ANVILORE_TEST_DETALHE = $script:AbrirDetalheAntesTeste }
    Remove-Item Env:ANVILORE_TEST_FALHA -ErrorAction SilentlyContinue
  }

  AfterAll {
    Remove-Item -LiteralPath $script:AbrirBaseTeste -Recurse -Force -ErrorAction SilentlyContinue
    if ($null -eq $script:AbrirFuncoesAntesTeste) { Remove-Item Env:ANVILORE_PS1_SO_FUNCOES -ErrorAction SilentlyContinue }
    else { $env:ANVILORE_PS1_SO_FUNCOES = $script:AbrirFuncoesAntesTeste }
  }

  It 'Dado pacote mais novo, Quando abro o atalho, Então chama o instalador sem perguntas com a versão e a pasta atuais' {
    $saida = ExecutarAbrirTeste
    $saida | Should -Match 'A interface do Anvilore fechou com erro \(código 7\)'
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be ('1.0.0|' + $script:AbrirPastaTeste + '|1')
    (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $script:AbrirPastaTeste 'package.json') | ConvertFrom-Json).version | Should -Be '1.0.0'
  }

  It 'Dado PATH herdado sem Git nem Bun, Quando atualizo pelo pacote do setup, Então recebe as ferramentas e preserva pasta.txt' {
    Mock AnvRegistrar { }
    $env:ANVILORE_TEST_DETALHE = $script:AbrirDetalheTeste
    $env:ANVILORE_VERSAO = 'versão original'
    $env:ANVILORE_SEM_PERGUNTAS = '0'
    $env:ANVILORE_ATALHO_SETUP = 'valor setup original'
    $env:ANVILORE_CONFIG_SETUP = 'configuração original'
    $env:Path = Join-Path $env:SystemRoot 'System32'

    $saida = ExecutarAbrirTeste

    $saida | Should -Match 'A interface do Anvilore fechou com erro \(código 7\)'
    $linhas = [IO.File]::ReadAllText($script:AbrirDetalheTeste) -split [regex]::Escape([Environment]::NewLine)
    $linhas[0] | Should -Be '1'
    $linhas[1] | Should -Be $script:AbrirConfigSetupTeste
    $linhas[2] | Should -Be (Join-Path $script:AbrirBunGerenciadoTeste 'bun.cmd')
    $linhas[3] | Should -Be (Join-Path $script:AbrirGitGerenciadoTeste 'git.cmd')
    (Get-Content -Raw -Encoding UTF8 -LiteralPath $script:AbrirConfigSetupTeste) | Should -Be $script:AbrirPastaTeste
    $env:ANVILORE_ATALHO_SETUP | Should -Be 'valor setup original'
    $env:ANVILORE_CONFIG_SETUP | Should -Be 'configuração original'
    $env:ANVILORE_VERSAO | Should -Be 'versão original'
    $env:ANVILORE_SEM_PERGUNTAS | Should -Be '0'
    $env:ANVILORE_PASTA | Should -Be $script:AbrirPastaTeste
  }

  It 'Dado pacote igual ou mais velho, Quando abro, Então não chama o instalador nem rebaixa a pasta' -ForEach @(
    @{ Pacote = '0.9.0'; Instalado = '0.9.0' },
    @{ Pacote = '0.8.9'; Instalado = '0.9.0' }
  ) {
    PrepararAbrirTeste -VersaoPacote $Pacote -VersaoInstalada $Instalado
    $null = ExecutarAbrirTeste
    Test-Path -LiteralPath $script:AbrirRecebidaTeste | Should -BeFalse
    (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $script:AbrirPastaTeste 'package.json') | ConvertFrom-Json).version | Should -Be $Instalado
  }

  It 'Dado marcador recente, Quando abro, Então não tenta outra vez, registra no log e abre a pasta existente' {
    $dir = Join-Path $script:AbrirLocalTeste 'Anvilore'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $agora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Set-Content -LiteralPath (Join-Path $dir 'versao-tentada') -Encoding ASCII -Value "1.0.0 $agora"
    $saida = ExecutarAbrirTeste
    $saida | Should -Match 'A interface do Anvilore fechou com erro'
    Test-Path -LiteralPath $script:AbrirRecebidaTeste | Should -BeFalse
    (Get-Content -Raw -LiteralPath (Join-Path $dir 'abrir.log')) | Should -Match 'já tentada anteriormente'
  }

  It 'Dado marcador com mais de 24 horas, Quando abro, Então tenta atualizar novamente' {
    $dir = Join-Path $script:AbrirLocalTeste 'Anvilore'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $ontem = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 86401
    Set-Content -LiteralPath (Join-Path $dir 'versao-tentada') -Encoding ASCII -Value "1.0.0 $ontem"
    $null = ExecutarAbrirTeste
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be ('1.0.0|' + $script:AbrirPastaTeste + '|1')
    Test-Path -LiteralPath (Join-Path $dir 'versao-tentada') | Should -BeFalse
  }

  It 'Dado marcador com horário futuro, Quando abro, Então não o trata como recente' {
    $dir = Join-Path $script:AbrirLocalTeste 'Anvilore'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $futuro = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 86401
    Set-Content -LiteralPath (Join-Path $dir 'versao-tentada') -Encoding ASCII -Value "1.0.0 $futuro"
    $null = ExecutarAbrirTeste
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be ('1.0.0|' + $script:AbrirPastaTeste + '|1')
  }

  It 'Dado falha de atualização, Quando abro duas vezes, Então registra a falha, abre a versão antiga e não repete' {
    $env:ANVILORE_VERSAO = 'versão anterior'
    $env:ANVILORE_SEM_PERGUNTAS = '0'
    $env:ANVILORE_ATALHO_SETUP = 'atalho prévio'
    $env:ANVILORE_CONFIG_SETUP = 'config prévia'
    $env:ANVILORE_TEST_FALHA = '1'
    $null = ExecutarAbrirTeste
    $null = ExecutarAbrirTeste
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be ('1.0.0|' + $script:AbrirPastaTeste + '|1')
    $dir = Join-Path $script:AbrirLocalTeste 'Anvilore'
    (Get-Content -Raw -LiteralPath (Join-Path $dir 'versao-tentada')) | Should -Match '^1\.0\.0 '
    (Get-Content -Raw -LiteralPath (Join-Path $dir 'abrir.log')) | Should -Match 'falhou'
    $env:ANVILORE_ATALHO_SETUP | Should -Be 'atalho prévio'
    $env:ANVILORE_CONFIG_SETUP | Should -Be 'config prévia'
    $env:ANVILORE_VERSAO | Should -Be 'versão anterior'
    $env:ANVILORE_SEM_PERGUNTAS | Should -Be '0'
    $env:ANVILORE_PASTA | Should -Be $script:AbrirPastaTeste
  }

  It 'Dado LOCALAPPDATA ausente, Quando a atualização falha, Então continua abrindo sem erro de caminho' {
    $env:LOCALAPPDATA = $null
    $env:ANVILORE_TEST_FALHA = '1'
    $saida = ExecutarAbrirTeste
    $saida | Should -Match 'A interface do Anvilore fechou com erro'
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be ('1.0.0|' + $script:AbrirPastaTeste + '|1')
  }
}
