# Anvilore - instalador para Windows 10/11 x64, sem administrador.
#
# Uso (um destes; o 1º é o que o README mostra):
#   irm https://raw.githubusercontent.com/iagofrota/anvilore/main/instalador/instalar.ps1 | iex
#   powershell -NoProfile -Command "& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 'instalar.ps1')))"
# NÃO use `powershell -ExecutionPolicy Bypass -File instalar.ps1`: uma política de grupo (GPO) vence o parâmetro
# (PROVA-U0 item 3). O arquivo é UTF-8 SEM BOM: leia com `-Encoding UTF8`, senão o Windows PowerShell 5.1 estraga os acentos.
#
# Este script nunca chama `exit` (num `irm | iex` isso fecharia o terminal da pessoa). O resultado fica em
# $LASTEXITCODE:  0 completo · 10 parcial (nenhum agente instalado) · 1 falhou · 2 sistema não suportado ·
#                 3 assinatura da versão não confere · 4 download de dependência falhou ou não confere.
#
# Variáveis de ambiente:
#   ANVILORE_SEM_PERGUNTAS=1  responde o padrão de cada pergunta (CI e QA).
#   ANVILORE_ORIGEM=<url|pasta>  de onde baixar o kit (padrão: o repositório oficial no GitHub). O CI e o QA usam um repositório local.
#   ANVILORE_VERSAO=<tag>  instala esta tag em vez da última release publicada.
#   ANVILORE_PASTA=<pasta>  onde instalar (padrão: %USERPROFILE%\Anvilore).
#   ANVILORE_INSTALAR_CLAUDE=sim|nao  responde de antemão se instala o Claude Code quando não há agente nenhum.
#   ANVILORE_ESPERAR_ENTER=1  espera Enter antes de terminar (janela que fecha sozinha, para a pessoa ler o resumo).
#   ANVILORE_MANIFESTO=<arquivo>, ANVILORE_ASSINANTES=<arquivo>  só valem quando o bloco embutido correspondente
#       está vazio (CI/QA/desenvolvimento). Numa release os blocos vêm preenchidos e estas variáveis são ignoradas.
#
# As regiões "ANVILORE:MANIFESTO" e "ANVILORE:ASSINANTES" abaixo são preenchidas pelo build da release
# (bun scripts/embutir-instalador.ts --modelo instalador/instalar.ps1): o manifesto de dependências e a chave pública de
# quem assina as versões. Vazias, o instalador NÃO confia em nada: sem chave, recusa instalar o kit.
#
# Cada passo abaixo é o passo de mesmo número do PLANO (§2). O 10 (atalhos) é da fatia U6.

# >>> ANVILORE:MANIFESTO (preenchido na release por scripts/embutir-instalador.ts; não edite)
$script:AnvManifestoEmbutido = @'
'@
# <<< ANVILORE:MANIFESTO
# >>> ANVILORE:ASSINANTES (preenchido na release por scripts/embutir-instalador.ts; não edite)
$script:AnvAssinantesEmbutido = @'
'@
# <<< ANVILORE:ASSINANTES

$script:AnvOrigemPadrao = 'https://github.com/iagofrota/anvilore.git'
$script:AnvChaveEnv = 'HKCU:\Environment'
$script:AnvLogPendente = @()
$script:AnvArquivoLog = $null
$script:AnvCodigoDeSaida = 1

# ---------------------------------------------------------------- registro e perguntas

function AnvRedigir {
  param([string]$Texto)
  # Qualquer "usuario[:senha]@" depois de ://, e os formatos conhecidos de token do GitHub.
  $t = $Texto -replace '://[^/\s@]+@', '://***@'
  $t = $t -replace 'gh[pousr]_[A-Za-z0-9]{20,}', '***'
  $t = $t -replace 'github_pat_[A-Za-z0-9_]+', '***'
  return $t
}

function AnvReiniciarLog { $script:AnvLogPendente = @(); $script:AnvArquivoLog = $null }

function AnvRegistrar {
  param([string]$Texto)
  $linha = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), (AnvRedigir $Texto)
  # Falha ao gravar o registro nunca derruba a instalação.
  if ($script:AnvArquivoLog) { try { Add-Content -LiteralPath $script:AnvArquivoLog -Value $linha -Encoding UTF8 } catch { } }
  else { $script:AnvLogPendente += $linha }
}

# Passo 12. Antes de a pasta existir, o registro fica na memória; ao definir o arquivo, tudo é gravado.
function AnvDefinirLog {
  param([string]$Pasta)
  $dir = Join-Path $Pasta '.anvilore'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $script:AnvArquivoLog = Join-Path $dir 'instalacao.log'
  foreach ($l in $script:AnvLogPendente) { Add-Content -LiteralPath $script:AnvArquivoLog -Value $l -Encoding UTF8 }
  $script:AnvLogPendente = @()
}

function AnvEscrever {
  param([string]$Texto)
  Write-Host $Texto
  AnvRegistrar $Texto
}

function AnvAviso {
  param([string]$Texto)
  Write-Host "Aviso: $Texto"
  AnvRegistrar "AVISO $Texto"
}

function AnvParar {
  param([int]$Codigo, [string]$Mensagem)
  throw "ANV-PARAR:${Codigo}:$Mensagem"
}

function AnvVariavel {
  param([string]$Nome)
  $item = Get-Item -Path "Env:$Nome" -ErrorAction SilentlyContinue
  if ($item) { return [string]$item.Value }
  return ''
}

function AnvConfirmar {
  param([string]$Pergunta, [bool]$Padrao)
  if ((AnvVariavel 'ANVILORE_SEM_PERGUNTAS') -eq '1') {
    AnvRegistrar "pergunta (resposta padrão $(if ($Padrao) { 'sim' } else { 'não' })): $Pergunta"
    return $Padrao
  }
  $dica = if ($Padrao) { 'S/n' } else { 's/N' }
  $r = Read-Host "$Pergunta [$dica]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $Padrao }
  return ($r.Trim().ToLowerInvariant().StartsWith('s'))
}

