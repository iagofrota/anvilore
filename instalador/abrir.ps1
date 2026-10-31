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
if ($env:LOCALAPPDATA) {
  $caminhos += Join-Path $env:LOCALAPPDATA 'Anvilore\bin'
  $caminhos += Join-Path $env:LOCALAPPDATA 'Anvilore\git\cmd'
}
$env:PATH = (($caminhos | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }) -join ';') + ';' + $env:PATH
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
