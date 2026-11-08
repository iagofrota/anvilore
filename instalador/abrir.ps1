# Lançador do Anvilore para Windows. O atalho chama este texto por scriptblock,
# evitando -File, que pode ser recusado por GPO AllSigned.
$ErrorActionPreference = 'Continue'

function AnvAbrirConfigurarUtf8 {
  $antes = $null
  $eapAntes = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Stop'
    $antes = [Console]::OutputEncoding
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [Console]::OutputEncoding = $utf8
    $global:OutputEncoding = $utf8
  } catch {
    # Em Constrained Language Mode, chcp.com configura a página para este console e seus processos filhos.
    try { & chcp.com 65001 | Out-Null } catch { }
  } finally { $ErrorActionPreference = $eapAntes }
  return $antes
}

function AnvAbrirErroEEsperar([string]$mensagem) {
  Write-Host $mensagem
  [void](Read-Host 'Pressione Enter para fechar esta janela')
}

$null = AnvAbrirConfigurarUtf8
$perfil = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$pasta = if ($env:ANVILORE_PASTA) { $env:ANVILORE_PASTA } else { Join-Path $perfil 'Anvilore' }
$origem = if ($env:ANVILORE_LANCADOR) { Split-Path -Parent $env:ANVILORE_LANCADOR } else { $PSScriptRoot }

function AnvAbrirEhInstalacao([string]$caminho) {
  return (Test-Path -LiteralPath (Join-Path $caminho '.git') -PathType Container) -and
    (Test-Path -LiteralPath (Join-Path $caminho 'AGENTS.md') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $caminho 'src\cli.ts') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $caminho 'skills') -PathType Container)
}

function AnvAbrirVersaoValida([string]$versao) {
  return $versao -match '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
}

function AnvAbrirCompararVersao([string]$a, [string]$b) {
  if (-not (AnvAbrirVersaoValida $a) -or -not (AnvAbrirVersaoValida $b)) { return $null }
  $partesA = $a.Split('.')
  $partesB = $b.Split('.')
  for ($i = 0; $i -lt 3; $i++) {
    $numeroA = [int]$partesA[$i]
    $numeroB = [int]$partesB[$i]
    if ($numeroA -gt $numeroB) { return 1 }
    if ($numeroA -lt $numeroB) { return -1 }
  }
  return 0
}

function AnvAbrirLerVersaoPacote {
  try {
    $arquivo = Join-Path $origem 'VERSAO'
    if (-not (Test-Path -LiteralPath $arquivo -PathType Leaf)) { return '' }
    $versao = (Get-Content -Raw -Encoding UTF8 -LiteralPath $arquivo -ErrorAction Stop).Trim()
    if (AnvAbrirVersaoValida $versao) { return $versao }
  } catch { }
  return ''
}

function AnvAbrirLerVersaoInstalada {
  try {
    $arquivo = Join-Path $pasta 'package.json'
    $manifesto = Get-Content -Raw -Encoding UTF8 -LiteralPath $arquivo -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $versao = [string]$manifesto.version
    if (AnvAbrirVersaoValida $versao) { return $versao }
  } catch { }
  return ''
}

function AnvAbrirDiretorioEstado {
  $localAppData = $env:LOCALAPPDATA
  if (-not $localAppData -and $perfil) { $localAppData = Join-Path $perfil 'AppData\Local' }
  if (-not $localAppData) { return '' }
  return Join-Path $localAppData 'Anvilore'
}

function AnvAbrirRegistrar([string]$mensagem) {
  $diretorio = AnvAbrirDiretorioEstado
  if (-not $diretorio) { return }
  try {
    New-Item -ItemType Directory -Path $diretorio -Force -ErrorAction Stop | Out-Null
    $log = Join-Path $diretorio 'abrir.log'
    Add-Content -LiteralPath $log -Encoding UTF8 -Value ((Get-Date).ToString('o') + ' ' + $mensagem) -ErrorAction Stop
  } catch { }
}