# ---------------------------------------------------------------- sistema, versões, PATH

function AnvPlataforma {
  param([string]$Sistema = (AnvVariavel 'OS'), [string]$Arquitetura = '')
  if ($Sistema -ne 'Windows_NT') { return $null }
  if (-not $Arquitetura) {
    $Arquitetura = AnvVariavel 'PROCESSOR_ARCHITEW6432'
    if (-not $Arquitetura) { $Arquitetura = AnvVariavel 'PROCESSOR_ARCHITECTURE' }
  }
  if ($Arquitetura -eq 'AMD64') { return 'windows-x64' }
  return $null
}

function AnvCompararVersao {
  param([string]$A, [string]$B)
  $ra = [regex]::Match($A, '^(\d+)\.(\d+)\.(\d+)')
  $rb = [regex]::Match($B, '^(\d+)\.(\d+)\.(\d+)')
  if (-not $ra.Success -or -not $rb.Success) { return $null }
  for ($i = 1; $i -le 3; $i++) {
    $x = [int64]$ra.Groups[$i].Value; $y = [int64]$rb.Groups[$i].Value
    if ($x -lt $y) { return -1 }
    if ($x -gt $y) { return 1 }
  }
  return 0
}

function AnvModoLinguagem { return [string]$ExecutionContext.SessionState.LanguageMode }

