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
    $script:AbrirRecebidaTeste = Join-Path $script:AbrirBaseTeste 'versao recebida.txt'
    $script:AbrirPathAntesTeste = $env:Path
    $script:AbrirPerfilAntesTeste = $env:USERPROFILE
    $script:AbrirLocalAntesTeste = $env:LOCALAPPDATA
    $script:AbrirPastaAntesTeste = $env:ANVILORE_PASTA
    $script:AbrirLancadorAntesTeste = $env:ANVILORE_LANCADOR
    $script:AbrirVersaoAntesTeste = $env:ANVILORE_VERSAO
    $script:AbrirRecebidaAntesTeste = $env:ANVILORE_TEST_RECEBIDA

    New-Item -ItemType Directory -Path @(
      (Join-Path $script:AbrirPastaTeste '.git'),
      (Join-Path $script:AbrirPastaTeste 'src'),
      (Join-Path $script:AbrirPastaTeste 'skills'),
      $script:AbrirPacoteTeste,
      $script:AbrirBinTeste,
      $script:AbrirLocalTeste
    ) -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $script:AbrirPastaTeste 'AGENTS.md') -Value ''
    Set-Content -LiteralPath (Join-Path $script:AbrirPastaTeste 'src\cli.ts') -Value ''
    $script:AbrirLancadorPacoteTeste = Join-Path $script:AbrirPacoteTeste 'abrir.ps1'
    Copy-Item -LiteralPath $script:AbrirArquivoTeste -Destination $script:AbrirLancadorPacoteTeste
    $script:AbrirInstaladorPacoteTeste = Join-Path $script:AbrirPacoteTeste 'instalar.ps1'
    @'
[IO.File]::WriteAllText($env:ANVILORE_TEST_RECEBIDA, ($env:ANVILORE_VERSAO + '|' + $env:ANVILORE_PASTA + '|' + $env:ANVILORE_SEM_PERGUNTAS))
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
      Remove-Item -LiteralPath (Join-Path $script:AbrirLocalTeste 'Anvilore') -Recurse -Force -ErrorAction SilentlyContinue
      $env:ANVILORE_PASTA = $script:AbrirPastaTeste
      $env:ANVILORE_LANCADOR = $script:AbrirLancadorPacoteTeste
      $env:USERPROFILE = $script:AbrirBaseTeste
      $env:LOCALAPPDATA = $script:AbrirLocalTeste
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
    $env:ANVILORE_PASTA = $script:AbrirPastaAntesTeste
    $env:ANVILORE_LANCADOR = $script:AbrirLancadorAntesTeste
    $env:ANVILORE_VERSAO = $script:AbrirVersaoAntesTeste
    $env:ANVILORE_TEST_RECEBIDA = $script:AbrirRecebidaAntesTeste
    Remove-Item Env:ANVILORE_TEST_FALHA -ErrorAction SilentlyContinue
  }

  AfterAll {
    Remove-Item -LiteralPath $script:AbrirBaseTeste -Recurse -Force -ErrorAction SilentlyContinue
  }

  It 'Dado pacote mais novo, Quando abro o atalho, Então chama o instalador sem perguntas com a versão e a pasta atuais' {
    $saida = ExecutarAbrirTeste
    $saida | Should -Match 'A interface do Anvilore fechou com erro \(código 7\)'
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be ('1.0.0|' + $script:AbrirPastaTeste + '|1')
    (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $script:AbrirPastaTeste 'package.json') | ConvertFrom-Json).version | Should -Be '1.0.0'
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
    $env:ANVILORE_TEST_FALHA = '1'
    $null = ExecutarAbrirTeste
    $null = ExecutarAbrirTeste
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be ('1.0.0|' + $script:AbrirPastaTeste + '|1')
    $dir = Join-Path $script:AbrirLocalTeste 'Anvilore'
    (Get-Content -Raw -LiteralPath (Join-Path $dir 'versao-tentada')) | Should -Match '^1\.0\.0 '
    (Get-Content -Raw -LiteralPath (Join-Path $dir 'abrir.log')) | Should -Match 'falhou'
  }

  It 'Dado LOCALAPPDATA ausente, Quando a atualização falha, Então continua abrindo sem erro de caminho' {
    $env:LOCALAPPDATA = $null
    $env:ANVILORE_TEST_FALHA = '1'
    $saida = ExecutarAbrirTeste
    $saida | Should -Match 'A interface do Anvilore fechou com erro'
    (Get-Content -Raw -LiteralPath $script:AbrirRecebidaTeste) | Should -Be '1.0.0'
  }
}