function AnvAbrirVersaoTentadaRecentemente([string]$versao) {
  $diretorio = AnvAbrirDiretorioEstado
  if (-not $diretorio) { return $false }
  $marcador = Join-Path $diretorio 'versao-tentada'
  if (-not (Test-Path -LiteralPath $marcador -PathType Leaf)) { return $false }
  try {
    $partes = (Get-Content -Raw -Encoding UTF8 -LiteralPath $marcador -ErrorAction Stop).Trim() -split '\s+'
    if ($partes.Count -ge 2 -and $partes[0] -ceq $versao -and $partes[1] -match '^\d+$') {
      $agora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
      $idade = $agora - [long]$partes[1]
      if ($idade -ge 0 -and $idade -lt 86400) { return $true }
    }
  } catch { }
  Remove-Item -LiteralPath $marcador -Force -ErrorAction SilentlyContinue
  return $false
}

function AnvAbrirGravarVersaoTentada([string]$versao) {
  $diretorio = AnvAbrirDiretorioEstado
  if (-not $diretorio) { return }
  try {
    New-Item -ItemType Directory -Path $diretorio -Force -ErrorAction Stop | Out-Null
    $agora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Set-Content -LiteralPath (Join-Path $diretorio 'versao-tentada') -Encoding UTF8 -Value "$versao $agora" -ErrorAction Stop
  } catch { }
}

function AnvAbrirLimparVersaoTentada {
  $diretorio = AnvAbrirDiretorioEstado
  if (-not $diretorio) { return }
  Remove-Item -LiteralPath (Join-Path $diretorio 'versao-tentada') -Force -ErrorAction SilentlyContinue
}

function AnvAbrirAtualizarDoPacote([string]$versaoPacote, [string]$versaoAtual) {
  if (-not (AnvAbrirVersaoValida $versaoPacote) -or -not (AnvAbrirVersaoValida $versaoAtual)) { return }
  if ((AnvAbrirCompararVersao $versaoPacote $versaoAtual) -le 0) { return }
  if (AnvAbrirVersaoTentadaRecentemente $versaoPacote) {
    AnvAbrirRegistrar "atualização para $versaoPacote já tentada anteriormente; abrindo versão instalada $versaoAtual"
    return
  }

  $versaoOriginal = $versaoAtual
  $codigo = 1
  $erro = ''
  $instalador = Join-Path $origem 'instalar.ps1'
  $variaveis = @(
    'ANVILORE_PASTA',
    'ANVILORE_VERSAO',
    'ANVILORE_SEM_PERGUNTAS',
    'ANVILORE_ATALHO_SETUP',
    'ANVILORE_CONFIG_SETUP'
  )
  $ambienteAntes = @{}
  foreach ($nome in $variaveis) {
    $item = Get-Item -LiteralPath "Env:$nome" -ErrorAction SilentlyContinue
    $ambienteAntes[$nome] = if ($item) { [string]$item.Value } else { $null }
  }
  try {
    if (-not (Test-Path -LiteralPath $instalador -PathType Leaf)) { throw 'o instalador do pacote não está disponível' }
    $env:ANVILORE_PASTA = $pasta
    $env:ANVILORE_VERSAO = $versaoPacote
    $env:ANVILORE_SEM_PERGUNTAS = '1'
    $env:ANVILORE_ATALHO_SETUP = '1'
    $env:ANVILORE_CONFIG_SETUP = Join-Path $origem 'pasta.txt'
    $global:LASTEXITCODE = 0
    & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $instalador -ErrorAction Stop)))
    $codigo = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
  } catch {
    $erro = $_.Exception.Message
    $codigo = 1
  } finally {
    foreach ($nome in $variaveis) {
      if ($null -eq $ambienteAntes[$nome]) { Remove-Item -LiteralPath "Env:$nome" -ErrorAction SilentlyContinue }
      else { Set-Item -LiteralPath "Env:$nome" -Value $ambienteAntes[$nome] }
    }
  }

  $versaoAtual = AnvAbrirLerVersaoInstalada
  if ($codigo -notin @(0, 10) -or -not (AnvAbrirVersaoValida $versaoAtual) -or (AnvAbrirCompararVersao $versaoAtual $versaoPacote) -lt 0) {
    AnvAbrirGravarVersaoTentada $versaoPacote
    $detalhe = if ($erro) { "; $erro" } else { '' }
    AnvAbrirRegistrar "atualização de $versaoOriginal para $versaoPacote falhou (código $codigo, instalada $versaoAtual)$detalhe"
    Write-Host "Não consegui atualizar o Anvilore de $versaoOriginal para $versaoPacote. Vou abrir a versão existente."
    return
  }
  AnvAbrirLimparVersaoTentada
  AnvAbrirRegistrar "atualização de $versaoOriginal para $versaoPacote concluída com sucesso"
}