function AnvNormalizarCaminho {
  param([string]$Caminho)
  return $Caminho.Trim().TrimEnd('\', '/').ToLowerInvariant()
}

function AnvAdicionarAoPath {
  param([string]$Atual, [string]$Pasta, [switch]$NoInicio)
  $entradas = @($Atual -split ';' | Where-Object { $_.Trim() -ne '' })
  $alvo = AnvNormalizarCaminho $Pasta
  foreach ($e in $entradas) {
    if ((AnvNormalizarCaminho $e) -eq $alvo) { return ($entradas -join ';') }
    try {
      $expandida = [Environment]::ExpandEnvironmentVariables($e)
      if ((AnvNormalizarCaminho $expandida) -eq $alvo) { return ($entradas -join ';') }
    } catch { }
  }
  if ($NoInicio) { $entradas = @($Pasta) + $entradas } else { $entradas = $entradas + @($Pasta) }
  return ($entradas -join ';')
}

function AnvDefinirChaveEnv { param([string]$Chave) $script:AnvChaveEnv = $Chave }

function AnvChaveRegExe { return ($script:AnvChaveEnv -replace '^HKCU:\\?', 'HKCU\') }

# Registro como a pessoa tem; em Constrained Language Mode (AppLocker/WDAC) os métodos .NET do registro são bloqueados
# e o caminho é o reg.exe (PROVA-U0 item 3b).
function AnvUsaRegExe { param([switch]$ForcarRegExe) return ($ForcarRegExe -or ((AnvModoLinguagem) -ne 'FullLanguage')) }

function AnvLerValorUsuario {
  param([string]$Nome, [switch]$ForcarRegExe)
  if (-not (AnvUsaRegExe -ForcarRegExe:$ForcarRegExe)) {
    $chave = Get-Item -LiteralPath $script:AnvChaveEnv -ErrorAction SilentlyContinue
    if (-not $chave) { return '' }
    return [string]$chave.GetValue($Nome, '', 'DoNotExpandEnvironmentNames')
  }
  $saida = & reg.exe query (AnvChaveRegExe) /v $Nome 2>$null
  foreach ($linha in @($saida)) {
    $m = [regex]::Match([string]$linha, '^\s+' + [regex]::Escape($Nome) + '\s+REG_\w+\s*(.*)$')
    if ($m.Success) { return $m.Groups[1].Value }
  }
  return ''
}

function AnvAvisarMudancaDeAmbiente {
  # Gravar no registro não avisa o Explorer; mexer numa variável de usuário por .NET faz o aviso (WM_SETTINGCHANGE).
  if ($script:AnvChaveEnv -ne 'HKCU:\Environment') { return }
  try {
    [Environment]::SetEnvironmentVariable('ANVILORE_AVISO_AMBIENTE', '1', 'User')
    [Environment]::SetEnvironmentVariable('ANVILORE_AVISO_AMBIENTE', $null, 'User')
  } catch { }
}

function AnvGravarValorUsuario {
  param([string]$Nome, [string]$Valor, [ValidateSet('ExpandString', 'String')][string]$Tipo = 'String', [switch]$ForcarRegExe)
  if (-not (AnvUsaRegExe -ForcarRegExe:$ForcarRegExe)) {
    if (-not (Test-Path -LiteralPath $script:AnvChaveEnv)) { New-Item -Path $script:AnvChaveEnv -Force | Out-Null }
    Set-ItemProperty -LiteralPath $script:AnvChaveEnv -Name $Nome -Value $Valor -Type $Tipo
    AnvAvisarMudancaDeAmbiente
    return
  }
  $tipoReg = if ($Tipo -eq 'ExpandString') { 'REG_EXPAND_SZ' } else { 'REG_SZ' }
  # Valor terminado em barra invertida + aspas do argumento viraria aspas escapadas.
  if ($Valor.EndsWith('\')) { $Valor = $Valor + ';' }
  & reg.exe add (AnvChaveRegExe) /v $Nome /t $tipoReg /d $Valor /f | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "reg.exe não gravou $Nome" }
}

function AnvGravarVariavelUsuario {
  param([string]$Nome, [string]$Valor, [switch]$ForcarRegExe)
  AnvGravarValorUsuario -Nome $Nome -Valor $Valor -Tipo 'String' -ForcarRegExe:$ForcarRegExe
}

function AnvAcrescentarPathUsuario {
  param([string]$Pasta, [switch]$ForcarRegExe)
  $atual = AnvLerValorUsuario -Nome 'Path' -ForcarRegExe:$ForcarRegExe
  $novo = AnvAdicionarAoPath -Atual $atual -Pasta $Pasta
  if ($novo -eq $atual) { return }
  AnvGravarValorUsuario -Nome 'Path' -Valor $novo -Tipo 'ExpandString' -ForcarRegExe:$ForcarRegExe
  AnvRegistrar "PATH do usuário: acrescentei $Pasta"
}

# PATH deste processo: sem isso o `bun`/`git` recém-instalados não são achados pelos passos seguintes.
function AnvAcrescentarPathProcesso {
  param([string]$Pasta)
  $env:Path = AnvAdicionarAoPath -Atual $env:Path -Pasta $Pasta -NoInicio
}

function AnvTornarDisponivel {
  param([string]$Pasta)
  AnvAcrescentarPathUsuario -Pasta $Pasta
  AnvAcrescentarPathProcesso -Pasta $Pasta
}

# ---------------------------------------------------------------- manifesto, assinantes, download

function AnvLerManifesto {
  param([string]$Embutido = $script:AnvManifestoEmbutido, [string]$Arquivo = (AnvVariavel 'ANVILORE_MANIFESTO'))
  $texto = $null
  if ($Embutido -and $Embutido.Trim()) { $texto = $Embutido }
  elseif ($Arquivo -and (Test-Path -LiteralPath $Arquivo)) { $texto = Get-Content -Raw -Encoding UTF8 -LiteralPath $Arquivo }
  if (-not $texto) { return $null }
  try { return ($texto | ConvertFrom-Json) } catch { return $null }
}

# Manifesto (instalador/dependencias.json, formato 1): dependencias.<nome>.versao e dependencias.<nome>.plataformas.<plataforma>
# = { arquivo, url (https), sha256 (64 hex), formato, executavel, tamanhoMB? }. Devolve a entrada com a versão junto, ou nulo.
function AnvDependencia {
  param($Manifesto, [string]$Nome, [string]$Plataforma)
  if (-not $Manifesto) { return $null }
  try { $dep = $Manifesto.dependencias.$Nome; $e = $dep.plataformas.$Plataforma } catch { return $null }
  if (-not $dep -or -not $e -or -not $dep.versao) { return $null }
  if (([string]$e.url) -notmatch '^https://' -or ([string]$e.sha256) -notmatch '^[0-9a-fA-F]{64}$') { return $null }
  return [pscustomobject]@{
    versao = [string]$dep.versao; arquivo = [string]$e.arquivo; url = [string]$e.url; sha256 = [string]$e.sha256
    formato = [string]$e.formato; executavel = [string]$e.executavel; tamanhoMB = $e.tamanhoMB
  }
}

function AnvLinhasDeAssinantes {
  param([string]$Texto)
  $validas = @()
  foreach ($l in ($Texto -split "`r?`n")) {
    $t = $l.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    if ($t -match '^\S+\s+(?:\S+=\S+\s+)*(?:ssh-\S+|ecdsa-\S+|sk-\S+)\s+\S+') { $validas += $t }
  }
  return $validas
}

# Sem chave embutida o resultado é nulo: nada é aceito. O arquivo de apoio (ANVILORE_ASSINANTES) só vale com o bloco vazio.
function AnvAssinantes {
  param([string]$Embutido = $script:AnvAssinantesEmbutido, [string]$Arquivo = (AnvVariavel 'ANVILORE_ASSINANTES'))
  $linhas = AnvLinhasDeAssinantes -Texto $Embutido
  if (@($linhas).Count -eq 0 -and $Arquivo -and (Test-Path -LiteralPath $Arquivo)) {
    $linhas = AnvLinhasDeAssinantes -Texto (Get-Content -Raw -Encoding UTF8 -LiteralPath $Arquivo)
  }
  if (@($linhas).Count -eq 0) { return $null }
  return ((@($linhas) -join "`n") + "`n")
}

function AnvConfigurarTls {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
}

# 'ok' | 'falha-download' | 'hash-diferente'. Hash errado: o arquivo é apagado (cenário 33).
function AnvBaixarComHash {
  param($Dependencia, [string]$Destino)
  $ProgressPreference = 'SilentlyContinue'
  try { Invoke-WebRequest -Uri $Dependencia.url -OutFile $Destino -UseBasicParsing -ErrorAction Stop }
  catch {
    AnvRegistrar "download falhou: $($Dependencia.url): $($_.Exception.Message)"
    Remove-Item -LiteralPath $Destino -Force -ErrorAction SilentlyContinue
    return 'falha-download'
  }
  if (-not (Test-Path -LiteralPath $Destino)) { return 'falha-download' }
  $obtido = (Get-FileHash -LiteralPath $Destino -Algorithm SHA256).Hash
  if ($obtido -ine [string]$Dependencia.sha256) {
    AnvRegistrar "hash diferente em $($Dependencia.url): esperado $($Dependencia.sha256), obtido $obtido"
    Remove-Item -LiteralPath $Destino -Force -ErrorAction SilentlyContinue
    return 'hash-diferente'
  }
  return 'ok'
}

function AnvExecutar {
  param([string]$Exe, [string[]]$Argumentos = @(), [string]$Pasta = '')
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $entrou = $false
  try {
    if ($Pasta) { Push-Location -LiteralPath $Pasta; $entrou = $true }
    $saida = & $Exe @Argumentos 2>&1 | ForEach-Object { "$_" }
    $codigo = $LASTEXITCODE
  } catch {
    $saida = @($_.Exception.Message)
    $codigo = 127
  } finally {
    if ($entrou) { Pop-Location }
    $ErrorActionPreference = $antes
  }
  $texto = (@($saida) -join "`n")
  AnvRegistrar ("executei: {0} {1} -> {2}" -f $Exe, ($Argumentos -join ' '), $codigo)
  return [pscustomobject]@{ Codigo = $codigo; Saida = $texto }
}

function AnvAcharExecutavel {
  param([string]$Pasta, [string]$Nome)
  $f = Get-ChildItem -LiteralPath $Pasta -Recurse -Filter $Nome -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}

function AnvComando {
  param([string]$Nome)
  $c = Get-Command $Nome -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.Source }
  return $null
}

# ---------------------------------------------------------------- tag e assinatura

function AnvEscolherTag {
  param([string[]]$Linhas)
  $melhor = $null
  foreach ($l in $Linhas) {
    $m = [regex]::Match([string]$l, 'refs/tags/(v\d+\.\d+\.\d+)$')
    if (-not $m.Success) { continue }
    $tag = $m.Groups[1].Value
    if ($null -eq $melhor -or (AnvCompararVersao $tag.Substring(1) $melhor.Substring(1)) -gt 0) { $melhor = $tag }
  }
  return $melhor
}

function AnvDescobrirTag {
  param([string]$Git, [string]$Origem)
  if ($Origem -eq $script:AnvOrigemPadrao) {
    try {
      $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/iagofrota/anvilore/releases/latest' -Headers @{ 'User-Agent' = 'anvilore-instalador' } -ErrorAction Stop
      if ($r.tag_name -match '^v\d+\.\d+\.\d+$') { return [string]$r.tag_name }
    } catch { AnvRegistrar "API de releases indisponível: $($_.Exception.Message)" }
  }
  $r = AnvExecutar $Git @('ls-remote', '--tags', $Origem)
  if ($r.Codigo -ne 0) { return $null }
  return (AnvEscolherTag -Linhas ($r.Saida -split "`n"))
}

# `verify-tag` só prova que o objeto foi assinado, não que o NOME assinado é o da ref (um espelho poderia publicar
# a tag assinada da v0.3.1 como v0.3.2). Devolve nulo se está tudo certo, ou a razão da recusa.
function AnvIdentidadeDaTag {
  param([string]$Cabecalho, [string]$Tag, [string]$Commit)
  $campos = @{}
  foreach ($linha in ($Cabecalho -split "`r?`n")) {
    if ($linha -eq '') { break }
    $i = $linha.IndexOf(' ')
    if ($i -gt 0 -and -not $campos.ContainsKey($linha.Substring(0, $i))) { $campos[$linha.Substring(0, $i)] = $linha.Substring($i + 1) }
  }
  if ($campos['tag'] -ne $Tag) { return "a tag assinada se chama '$($campos['tag'])', não '$Tag'" }
  if ($campos['type'] -ne 'commit') { return "a tag $Tag não aponta para um commit" }
  if ($campos['object'] -ne $Commit) { return "o commit assinado ($($campos['object'])) não é o que foi baixado ($Commit)" }
  return $null
}

# `verify-tag` escolhe o verificador pelo tipo da assinatura que está DENTRO da tag: uma tag OpenPGP ou x509 passaria pelo
# gpg da pessoa, com o chaveiro dela, mesmo com gpg.format=ssh. Só vale assinatura SSH conferida contra a chave embutida.
function AnvTemAssinaturaSsh {
  param([string]$ConteudoDaTag)
  return [bool]([regex]::IsMatch($ConteudoDaTag, '(?m)^-----BEGIN SSH SIGNATURE-----\r?$'))
}

# Programas de gpg/x509 que não existem: se alguma assinatura não-SSH chegasse ao git, ele não acharia como aprová-la.
$script:AnvSemGpg = @('-c', 'gpg.program=anvilore-sem-gpg', '-c', 'gpg.openpgp.program=anvilore-sem-gpg', '-c', 'gpg.x509.program=anvilore-sem-gpg')

# ---------------------------------------------------------------- passos

function AnvGit {
  # Usa o Git da pessoa se for 2.34+ (assinatura SSH) e tiver o bash do Git for Windows (os hooks do Anvilore
  # são `shell: bash`; sem bash toda escrita fica bloqueada).
  $exe = AnvComando 'git'
  if (-not $exe) { return [pscustomobject]@{ Ok = $false; Exe = $null; Bash = $null; Motivo = 'não há Git neste computador' } }
  $v = AnvExecutar $exe @('--version')
  $m = [regex]::Match($v.Saida, '(\d+\.\d+\.\d+)')
  if ($v.Codigo -ne 0 -or -not $m.Success -or (AnvCompararVersao $m.Groups[1].Value '2.34.0') -lt 0) {
    return [pscustomobject]@{ Ok = $false; Exe = $exe; Bash = $null; Motivo = 'o Git é antigo demais (precisa da versão 2.34 ou mais nova)' }
  }
  $dir = Split-Path -Parent $exe
  foreach ($rel in @('..\bin\bash.exe', '..\..\bin\bash.exe')) {
    $c = Join-Path $dir $rel
    if (Test-Path -LiteralPath $c) {
      return [pscustomobject]@{ Ok = $true; Exe = $exe; Bash = (Resolve-Path -LiteralPath $c).Path; Motivo = '' }
    }
  }
  return [pscustomobject]@{ Ok = $false; Exe = $exe; Bash = $null; Motivo = 'o Git não traz o bash (Git Bash), que os hooks do Anvilore usam' }
}

function AnvInstalarPortableGit {
  param($Manifesto, [string]$Plataforma, [string]$PastaGit, [string]$Temp)
  $dep = AnvDependencia -Manifesto $Manifesto -Nome 'portablegit' -Plataforma $Plataforma
  if (-not $dep) { AnvParar 4 'O instalador não tem o Git portátil para este sistema na lista de dependências.' }
  $arquivo = Join-Path $Temp 'PortableGit.7z.exe'
  $mb = if ($dep.tamanhoMB) { $dep.tamanhoMB } else { 392 }
  AnvEscrever "Baixando o Git portátil $($dep.versao) (ocupa cerca de $mb MB depois de extraído)..."
  $r = AnvBaixarComHash -Dependencia $dep -Destino $arquivo
  if ($r -eq 'falha-download') { AnvParar 4 'Não consegui baixar o Git portátil. Confira a internet e rode o instalador de novo.' }
  if ($r -eq 'hash-diferente') { AnvParar 4 'O Git portátil baixado não confere com o esperado (SHA-256). Apaguei o arquivo e não instalei nada.' }
  New-Item -ItemType Directory -Path $PastaGit -Force | Out-Null
  $destino = if ($PastaGit -match '\s') { '"' + $PastaGit + '"' } else { $PastaGit }
  AnvEscrever 'Extraindo o Git portátil (leva cerca de 20 segundos)...'
  $p = Start-Process -FilePath $arquivo -ArgumentList @('-o', $destino, '-y') -Wait -PassThru -WindowStyle Hidden
  AnvRegistrar "PortableGit extraído, código $($p.ExitCode)"
  $git = Join-Path $PastaGit 'cmd\git.exe'
  $bash = Join-Path $PastaGit 'bin\bash.exe'
  if (-not (Test-Path -LiteralPath $git) -or -not (Test-Path -LiteralPath $bash)) {
    AnvParar 4 'O Git portátil não foi extraído por inteiro (faltam git.exe ou bash.exe).'
  }
  AnvTornarDisponivel -Pasta (Join-Path $PastaGit 'cmd')
  # Reforço opcional: o PATH com git\cmd já basta para o Claude Code achar o bash (PROVA-U0 item 10b).
  try { AnvGravarVariavelUsuario -Nome 'CLAUDE_CODE_GIT_BASH_PATH' -Valor $bash; $env:CLAUDE_CODE_GIT_BASH_PATH = $bash } catch { AnvAviso "não gravei CLAUDE_CODE_GIT_BASH_PATH: $($_.Exception.Message)" }
  return [pscustomobject]@{ Ok = $true; Exe = $git; Bash = $bash; Motivo = '' }
}

function AnvVersaoDoBun {
  param([string]$Exe)
  $r = AnvExecutar $Exe @('--version')
  if ($r.Codigo -ne 0) { return $null }
  $m = [regex]::Match($r.Saida, '(\d+\.\d+\.\d+)')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

# Devolve $true se instalou o Bun (então é "gerenciado": o atualizador pode atualizá-lo - D9).
function AnvGarantirBun {
  param($Manifesto, [string]$Plataforma, [string]$PastaBun, [string]$Temp, [string]$MarcadorBun)
  $dep = AnvDependencia -Manifesto $Manifesto -Nome 'bun' -Plataforma $Plataforma
  if (-not $dep) { AnvParar 4 'O instalador não tem o Bun para este sistema na lista de dependências.' }
  $existente = AnvComando 'bun'
  if ($existente) {
    $v = AnvVersaoDoBun -Exe $existente
    if ($v -and (AnvCompararVersao $v $dep.versao) -ge 0) {
      AnvEscrever "Bun $v já instalado."
      return [bool](Test-Path -LiteralPath $MarcadorBun)
    }
  }
  $candidatos = @($dep)
  $baseline = AnvDependencia -Manifesto $Manifesto -Nome 'bun' -Plataforma "$Plataforma-baseline"
  if ($baseline) { $candidatos += $baseline }
  foreach ($c in $candidatos) {
    AnvEscrever "Baixando o Bun $($c.versao)..."
    $zip = Join-Path $Temp 'bun.zip'
    $r = AnvBaixarComHash -Dependencia $c -Destino $zip
    if ($r -eq 'falha-download') { AnvParar 4 'Não consegui baixar o Bun. Confira a internet e rode o instalador de novo.' }
    if ($r -eq 'hash-diferente') { AnvParar 4 'O Bun baixado não confere com o esperado (SHA-256). Apaguei o arquivo e não instalei nada.' }
    $extraido = Join-Path $Temp 'bun-extraido'
    Remove-Item -LiteralPath $extraido -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $zip -DestinationPath $extraido -Force
    $exe = AnvAcharExecutavel -Pasta $extraido -Nome 'bun.exe'
    if (-not $exe) { AnvParar 4 'O pacote do Bun não traz o bun.exe.' }
    New-Item -ItemType Directory -Path $PastaBun -Force | Out-Null
    $destino = Join-Path $PastaBun 'bun.exe'
    Copy-Item -LiteralPath $exe -Destination $destino -Force
    # O Bun normal exige CPU com AVX2; numa CPU antiga ele nem abre. Aí tenta a versão "baseline".
    if (AnvVersaoDoBun -Exe $destino) {
      AnvTornarDisponivel -Pasta $PastaBun
      # Lembra que o Bun é nosso mesmo se a instalação parar antes de gravar atualizacao.json (D9).
      try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $MarcadorBun) -Force | Out-Null
        Set-Content -LiteralPath $MarcadorBun -Value 'bun instalado pelo instalador do Anvilore' -Encoding ASCII
      } catch { }
      return $true
    }
    AnvAviso 'Este Bun não abriu neste computador; tentando a versão para processadores antigos.'
  }
  AnvParar 4 'O Bun instalado não abre neste computador.'
}

function AnvGarantirRg {
  param($Manifesto, [string]$Plataforma, [string]$PastaBin, [string]$Temp)
  if (AnvComando 'rg') { return $true }
  $dep = AnvDependencia -Manifesto $Manifesto -Nome 'rg' -Plataforma $Plataforma
  if (-not $dep) { AnvAviso 'Não tenho o ripgrep (rg) para este sistema; sigo sem ele.'; return $false }
  $zip = Join-Path $Temp 'rg.zip'
  $r = AnvBaixarComHash -Dependencia $dep -Destino $zip
  if ($r -ne 'ok') {
    AnvAviso "Não instalei o ripgrep ($(if ($r -eq 'hash-diferente') { 'o arquivo baixado não confere' } else { 'o download falhou' })); sigo sem ele."
    return $false
  }
  $extraido = Join-Path $Temp 'rg-extraido'
  Remove-Item -LiteralPath $extraido -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $zip -DestinationPath $extraido -Force
  $exe = AnvAcharExecutavel -Pasta $extraido -Nome 'rg.exe'
  if (-not $exe) { AnvAviso 'O pacote do ripgrep não traz o rg.exe; sigo sem ele.'; return $false }
  New-Item -ItemType Directory -Path $PastaBin -Force | Out-Null
  Copy-Item -LiteralPath $exe -Destination (Join-Path $PastaBin 'rg.exe') -Force
  AnvTornarDisponivel -Pasta $PastaBin
  return $true
}

function AnvEhInstalacao {
  param([string]$Pasta)
  $pkg = Join-Path $Pasta 'package.json'
  if (-not (Test-Path -LiteralPath (Join-Path $Pasta '.git')) -or -not (Test-Path -LiteralPath $pkg)) { return $false }
  return ((Get-Content -Raw -Encoding UTF8 -LiteralPath $pkg) -match '"name"\s*:\s*"anvilore"')
}

function AnvEscolherPasta {
  param([string]$Perfil)
  $pasta = AnvVariavel 'ANVILORE_PASTA'
  if (-not $pasta) { $pasta = Join-Path $Perfil 'Anvilore' }
  elseif (-not (Split-Path -Path $pasta -IsAbsolute)) { $pasta = Join-Path (Get-Location).Path $pasta }
  while ($true) {
    if (-not (Test-Path -LiteralPath $pasta)) { return $pasta }
    if (AnvEhInstalacao -Pasta $pasta) { return $pasta }
    if (@(Get-ChildItem -LiteralPath $pasta -Force -ErrorAction SilentlyContinue).Count -eq 0) { return $pasta }
    if ((AnvVariavel 'ANVILORE_SEM_PERGUNTAS') -eq '1') {
      AnvParar 1 "A pasta $pasta já existe e não é uma instalação do Anvilore. Escolha outra (ANVILORE_PASTA) ou apague/renomeie essa. Não mexi nela."
    }
    AnvEscrever "A pasta $pasta já existe e não é uma instalação do Anvilore."
    $nome = Read-Host 'Digite outro nome de pasta (dentro da sua pasta de usuário)'
    if ([string]::IsNullOrWhiteSpace($nome) -or $nome -match '[\\/:*?"<>|]') { AnvEscrever 'Nome inválido.'; continue }
    $pasta = Join-Path $Perfil $nome.Trim()
  }
}

# Passo 6. Baixa para uma pasta de passagem, confere a assinatura e só então move para o lugar. Falhou: apaga o que baixou.
function AnvBaixarKit {
  param([string]$Git, [string]$Pasta, [string]$Perfil, [string]$Temp)
  $assinantes = AnvAssinantes
  if (-not $assinantes) {
    AnvParar 3 'Este instalador não traz a chave de assinatura do Anvilore, então não consigo conferir a versão. Por segurança, não instalei nada. Baixe o instalador oficial de novo.'
  }
  $origem = AnvVariavel 'ANVILORE_ORIGEM'
  if (-not $origem) { $origem = $script:AnvOrigemPadrao }
  $fixa = AnvVariavel 'ANVILORE_VERSAO'
  $tag = if ($fixa) { 'v' + $fixa.TrimStart('v') } else { AnvDescobrirTag -Git $Git -Origem $origem }
  if (-not $tag) { AnvParar 1 'Não achei nenhuma versão publicada do Anvilore para instalar.' }
  AnvEscrever "Baixando o Anvilore $tag..."
  $staging = Join-Path $Perfil 'Anvilore.novo'
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  $assinFile = Join-Path $Temp 'assinantes'
  Set-Content -LiteralPath $assinFile -Value $assinantes -NoNewline -Encoding ASCII
  $env:GIT_TERMINAL_PROMPT = '0'
  $clone = AnvExecutar $Git @('clone', '-c', 'core.autocrlf=false', '-c', 'advice.detachedHead=false', '--branch', $tag, $origem, $staging)
  if ($clone.Codigo -ne 0) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    AnvParar 1 "Não consegui baixar o Anvilore ($tag). Confira a internet e rode o instalador de novo. $($clone.Saida)"
  }
  $ref = "refs/tags/$tag"
  $razao = $null
  $v = [pscustomobject]@{ Codigo = 0; Saida = '' }
  $tipo = AnvExecutar $Git @('-C', $staging, 'cat-file', '-t', $ref)
  $cab = AnvExecutar $Git @('-C', $staging, 'cat-file', 'tag', $ref)
  if ($tipo.Saida.Trim() -ne 'tag') { $razao = 'a versão não é uma tag anotada' }
  elseif (-not (AnvTemAssinaturaSsh -ConteudoDaTag $cab.Saida)) { $razao = 'a tag não tem assinatura SSH' }
  else {
    $v = AnvExecutar $Git (@('-C', $staging, '-c', 'gpg.format=ssh') + $script:AnvSemGpg + @('-c', "gpg.ssh.allowedSignersFile=$assinFile", 'verify-tag', $ref))
    if ($v.Codigo -ne 0) { $razao = 'a assinatura não confere com a chave do Anvilore' }
    else {
      $head = AnvExecutar $Git @('-C', $staging, 'rev-parse', 'HEAD')
      $razao = AnvIdentidadeDaTag -Cabecalho $cab.Saida -Tag $tag -Commit $head.Saida.Trim()
    }
  }
  if ($razao) {
    AnvRegistrar "verify-tag recusou $tag : $($v.Saida)"
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    AnvParar 3 "A versão $tag não passou na conferência de segurança ($razao). Apaguei o que baixei, não liguei nenhum agente e não instalei nada."
  }
  AnvEscrever "Assinatura da versão $tag conferida."
  if (Test-Path -LiteralPath $Pasta) { Remove-Item -LiteralPath $Pasta -Recurse -Force }
  Move-Item -LiteralPath $staging -Destination $Pasta
  return $tag
}

# Passo 7. Devolve os agentes achados; oferece o Claude Code se não houver nenhum (D7).
function AnvAgentes {
  $achados = @()
  foreach ($nome in @('claude', 'codex', 'gemini', 'copilot')) { if (AnvComando $nome) { $achados += $nome } }
  return $achados
}

function AnvOferecerClaudeCode {
  $resposta = (AnvVariavel 'ANVILORE_INSTALAR_CLAUDE').ToLowerInvariant()
  if ($resposta -in @('sim', 's', '1')) { }
  elseif ($resposta -in @('nao', 'não', 'n', '0')) { AnvRegistrar 'Claude Code: não instalado (ANVILORE_INSTALAR_CLAUDE)'; return }
  elseif (-not (AnvConfirmar -Pergunta 'Nenhum agente (Claude Code, Codex, Gemini, Copilot) foi encontrado. Posso instalar o Claude Code pelo instalador oficial da Anthropic? (O login você faz depois, no próprio Claude Code.)' -Padrao $false)) { return }
  try {
    AnvEscrever 'Instalando o Claude Code...'
    Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' -ErrorAction Stop | Invoke-Expression
    AnvAcrescentarPathProcesso -Pasta (Join-Path (AnvVariavel 'USERPROFILE') '.local\bin')
  } catch { AnvAviso "não consegui instalar o Claude Code: $($_.Exception.Message)" }
}

# Passo 10 - fatia U6. A U6 preenche esta função com o atalho "Anvilore" (Menu Iniciar e Área de Trabalho, via .lnk;
# em Constrained Language Mode o atalho fica por conta do Inno Setup) apontando para o abrir.ps1. Por enquanto não cria nada.
# Contrato (igual ao criar_atalho do instalar.sh): recebe a pasta; devolve $true se o atalho existe ao final e $false se não
# criou. Nunca derruba a instalação: quem chama só muda a última linha do resumo.
function AnvCriarAtalho {
  param([string]$Pasta)
  AnvRegistrar "atalho: ponto de chamada ainda vazio (fatia U6); nada foi criado para $Pasta"
  return $false
}

# Passo 9. Só cria; nunca sobrescreve a escolha da pessoa.
function AnvGravarAtualizacao {
  param([string]$Pasta, [bool]$BunGerenciado)
  $arquivo = Join-Path $Pasta '.anvilore\atualizacao.json'
  if (Test-Path -LiteralPath $arquivo) { return }
  $json = '{"versao":1,"modo":"automatico","canal":"estavel","autoCommit":true,"githubBackup":false,"bunGerenciado":' + $(if ($BunGerenciado) { 'true' } else { 'false' }) + "}`n"
  # ASCII e sem BOM: o Bun lê com JSON.parse e um BOM quebraria a leitura.
  Set-Content -LiteralPath $arquivo -Value $json -NoNewline -Encoding ASCII
}

function AnvResultadoFinal {
  param([bool]$TemAgente, [bool]$DoctorOk, [string]$Pasta = '', [string]$Versao = '', [bool]$SemRg = $false, [bool]$Atalho = $false)
  $linhas = @()
  if (-not $TemAgente) {
    $linhas += 'O Anvilore está instalado, mas falta um agente (Claude Code, Codex, Gemini ou Copilot).'
    $linhas += "Pasta: $Pasta"
    $linhas += 'Instale um agente e rode o instalador de novo - ele só completa o que falta.'
    return [pscustomobject]@{ Codigo = 10; Linhas = $linhas }
  }
  if (-not $DoctorOk) {
    $linhas += 'A instalação terminou, mas a conferência final (doctor) encontrou problemas.'
    $linhas += "Os detalhes estão em $Pasta\.anvilore\instalacao.log"
    return [pscustomobject]@{ Codigo = 1; Linhas = $linhas }
  }
  $linhas += "Anvilore $Versao instalado."
  $linhas += "Pasta: $Pasta"
  $linhas += $(if ($Atalho) { 'Próximo passo: abra o atalho Anvilore no Menu Iniciar.' } else { 'Próximo passo: abra o seu agente (por exemplo o Claude Code) dentro dessa pasta.' })
  $linhas += 'Feche e abra o terminal e o agente para o PATH novo valer.'
  if ($SemRg) { $linhas += 'Aviso: sem o ripgrep (rg) a busca da skill de consulta fica indisponível até você instalá-lo.' }
  return [pscustomobject]@{ Codigo = 0; Linhas = $linhas }
}

function AnvConfigurarUtf8 {
  $antes = $null
  try {
    $antes = [Console]::OutputEncoding
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [Console]::OutputEncoding = $utf8
    $global:OutputEncoding = $utf8
  } catch {
    # Constrained Language Mode não deixa mexer em [Console]: o chcp faz o mesmo efeito para os programas filhos.
    try { & chcp.com 65001 | Out-Null } catch { }
  }
  return $antes
}

function AnvPassos {
  $plataforma = AnvPlataforma
  if (-not $plataforma) { AnvParar 2 'Este instalador é para Windows 10 ou 11 de 64 bits (x64). Este computador não é suportado.' }
  # Sem a chave de assinatura embutida nada do que vem da internet pode ser conferido: para antes de baixar qualquer coisa.
  if (-not (AnvAssinantes)) {
    AnvParar 3 'Este instalador não traz a chave de assinatura do Anvilore, então não consigo conferir a versão. Por segurança, não instalei nada. Baixe o instalador oficial de novo.'
  }
  $perfil = AnvVariavel 'USERPROFILE'
  $local = AnvVariavel 'LOCALAPPDATA'
  if (-not $perfil -or -not $local) { AnvParar 1 'Não achei a sua pasta de usuário (USERPROFILE/LOCALAPPDATA).' }
  $temp = Join-Path (AnvVariavel 'TEMP') ('anvilore-instalador-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  try {
    AnvConfigurarTls
    $manifesto = AnvLerManifesto
    if ((AnvModoLinguagem) -ne 'FullLanguage') { AnvRegistrar "modo de linguagem restrito ($(AnvModoLinguagem)): uso reg.exe" }

    # 1 · sistema
    AnvEscrever "Anvilore - instalação para Windows ($plataforma). Nada aqui pede administrador."

    # 2 · git
    $git = AnvGit
    if (-not $git.Ok) {
      AnvEscrever "Preciso do Git: $($git.Motivo)."
      if (-not (AnvConfirmar -Pergunta 'Posso baixar o Git portátil (cerca de 392 MB) para a sua pasta de usuário? Não pede administrador.' -Padrao $true)) {
        AnvParar 1 'Sem o Git não consigo continuar.'
      }
      $git = AnvInstalarPortableGit -Manifesto $manifesto -Plataforma $plataforma -PastaGit (Join-Path $local 'Anvilore\git') -Temp $temp
    } else { AnvEscrever 'Git encontrado.' }

    # 3 · bun   4 · rg
    $bunGerenciado = AnvGarantirBun -Manifesto $manifesto -Plataforma $plataforma -PastaBun (Join-Path $perfil '.bun\bin') -Temp $temp -MarcadorBun (Join-Path $local 'Anvilore\bun-gerenciado.txt')
    $temRg = AnvGarantirRg -Manifesto $manifesto -Plataforma $plataforma -PastaBin (Join-Path $local 'Anvilore\bin') -Temp $temp
    $bun = AnvComando 'bun'

    # 5 · pasta
    $pasta = AnvEscolherPasta -Perfil $perfil
    $jaInstalado = AnvEhInstalacao -Pasta $pasta

    # 6 · kit
    if ($jaInstalado) {
      AnvEscrever "Já existe uma instalação em $pasta. Só vou conferir o que falta; nada da pasta é sobrescrito."
      AnvDefinirLog -Pasta $pasta
      $versao = ''
      $at = AnvExecutar $bun @('src/cli.ts', 'atualizar') $pasta
      if ($at.Codigo -eq 0) { AnvEscrever ('Atualização: ' + (($at.Saida -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1))) }
      else { AnvAviso ('não atualizei agora (' + (($at.Saida -split "`n" | Select-Object -First 1)) + '). Segui com a versão instalada.') }
      $v = AnvExecutar $git.Exe @('-C', $pasta, 'describe', '--tags', '--exact-match')
      if ($v.Codigo -eq 0) { $versao = $v.Saida.Trim() }
    } else {
      $versao = AnvBaixarKit -Git $git.Exe -Pasta $pasta -Perfil $perfil -Temp $temp
      AnvDefinirLog -Pasta $pasta
    }
    AnvRegistrar "pasta: $pasta ; versão: $versao ; plataforma: $plataforma"

    # 7 · agentes
    $agentes = AnvAgentes
    if (@($agentes).Count -eq 0) { AnvOferecerClaudeCode; $agentes = AnvAgentes }
    AnvEscrever $(if (@($agentes).Count) { "Agentes encontrados: $($agentes -join ', ')." } else { 'Nenhum agente encontrado.' })

    # 8 · dependências do kit e configuração dos agentes (commit automático ligado, backup no GitHub desligado - D6)
    $dep = AnvExecutar $bun @('install', '--frozen-lockfile') $pasta
    if ($dep.Codigo -ne 0) { AnvParar 1 "Não consegui instalar as dependências do kit: $($dep.Saida)" }
    $ins = AnvExecutar $bun @('src/cli.ts', 'instalar', '--destino', $pasta, '--auto-commit') $pasta
    if ($ins.Codigo -ne 0) { AnvParar 1 "A configuração dos agentes falhou (código $($ins.Codigo)): $($ins.Saida)" }
    $linhaInstalados = ($ins.Saida -split "`n" | Where-Object { $_ -match '^instalados:' } | Select-Object -First 1)
    foreach ($a in $agentes) {
      if (-not $linhaInstalados -or $linhaInstalados -notmatch "\b$a\b") { AnvAviso "o agente $a foi encontrado, mas não aparece como instalado." }
    }

    # 9 · atualização automática
    AnvGravarAtualizacao -Pasta $pasta -BunGerenciado $bunGerenciado

    # 10 · atalhos (U6)
    $atalho = [bool](AnvCriarAtalho -Pasta $pasta)

    # 11 · prova final
    $doc = AnvExecutar $bun @('src/cli.ts', 'doctor') $pasta
    foreach ($l in ($doc.Saida -split "`n")) { if ($l.Trim()) { AnvRegistrar "doctor: $l" } }
    $res = AnvResultadoFinal -TemAgente (@($agentes).Count -gt 0) -DoctorOk ($doc.Codigo -eq 0) -Pasta $pasta -Versao $versao -SemRg (-not $temRg) -Atalho $atalho
    foreach ($l in $res.Linhas) { AnvEscrever $l }
    if ((AnvVariavel 'ANVILORE_ESPERAR_ENTER') -eq '1' -and (AnvVariavel 'ANVILORE_SEM_PERGUNTAS') -ne '1') { [void](Read-Host 'Pressione Enter para fechar esta janela') }
    return $res.Codigo
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function AnvInstalar {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $codificacaoAntes = AnvConfigurarUtf8
  $codigo = 1
  try {
    $saida = @(AnvPassos)
    $codigo = [int]$saida[-1]
  } catch {
    $msg = $_.Exception.Message
    $m = [regex]::Match($msg, '^ANV-PARAR:(\d+):(.*)$', 'Singleline')
    if ($m.Success) { $codigo = [int]$m.Groups[1].Value; AnvEscrever $m.Groups[2].Value }
    else { $codigo = 1; AnvEscrever "Erro inesperado: $msg" }
  } finally {
    AnvRegistrar "fim, código $codigo"
    if ($script:AnvLogPendente.Count -gt 0) {
      # Parou antes de existir a pasta: deixa o registro perto do que a pessoa conhece.
      try {
        $dir = Join-Path (AnvVariavel 'LOCALAPPDATA') 'Anvilore'
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Add-Content -LiteralPath (Join-Path $dir 'instalacao.log') -Value $script:AnvLogPendente -Encoding UTF8
        $script:AnvLogPendente = @()
      } catch { }
    }
    if ($codificacaoAntes) { try { [Console]::OutputEncoding = $codificacaoAntes } catch { } }
  }
  $script:AnvCodigoDeSaida = $codigo
}

if ((AnvVariavel 'ANVILORE_PS1_SO_FUNCOES') -ne '1') {
  AnvInstalar
  $global:LASTEXITCODE = $script:AnvCodigoDeSaida
}
