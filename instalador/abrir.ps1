# Lançador do Anvilore para Windows. O atalho chama este texto por scriptblock,
# evitando -File, que pode ser recusado por GPO AllSigned.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Continue'

$pasta = if ($env:ANVILORE_PASTA) { $env:ANVILORE_PASTA } else { Join-Path $HOME 'Anvilore' }
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
      [Console]::Error.WriteLine("Não consegui concluir a instalação: $($_.Exception.Message)")
      [void](Read-Host 'Pressione Enter para fechar esta janela')
      return
    }
  } else {
    [Console]::Error.WriteLine("O Anvilore ainda não está instalado em $pasta. Rode o instalador Windows e abra este atalho de novo.")
    [void](Read-Host 'Pressione Enter para fechar esta janela')
    return
  }
  if (-not (AnvAbrirEhInstalacao $pasta)) {
    [Console]::Error.WriteLine("A instalação não foi concluída em $pasta. Rode o instalador Windows e tente de novo.")
    [void](Read-Host 'Pressione Enter para fechar esta janela')
    return
  }
}

$caminhos = @(
  (Join-Path $HOME '.bun\bin'),
  (Join-Path $HOME '.local\bin'),
  (Join-Path $env:LOCALAPPDATA 'Anvilore\bin')
)
$env:PATH = (($caminhos | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }) -join ';') + ';' + $env:PATH
Push-Location -LiteralPath $pasta
try {
  $env:ANVILORE_DESTINO = $pasta
  & bun src/cli.ts ui
  $codigo = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
  if ($codigo -ne 0) {
    [Console]::Error.WriteLine("`nA interface do Anvilore fechou com erro (código $codigo). Confira a mensagem acima.")
    [void](Read-Host 'Pressione Enter para fechar esta janela')
  }
} catch {
  [Console]::Error.WriteLine("Não consegui abrir a interface: $($_.Exception.Message)")
  [void](Read-Host 'Pressione Enter para fechar esta janela')
} finally { Pop-Location }