if (-not (AnvAbrirEhInstalacao $pasta)) {
  $instalador = Join-Path $origem 'instalar.ps1'
  if (-not (Test-Path -LiteralPath $instalador -PathType Leaf)) { $instalador = Join-Path $pasta 'instalador\instalar.ps1' }
  if (Test-Path -LiteralPath $instalador -PathType Leaf) {
    try {
      $env:ANVILORE_PASTA = $pasta
      & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $instalador)))
      if ($LASTEXITCODE -and $LASTEXITCODE -notin @(0, 10)) { throw "O instalador terminou com código $LASTEXITCODE." }
    } catch {
      AnvAbrirErroEEsperar "Não consegui concluir a instalação: $_"
      return
    }
  } else {
    AnvAbrirErroEEsperar "O Anvilore ainda não está instalado em $pasta. Rode o instalador Windows e abra este atalho de novo."
    return
  }
  if (-not (AnvAbrirEhInstalacao $pasta)) {
    AnvAbrirErroEEsperar "A instalação não foi concluída em $pasta. Rode o instalador Windows e tente de novo."
    return
  }
}

$null = AnvAbrirConfigurarUtf8
$caminhos = @(
  (Join-Path $perfil '.bun\bin'),
  (Join-Path $perfil '.local\bin')
)
if ($env:APPDATA) { $caminhos += Join-Path $env:APPDATA 'npm' }
if ($env:LOCALAPPDATA) {
  $caminhos += Join-Path $env:LOCALAPPDATA 'Anvilore\bin'
  $caminhos += Join-Path $env:LOCALAPPDATA 'Anvilore\git\cmd'
}
$caminhosGerenciados = ($caminhos | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }) -join ';'
if ($caminhosGerenciados) {
  $env:PATH = if ($env:PATH) { $caminhosGerenciados + ';' + $env:PATH } else { $caminhosGerenciados }
}

$versaoPacote = AnvAbrirLerVersaoPacote
$versaoAtual = AnvAbrirLerVersaoInstalada
AnvAbrirAtualizarDoPacote -versaoPacote $versaoPacote -versaoAtual $versaoAtual

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  AnvAbrirErroEEsperar 'Bun não encontrado no PATH. Rode novamente o instalador Windows do Anvilore.'
  return
}

Push-Location -LiteralPath $pasta
try {
  $env:ANVILORE_DESTINO = $pasta
  $eapAntes = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Stop'
    & bun src/cli.ts ui
    $codigo = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
  } catch {
    AnvAbrirErroEEsperar "Não consegui abrir a interface: $_"
    return
  } finally { $ErrorActionPreference = $eapAntes }
  if ($codigo -ne 0) {
    AnvAbrirErroEEsperar "A interface do Anvilore fechou com erro (código $codigo). Confira a mensagem acima."
  }
} finally { Pop-Location }
