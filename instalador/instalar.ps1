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
# >>> ANVILORE:BASE_MINIMA (preenchido na release por scripts/embutir-instalador.ts; não edite)
$script:AnvBaseMinimaEmbutida = @'
'@
# <<< ANVILORE:BASE_MINIMA
# >>> ANVILORE:URL_CONFIANCA (preenchido na release por scripts/embutir-instalador.ts; não edite)
$script:AnvUrlConfiancaEmbutida = @'
'@
# <<< ANVILORE:URL_CONFIANCA

$script:AnvSemVerSimples = '^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\z'
$script:AnvMsgPastaNova = 'Instale o Anvilore numa pasta nova e peça ao seu agente para trazer a sua wiki para lá de forma conferida, fazendo antes uma cópia de segurança dela.'
$script:AnvOrigemPadrao = 'https://github.com/iagofrota/anvilore.git'
$script:AnvChaveEnv = 'HKCU:\Environment'
$script:AnvLogPendente = @()
$script:AnvArquivoLog = $null
$script:AnvCodigoDeSaida = 1
$script:AnvRecusaTransporte = $false
$script:AnvMensagemTransporte = 'O Git deste computador está configurado para abrir um tipo de conexão que o instalador não aceita (por segurança, só uso a conexão segura com o GitHub). Não instalei nada.'

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

# Roda o programa com variáveis de ambiente só durante a chamada; ao terminar, cada uma volta ao valor que tinha (ou deixa de
# existir). `Env:` e não [Environment]:: porque também funciona no Constrained Language Mode.
function AnvExecutarComAmbiente {
  param([string]$Exe, [string[]]$Argumentos = @(), [string]$Pasta = '', $Ambiente = @{})
  $antes = @{}
  foreach ($k in @($Ambiente.Keys)) {
    $item = Get-Item -LiteralPath "Env:$k" -ErrorAction SilentlyContinue
    $antes[$k] = if ($item) { [string]$item.Value } else { $null }
    Set-Item -LiteralPath "Env:$k" -Value ([string]$Ambiente[$k])
  }
  try { return (AnvExecutar -Exe $Exe -Argumentos $Argumentos -Pasta $Pasta) }
  finally {
    foreach ($k in @($antes.Keys)) {
      if ($null -eq $antes[$k]) { Remove-Item -LiteralPath "Env:$k" -ErrorAction SilentlyContinue }
      else { Set-Item -LiteralPath "Env:$k" -Value $antes[$k] }
    }
  }
}

function AnvExecutarRede {
  param([string]$Exe, [string[]]$Argumentos, [string]$Origem)
  return (AnvExecutarComAmbiente -Exe $Exe -Argumentos $Argumentos -Ambiente (AnvAmbienteRede -Origem $Origem))
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
  param([string]$Git, [string]$Origem, [string]$HooksVazio)
  if ($Origem -eq $script:AnvOrigemPadrao) {
    try {
      $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/iagofrota/anvilore/releases/latest' -Headers @{ 'User-Agent' = 'anvilore-instalador' } -ErrorAction Stop
      if ($r.tag_name -match '^v\d+\.\d+\.\d+$') { return [string]$r.tag_name }
    } catch { AnvRegistrar "API de releases indisponível: $($_.Exception.Message)" }
  }
  $r = AnvExecutarRede -Exe $Git -Argumentos (AnvArgsLsRemote -Origem $Origem -HooksVazio $HooksVazio) -Origem $Origem
  if ($r.Codigo -ne 0) { if (AnvRecusouTransporte $r.Saida) { $script:AnvRecusaTransporte = $true }; return $null }
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

# Enquanto a assinatura não passa, nenhum hook roda: core.hooksPath aponta para uma pasta vazia e vence o que a configuração
# global da pessoa disser. Filtros de checkout (smudge, git-lfs) nem chegam a rodar: o clone é --no-checkout.
function AnvArgsStaging {
  param([string]$HooksVazio, [string[]]$Argumentos)
  return @('-c', "core.hooksPath=$HooksVazio") + $Argumentos
}

# git que fala com a rede ANTES de a assinatura passar (ls-remote e clone). Além dos hooks desligados, o helper de credencial
# e o askpass da configuração da pessoa ficam zerados: nenhum programa dela roda aqui. O protocolo é limitado pelo ambiente
# (AnvAmbienteRede). Os argumentos vêm antes do verbo (`clone`, `ls-remote`).
function AnvArgsRede {
  param([string]$HooksVazio, [string[]]$Argumentos)
  return AnvArgsStaging -HooksVazio $HooksVazio -Argumentos (@('-c', 'credential.helper=', '-c', 'core.askPass=') + $Argumentos)
}

function AnvArgsLsRemote {
  param([string]$Origem, [string]$HooksVazio)
  return AnvArgsRede -HooksVazio $HooksVazio -Argumentos @('ls-remote', '--tags', '--', $Origem)
}

function AnvArgsClone {
  param([string]$Origem, [string]$Tag, [string]$Staging, [string]$HooksVazio)
  return AnvArgsRede -HooksVazio $HooksVazio -Argumentos @('clone', '--quiet', '--no-checkout', '-c', 'core.autocrlf=false', '-c', 'advice.detachedHead=false', '--branch', $Tag, '--', $Origem, $Staging)
}

# Só o protocolo que a origem realmente usa: https na oficial (e em qualquer https); `file` para o caminho local que os testes
# usam; ssh só se a origem é ssh. ext::, fd::, git:// e http:// nunca entram: caem em https, que não os abre.
function AnvProtocolosDaOrigem {
  param([string]$Origem)
  if ($Origem -match '^ssh://') { return 'ssh' }
  if ($Origem -match '^file://' -or $Origem -match '^[A-Za-z]:[\\/]' -or $Origem -match '^\\\\' -or $Origem -match '^/') { return 'file' }
  return 'https'
}

# GIT_ALLOW_PROTOCOL vence qualquer protocol.<nome>.allow da configuração da pessoa (inclusive um protocol.ext.allow=always,
# que deixaria um url.<ext::programa>.insteadOf executar código). Sem prompt de terminal. GIT_ASKPASS aponta para `false`
# porque no Windows uma variável vazia deixa de existir e o askpass da pessoa voltaria a valer.
function AnvAmbienteRede {
  param([string]$Origem)
  return [ordered]@{ GIT_ALLOW_PROTOCOL = (AnvProtocolosDaOrigem -Origem $Origem); GIT_TERMINAL_PROMPT = '0'; GIT_ASKPASS = 'false' }
}

# O git recusa o transporte com "transport 'ext' not allowed".
function AnvRecusouTransporte {
  param([string]$Saida)
  return ($Saida -match "transport '[^']*' not allowed")
}

# Só agora, com o commit autenticado, os arquivos da candidata são gravados.
function AnvArgsCheckout {
  param([string]$Staging, [string]$Commit)
  return @('-C', $Staging, 'checkout', '--quiet', '--force', '--detach', $Commit)
}

function AnvArgsVerificarTag {
  param([string]$Staging, [string]$Ref, [string]$Assinantes, [string]$HooksVazio)
  # gpg.ssh.program fixo: um verificador SSH da configuração global da pessoa poderia aprovar uma assinatura de chave que não
  # é a embutida. false: programa que sempre falha, para o caso de uma assinatura OpenPGP/x509 chegar ao git.
  return AnvArgsStaging -HooksVazio $HooksVazio -Argumentos @('-C', $Staging, '-c', 'gpg.format=ssh', '-c', 'gpg.ssh.program=ssh-keygen', '-c', 'gpg.program=false', '-c', 'gpg.openpgp.program=false', '-c', 'gpg.x509.program=false', '-c', "gpg.ssh.allowedSignersFile=$Assinantes", 'verify-tag', $Ref)
}

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

# Pasta instalada = a estrutura do kit (.git, AGENTS.md, src\cli.ts, skills\). O mesmo critério do instalar.sh. Não exige o
# estado da atualização (uma pasta de antes do atualizador, como a v0.2.0, não o tem e PRECISA cair no teste da base mínima,
# com a mensagem certa, em vez de ser tratada como "outra coisa") nem o conteúdo do package.json (a versão é lida depois,
# pela base mínima, e package.json ausente ou ilegível é um motivo de recusa, não de pasta desconhecida).
function AnvEhInstalacao {
  param([string]$Pasta)
  return ((Test-Path -LiteralPath (Join-Path $Pasta '.git') -PathType Container) -and
    (Test-Path -LiteralPath (Join-Path $Pasta 'AGENTS.md') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $Pasta 'src\cli.ts') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $Pasta 'skills') -PathType Container))
}

# ---------------------------------------------------------------- base mínima

# A menor versão do Anvilore que este instalador aceita reinstalar (a primeira versão assinada), embutida na release.
# Só vale um X.Y.Z (sem v, pré-release nem metadado de build); vazia ou inválida: nulo, e o instalador não reinstala.
function AnvBaseMinima {
  param([string]$Embutido = $script:AnvBaseMinimaEmbutida)
  $t = $Embutido -replace '\r?\n\z', ''
  if ($t -cmatch $script:AnvSemVerSimples) { return $t }
  return $null
}

# A versão do package.json da pasta, ou nulo. Só lê o arquivo como texto: nada da pasta é executado, importado nem carregado
# (nem Bun, nem Git, nem script). Ausente, pasta no lugar do arquivo, bytes que não são UTF-8, JSON inválido, raiz que não é
# objeto, version que não é texto ou que não é um X.Y.Z (pré-release, v na frente, zero à esquerda) valem nulo.
function AnvLerVersaoDaPasta {
  param([string]$Pasta)
  try {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $Pasta 'package.json'))
    $texto = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes).TrimStart([char]0xFEFF)
    $pacote = ConvertFrom-Json -InputObject $texto
  } catch { return $null }
  if ($pacote -isnot [System.Management.Automation.PSCustomObject]) { return $null }
  $propriedade = $pacote.PSObject.Properties['version']
  if (-not $propriedade -or $propriedade.Value -isnot [string]) { return $null }
  if ($propriedade.Value -cnotmatch $script:AnvSemVerSimples) { return $null }
  return $propriedade.Value
}

# @{ Ok; Motivo = '' | 'antiga' | 'desconhecida'; Versao }. Menor que a base: antiga. Não lida ou não reconhecida: desconhecida.
function AnvVerificarBaseMinima {
  param([string]$Pasta, [string]$Base)
  $versao = AnvLerVersaoDaPasta -Pasta $Pasta
  if (-not $versao) { return @{ Ok = $false; Motivo = 'desconhecida'; Versao = '' } }
  if ((AnvCompararVersao $versao $Base) -lt 0) { return @{ Ok = $false; Motivo = 'antiga'; Versao = $versao } }
  return @{ Ok = $true; Motivo = ''; Versao = $versao }
}

# Linguagem simples, sem comando técnico. 'atualizador' é a defesa em profundidade: o atualizador da pasta respondeu com o uso (código 2).
function AnvMensagemBaseMinima {
  param([string]$Pasta, $Resultado, [string]$Base)
  if ($Resultado.Motivo -eq 'antiga') {
    return "A pasta $Pasta tem o Anvilore na versão $($Resultado.Versao), anterior à primeira versão assinada ($Base). Por segurança, não executei nada dela e nada foi mudado. $script:AnvMsgPastaNova"
  }
  if ($Resultado.Motivo -eq 'atualizador') {
    return "O atualizador dessa pasta é de uma versão anterior à primeira versão assinada e não sabe receber as chaves do instalador; nada foi mudado. $script:AnvMsgPastaNova"
  }
  return "Não reconheço a versão do Anvilore na pasta $Pasta (o package.json está ausente, ilegível ou não é uma versão publicada). Por segurança, não executei nada dela e nada foi mudado. $script:AnvMsgPastaNova"
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
# ---------------------------------------------------------------- estado das chaves (a lista do site)

# Antes de aceitar a tag (instalação nova) e antes de executar o atualizador da pasta (reinstalação), o instalador consulta a
# lista de chaves que o dono publica no site dele (confianca.json) e só vale a INTERSEÇÃO dela com as chaves embutidas: o site
# nunca acrescenta uma chave, e uma chave retirada dele deixa de valer mesmo com assinatura válida. O endereço também vem
# EMBUTIDO (nunca de variável de ambiente). Sem cache e sem fallback: se não conseguir consultar, para.
$script:AnvLimiteConfianca = 65536

# O endereço embutido: https, ou http só em loopback (127.0.0.1: build de teste; o embutir só o aceita com a flag de teste).
function AnvUrlConfianca {
  param([string]$Embutido = $script:AnvUrlConfiancaEmbutida)
  $t = $Embutido -replace '\r?\n\z', ''
  if ($t -cmatch '^https://[A-Za-z0-9._~:/-]+\z') { return $t }
  if ($t -cmatch '^http://127\.0\.0\.1(?::[0-9]+)?/[A-Za-z0-9._~/-]*\z') { return $t }
  return $null
}

# Validação estrita do documento: { formato: 1, chaves: ["SHA256:..."], versaoMinima: "X.Y.Z" }. Campo extra, tipo errado,
# formato diferente de 1, chaves vazia ou repetida e versão com pré-release valem nulo.
function AnvValidarConfianca {
  param([string]$Texto)
  # Nome repetido falha fechado (o ConvertFrom-Json do PS 5.1 não distingue qual ocorrência vale). Cada nome tem de aparecer uma
  # só vez no texto bruto, como no instalar.sh; um documento legítimo não tem barra invertida, então um escape (que poderia
  # esconder um nome repetido, como "versaoMinim\u0061") também é recusado.
  if ($Texto.Contains('\')) { return $null }
  foreach ($n in @('"chaves"', '"formato"', '"versaoMinima"')) {
    if ([regex]::Matches($Texto, $n + '\s*:').Count -ne 1) { return $null }
  }
  try { $j = ConvertFrom-Json -InputObject $Texto -ErrorAction Stop } catch { return $null }
  if ($j -isnot [System.Management.Automation.PSCustomObject]) { return $null }
  $nomes = @($j.PSObject.Properties | ForEach-Object { $_.Name })
  if ($nomes.Count -ne 3 -or ($nomes -cnotcontains 'chaves') -or ($nomes -cnotcontains 'formato') -or ($nomes -cnotcontains 'versaoMinima')) { return $null }
  $f = $j.formato
  if (-not (($f -is [int] -or $f -is [long]) -and $f -eq 1)) { return $null }
  $c = $j.chaves
  if ($c -isnot [array] -or @($c).Count -eq 0) { return $null }
  $vistas = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach ($k in $c) {
    if ($k -isnot [string] -or $k -cnotmatch '^SHA256:[A-Za-z0-9+/]{43}\z') { return $null }
    if (-not $vistas.Add($k)) { return $null }
  }
  $v = $j.versaoMinima
  if ($v -isnot [string] -or $v -cnotmatch $script:AnvSemVerSimples) { return $null }
  return [pscustomobject]@{ Chaves = [string[]]@($c); VersaoMinima = $v }
}

# Busca a lista com HttpWebRequest e devolve StatusCode e Content (texto). O limite de 64 KiB vale DURANTE a leitura: o stream é
# lido em blocos e o pedido é abortado ao passar do limite (o Invoke-WebRequest materializa o corpo inteiro antes de qualquer
# conferência). Sem seguir redirecionamento (3xx volta como resposta e é recusado por quem chama), 15 s no total.
function AnvLerConfiancaHttp {
  param([string]$Url, [hashtable]$Cabecalhos)
  $relogio = [System.Diagnostics.Stopwatch]::StartNew()
  $req = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Url)
  $req.Method = 'GET'
  $req.AllowAutoRedirect = $false
  $req.Timeout = 15000
  $req.ReadWriteTimeout = 15000
  $req.AutomaticDecompression = [System.Net.DecompressionMethods]::None
  $req.UserAgent = 'Anvilore-instalador'
  foreach ($k in $Cabecalhos.Keys) { $req.Headers[$k] = $Cabecalhos[$k] }
  $resposta = $null
  $memoria = $null
  try {
    try { $resposta = $req.GetResponse() }
    catch [System.Net.WebException] { if ($_.Exception.Response) { $resposta = $_.Exception.Response } else { throw } }
    $status = [int]$resposta.StatusCode
    if ($status -ne 200) { return [pscustomobject]@{ StatusCode = $status; Content = '' } }
    if ($resposta.ContentLength -gt $script:AnvLimiteConfianca) { $req.Abort(); throw 'resposta maior que o limite' }
    $fluxo = $resposta.GetResponseStream()
    $memoria = New-Object System.IO.MemoryStream
    $bloco = New-Object byte[] 4096
    while ($true) {
      $restante = 15000 - [int][Math]::Ceiling($relogio.Elapsed.TotalMilliseconds)
      if ($restante -le 0) { $req.Abort(); throw 'tempo limite' }
      $fluxo.ReadTimeout = $restante
      try { $n = $fluxo.Read($bloco, 0, $bloco.Length) }
      catch [System.IO.IOException] { $req.Abort(); throw 'tempo limite' }
      if ($n -le 0) { break }
      $memoria.Write($bloco, 0, $n)
      if ($memoria.Length -gt $script:AnvLimiteConfianca) { $req.Abort(); throw 'resposta maior que o limite' }
      if ($relogio.ElapsedMilliseconds -ge 15000) { $req.Abort(); throw 'tempo limite' }
    }
    $texto = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($memoria.ToArray())
    return [pscustomobject]@{ StatusCode = $status; Content = $texto }
  } finally {
    if ($memoria) { $memoria.Dispose() }
    if ($resposta) { try { $resposta.Close() } catch { } }
  }
}

# Consulta a lista. Ok = $true com Chaves e VersaoMinima, ou Ok = $false com a Mensagem simples. Sem seguir redirecionamento
# (redirect = recusa), com Cache-Control e Pragma no-cache, 15 s e 64 KiB (AnvLerConfiancaHttp). `-Buscar` só para teste: recebe
# a URL e os cabeçalhos.
function AnvConsultarConfianca {
  param([string]$Url, [scriptblock]$Buscar = $null)
  $falha = "não consegui conferir a lista atual de chaves em $Url; nada mudou; tente de novo mais tarde."
  $cabecalhos = @{ 'Cache-Control' = 'no-cache'; 'Pragma' = 'no-cache' }
  try {
    if ($Buscar) { $r = & $Buscar $Url $cabecalhos }
    else { $r = AnvLerConfiancaHttp -Url $Url -Cabecalhos $cabecalhos }
    if ([int]$r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
    $conteudo = $r.Content
    if ($conteudo -is [byte[]]) { $conteudo = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($conteudo) }
    $conteudo = [string]$conteudo
    if ([System.Text.Encoding]::UTF8.GetByteCount($conteudo) -gt $script:AnvLimiteConfianca) { throw 'resposta maior que o limite' }
    $doc = AnvValidarConfianca -Texto $conteudo
    if (-not $doc) { throw 'documento inválido' }
  } catch {
    AnvRegistrar "consulta da lista de chaves falhou: $($_.Exception.Message)"
    return @{ Ok = $false; Motivo = $falha }
  }
  return @{ Ok = $true; Chaves = $doc.Chaves; VersaoMinima = $doc.VersaoMinima }
}

# A fingerprint (a do `ssh-keygen -lf`) da chave de uma linha allowed_signers: principal [opções] tipo chave-base64 [comentário].
# Calculada aqui (SHA-256 do blob, base64 sem preenchimento) para não depender de um binário.
function AnvImpressaoDaLinha {
  param([string]$Linha)
  $t = $Linha.Trim()
  if (-not $t -or $t.StartsWith('#')) { return $null }
  $palavras = @([regex]::Matches($t, '(?:[^\s"]|"[^"]*")+') | ForEach-Object { $_.Value })
  for ($i = 1; $i + 1 -lt $palavras.Count; $i++) {
    $tipo = $palavras[$i]
    if ($tipo -cnotmatch '^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\z') { continue }
    $b64 = $palavras[$i + 1]
    if ($b64 -cnotmatch '^[A-Za-z0-9+/]+={0,2}\z') { return $null }
    try { $blob = [Convert]::FromBase64String($b64) } catch { return $null }
    if ($blob.Length -lt 4) { return $null }
    $n = ([int]$blob[0] -shl 24) -bor ([int]$blob[1] -shl 16) -bor ([int]$blob[2] -shl 8) -bor [int]$blob[3]
    if ($n -ne $tipo.Length -or $blob.Length -lt (4 + $n)) { return $null }
    if ([System.Text.Encoding]::ASCII.GetString($blob, 4, $n) -cne $tipo) { return $null }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $h = $sha.ComputeHash($blob) } finally { $sha.Dispose() }
    return ('SHA256:' + [Convert]::ToBase64String($h).TrimEnd('='))
  }
  return $null
}

# Só as linhas das chaves embutidas cuja fingerprint está na lista (a interseção); vazio se não sobra nenhuma.
function AnvFiltrarAssinantes {
  param([string]$Texto, [string[]]$Chaves)
  $saida = @()
  foreach ($l in ($Texto -split "`r?`n")) {
    $fp = AnvImpressaoDaLinha -Linha $l
    if ($fp -and ($Chaves -ccontains $fp)) { $saida += $l.Trim() }
  }
  if (@($saida).Count -eq 0) { return '' }
  return ((@($saida) -join "`n") + "`n")
}

# A pasta instalada precisa estar na versão mínima da lista (versões que não são X.Y.Z nunca passam).
function AnvVersaoDaPastaAtendeMinima {
  param([string]$Versao, [string]$Minima)
  if ($Versao -cnotmatch $script:AnvSemVerSimples -or $Minima -cnotmatch $script:AnvSemVerSimples) { return $false }
  return ((AnvCompararVersao $Versao $Minima) -ge 0)
}

# Consulta e confere. Ok = $true com Assinantes (a interseção, para o verify-tag ou para a opção --assinantes-do-instalador) e
# VersaoMinima, ou Ok = $false com o Motivo em linguagem simples. `Tag` vazia: reinstalação (quem escolhe a candidata é o
# atualizador da pasta, que consulta de novo).
function AnvConferirEstadoDasChaves {
  param([string]$Tag, [string]$Url = (AnvUrlConfianca), [string]$Assinantes = (AnvAssinantes), [scriptblock]$Buscar = $null)
  $endereco = AnvUrlConfianca -Embutido $Url
  if (-not $endereco) {
    return @{ Ok = $false; Motivo = 'Este instalador não traz o endereço da lista atual de chaves (ou ele é inseguro), então não consigo conferir se a chave de assinatura ainda vale. Por segurança, não instalei nada. Baixe o instalador oficial de novo.' }
  }
  if (-not $Assinantes) {
    return @{ Ok = $false; Motivo = 'Este instalador não traz a chave de assinatura do Anvilore, então não consigo conferir a versão. Por segurança, não instalei nada. Baixe o instalador oficial de novo.' }
  }
  $c = AnvConsultarConfianca -Url $endereco -Buscar $Buscar
  if (-not $c.Ok) { return @{ Ok = $false; Motivo = $c.Motivo } }
  $permitidas = AnvFiltrarAssinantes -Texto $Assinantes -Chaves $c.Chaves
  if (-not $permitidas) {
    return @{ Ok = $false; Motivo = 'A lista atual de chaves do site não inclui a chave de assinatura deste instalador; não instalei nem mudei nada. Baixe o instalador mais recente pelo canal oficial.' }
  }
  if ($Tag) {
    $candidata = $Tag -replace '^v', ''
    $numeros = $candidata -replace '[-+].*$', ''
    $comparacao = if ($numeros -cmatch $script:AnvSemVerSimples) { AnvCompararVersao $numeros $c.VersaoMinima } else { -1 }
    # Uma pré-release é anterior à versão final de mesmo número.
    if ($comparacao -lt 0 -or ($comparacao -eq 0 -and $candidata -ne $numeros)) {
      return @{ Ok = $false; Motivo = "A lista atual do site exige a versão $($c.VersaoMinima) ou mais nova e a $Tag é mais antiga; não instalei nada. Baixe o instalador mais recente pelo canal oficial." }
    }
  }
  return @{ Ok = $true; Assinantes = $permitidas; VersaoMinima = $c.VersaoMinima; Chaves = $c.Chaves }
}

# Pasta de passagem do download: NOVA e única a cada execução, ao lado do destino (mesmo volume, para o Move-Item final ser só
# uma renomeação). Nunca reaproveita um nome nem apaga nada que já existia: New-Item sem -Force falha se o caminho existe, e
# então sorteia outro nome. Quem chamou é o dono da pasta devolvida e o único que a apaga.
function AnvCriarStaging {
  param([string]$Pai)
  if (-not (Test-Path -LiteralPath $Pai -PathType Container)) { New-Item -ItemType Directory -Path $Pai -Force | Out-Null }
  for ($i = 0; $i -lt 5; $i++) {
    $candidato = Join-Path $Pai ('Anvilore.novo-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
    try { New-Item -ItemType Directory -Path $candidato -ErrorAction Stop | Out-Null; return $candidato } catch { }
  }
  AnvParar 1 "Não consegui criar uma pasta temporária nova em $Pai. Confira o espaço e a permissão da pasta e rode o instalador de novo."
}

function AnvBaixarKit {
  param([string]$Git, [string]$Pasta, [string]$Perfil, [string]$Temp)
  $assinantes = AnvAssinantes
  if (-not $assinantes) {
    AnvParar 3 'Este instalador não traz a chave de assinatura do Anvilore, então não consigo conferir a versão. Por segurança, não instalei nada. Baixe o instalador oficial de novo.'
  }
  $origem = AnvVariavel 'ANVILORE_ORIGEM'
  if (-not $origem) { $origem = $script:AnvOrigemPadrao }
  $fixa = AnvVariavel 'ANVILORE_VERSAO'
  $semHooks = Join-Path $Temp 'sem-hooks'
  New-Item -ItemType Directory -Path $semHooks -Force | Out-Null
  $script:AnvRecusaTransporte = $false
  $tag = if ($fixa) { 'v' + $fixa.TrimStart('v') } else { AnvDescobrirTag -Git $Git -Origem $origem -HooksVazio $semHooks }
  if (-not $tag -and $script:AnvRecusaTransporte) { AnvParar 3 $script:AnvMensagemTransporte }
  if (-not $tag) { AnvParar 1 'Não achei nenhuma versão publicada do Anvilore para instalar.' }
  AnvEscrever 'Conferindo a lista atual de chaves de assinatura...'
  $estadoChaves = AnvConferirEstadoDasChaves -Tag $tag
  if (-not $estadoChaves.Ok) { AnvParar 3 $estadoChaves.Motivo }
  AnvEscrever "Baixando o Anvilore $tag..."
  $assinFile = Join-Path $Temp 'assinantes'
  Set-Content -LiteralPath $assinFile -Value $estadoChaves.Assinantes -NoNewline -Encoding ASCII
  $env:GIT_TERMINAL_PROMPT = '0'
  $staging = AnvCriarStaging -Pai (Split-Path -Parent $Pasta)
  $movido = $false
  try {
    $clone = AnvExecutarRede -Exe $Git -Argumentos (AnvArgsClone -Origem $origem -Tag $tag -Staging $staging -HooksVazio $semHooks) -Origem $origem
    if ($clone.Codigo -ne 0) {
      if (AnvRecusouTransporte $clone.Saida) { AnvParar 3 $script:AnvMensagemTransporte }
      AnvParar 1 "Não consegui baixar o Anvilore ($tag). Confira a internet e rode o instalador de novo. $($clone.Saida)"
    }
    $ref = "refs/tags/$tag"
    $razao = $null
    $verificado = $null
    $v = [pscustomobject]@{ Codigo = 0; Saida = '' }
    $tipo = AnvExecutar $Git (AnvArgsStaging -HooksVazio $semHooks -Argumentos @('-C', $staging, 'cat-file', '-t', $ref))
    $cab = AnvExecutar $Git (AnvArgsStaging -HooksVazio $semHooks -Argumentos @('-C', $staging, 'cat-file', 'tag', $ref))
    if ($tipo.Saida.Trim() -ne 'tag') { $razao = 'a versão não é uma tag anotada' }
    elseif (-not (AnvTemAssinaturaSsh -ConteudoDaTag $cab.Saida)) { $razao = 'a tag não tem assinatura SSH' }
    else {
      $v = AnvExecutar $Git (AnvArgsVerificarTag -Staging $staging -Ref $ref -Assinantes $assinFile -HooksVazio $semHooks)
      if ($v.Codigo -ne 0) { $razao = 'a assinatura não confere com a chave do Anvilore' }
      else {
        $head = AnvExecutar $Git (AnvArgsStaging -HooksVazio $semHooks -Argumentos @('-C', $staging, 'rev-parse', 'HEAD'))
        $razao = AnvIdentidadeDaTag -Cabecalho $cab.Saida -Tag $tag -Commit $head.Saida.Trim()
        if (-not $razao) { $verificado = $head.Saida.Trim() }
      }
    }
    if ($razao) {
      AnvRegistrar "verify-tag recusou $tag : $($v.Saida)"
      AnvParar 3 "A versão $tag não passou na conferência de segurança ($razao). Apaguei o que baixei, não liguei nenhum agente e não instalei nada."
    }
    AnvEscrever "Assinatura da versão $tag conferida."
    $co = AnvExecutar $Git (AnvArgsCheckout -Staging $staging -Commit $verificado)
    if ($co.Codigo -ne 0) {
      AnvParar 1 "Não consegui gravar os arquivos do Anvilore $tag. Apaguei o que baixei. $($co.Saida)"
    }
    if (Test-Path -LiteralPath $Pasta) { Remove-Item -LiteralPath $Pasta -Recurse -Force }
    Move-Item -LiteralPath $staging -Destination $Pasta
    $movido = $true
  } finally {
    # Só a pasta que ESTA execução criou: qualquer saída sem o Move-Item (recusa, falha, erro inesperado) a apaga.
    if (-not $movido) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
  }
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

# Passo 10 - atalho "Anvilore" (Menu Iniciar e Área de Trabalho, via .lnk;
# em Constrained Language Mode o atalho fica por conta do Inno Setup) apontando para o abrir.ps1.
# Contrato (igual ao criar_atalho do instalar.sh): recebe a pasta; devolve $true se o atalho existe ao final e $false se não
# criou. Nunca derruba a instalação: quem chama só muda a última linha do resumo.
function AnvCriarAtalho {
  param([string]$Pasta)
  if ((AnvVariavel 'ANVILORE_ATALHO_SETUP') -eq '1') {
    # A pasta pode ter mudado na pergunta sobre um destino ocupado. Persiste o valor resolvido,
    # como dados (nunca como código), para os atalhos do Inno não dependerem do ambiente do Explorer.
    $configSetup = AnvVariavel 'ANVILORE_CONFIG_SETUP'
    if ($configSetup) { Set-Content -LiteralPath $configSetup -Value $Pasta -Encoding UTF8 -NoNewline -ErrorAction Stop }
    AnvRegistrar 'atalho: criado pelo AnviloreSetup.exe'
    return $true
  }
  if ($ExecutionContext.SessionState.LanguageMode -eq 'ConstrainedLanguage') {
    AnvRegistrar 'atalho: Constrained Language Mode; o Inno Setup cria o atalho'
    return $false
  }
  $abrir = Join-Path $Pasta 'instalador\abrir.ps1'
  if (-not (Test-Path -LiteralPath $abrir -PathType Leaf)) {
    AnvRegistrar "atalho: abrir.ps1 não existe em $abrir"
    return $false
  }
  try {
    $powershell = (Get-Command powershell.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $powershell) { $powershell = (Get-Command pwsh.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source }
    if (-not $powershell) { AnvRegistrar 'atalho: PowerShell não foi encontrado'; return $false }
    $abrirLiteral = $abrir.Replace("'", "''")
    $pastaLiteral = $Pasta.Replace("'", "''")
    $argumentos = "-NoLogo -NoProfile -Command `"`$env:ANVILORE_PASTA = '$pastaLiteral'; `$env:ANVILORE_LANCADOR = '$abrirLiteral'; & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath `$env:ANVILORE_LANCADOR)))`""
    $shell = New-Object -ComObject WScript.Shell
    $programas = [Environment]::GetFolderPath('Programs')
    if ([string]::IsNullOrWhiteSpace($programas)) {
      $appData = AnvVariavel 'APPDATA'
      if (-not $appData) { AnvRegistrar 'atalho: APPDATA não está definido'; return $false }
      $programas = Join-Path $appData 'Microsoft\Windows\Start Menu\Programs'
    }
    $desktopDir = [Environment]::GetFolderPath('DesktopDirectory')
    if ([string]::IsNullOrWhiteSpace($desktopDir)) {
      $perfil = AnvVariavel 'USERPROFILE'
      if (-not $perfil) { AnvRegistrar 'atalho: USERPROFILE não está definido'; return $false }
      $desktopDir = Join-Path $perfil 'Desktop'
    }
    $pastaMenu = Join-Path $programas 'Anvilore'
    $atalhos = @(
      [pscustomobject]@{ Caminho = Join-Path $pastaMenu 'Anvilore.lnk'; Rotulo = 'Menu Iniciar' },
      [pscustomobject]@{ Caminho = Join-Path $desktopDir 'Anvilore.lnk'; Rotulo = 'Área de Trabalho' }
    )
    $criados = 0
    foreach ($item in $atalhos) {
      try {
        $null = New-Item -ItemType Directory -Path (Split-Path -Parent $item.Caminho) -Force
        $atalho = $shell.CreateShortcut($item.Caminho)
        $atalho.TargetPath = $powershell
        $atalho.Arguments = $argumentos
        $atalho.WorkingDirectory = $Pasta
        $atalho.Description = 'Abrir a interface do Anvilore'
        $atalho.IconLocation = "$powershell,0"
        $atalho.Save()
        if (Test-Path -LiteralPath $item.Caminho -PathType Leaf) { $criados++ }
        else { AnvRegistrar "atalho: não consegui criar o $($item.Rotulo)" }
      } catch { AnvRegistrar "atalho: não consegui criar o $($item.Rotulo): $($_.Exception.Message)" }
    }
    if ($criados -eq 2) {
      AnvRegistrar "atalho: Menu Iniciar e Área de Trabalho apontam para $abrir; ícone do PowerShell"
      return $true
    }
    return $false
  } catch {
    AnvRegistrar "atalho: não consegui criar os atalhos: $($_.Exception.Message)"
    return $false
  }
}

# Passo 8. Instalação nova liga o commit automático (D6). Reinstalação respeita a escolha da pessoa, gravada em autoCommit do
# atualizacao.json (como o instalar.sh): estado sem a chave ligada ou ilegível deixa desligado; sem estado nenhum (a primeira rodada
# parou antes do passo 9), liga como numa instalação nova.
function AnvAutoCommitDaPasta {
  param([string]$Pasta, [bool]$JaInstalado)
  if (-not $JaInstalado) { return $true }
  $arquivo = Join-Path $Pasta '.anvilore\atualizacao.json'
  if (-not (Test-Path -LiteralPath $arquivo -PathType Leaf)) { return $true }
  try { $estado = [IO.File]::ReadAllText($arquivo) | ConvertFrom-Json -ErrorAction Stop } catch { return $false }
  return [bool]($estado.autoCommit -is [bool] -and $estado.autoCommit)
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
  param([bool]$TemAgente, [bool]$DoctorOk, [string]$Pasta = '', [string]$Versao = '', [string[]]$Agentes = @(), [bool]$SemRg = $false, [bool]$Atalho = $false, [bool]$SemYtDlp = $false)
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
  $nomes = @($Agentes | ForEach-Object {
    switch ($_ ) {
      'claude' { 'Claude Code'; break }
      'codex' { 'Codex'; break }
      'gemini' { 'Gemini'; break }
      'copilot' { 'Copilot'; break }
      default { $_ }
    }
  })
  if ($nomes.Count -eq 1) {
    $listaAgentes = "Agente configurado: $($nomes[0])."
  } else {
    $anteriores = @($nomes[0..($nomes.Count - 2)]) -join ', '
    $listaAgentes = "Agentes configurados: $anteriores e $($nomes[-1])."
  }
  $versaoVisivel = if (-not $Versao) { '' } elseif ($Versao.StartsWith('v')) { "$Versao " } else { "v$Versao " }
  $linhas += "Pronto! Anvilore ${versaoVisivel}instalado em $Pasta."
  $linhas += $listaAgentes
  $linhas += ''
  $linhas += 'Para começar:'
  $linhas += '  1. Feche este terminal e os agentes que estiverem abertos, e abra de novo.'
  $linhas += $(if ($Atalho) { '  2. Abra o atalho Anvilore no Menu Iniciar.' } else { "  2. Abra o Claude Code (ou outro agente) na pasta $Pasta." })
  if ($SemRg) { $linhas += 'Aviso: sem o ripgrep (rg), a busca da skill de consulta usa a ferramenta do sistema e pode ser mais lenta. Para maior velocidade, instale o ripgrep (rg).' }
  if ($SemYtDlp) { $linhas += 'Aviso: sem o yt-dlp, a captura de vídeos do YouTube fica indisponível.' }
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
      # Base mínima: lê a versão da pasta SEM executar nada dela e recusa se for menor que a primeira versão assinada (ou se não
      # puder ser lida). Vem antes de qualquer escrita na pasta (o registro) e de qualquer execução (o atualizador, o Bun).
      $base = AnvBaseMinima
      if (-not $base) { AnvParar 3 'Este instalador não traz a base mínima (a primeira versão assinada), então não consigo saber se uma pasta antiga é segura. Por segurança, não mexi em nada. Baixe o instalador oficial de novo.' }
      $verificacao = AnvVerificarBaseMinima -Pasta $pasta -Base $base
      if (-not $verificacao.Ok) { AnvParar 1 (AnvMensagemBaseMinima -Pasta $pasta -Resultado $verificacao -Base $base) }
      # A lista atual de chaves também vem ANTES de executar qualquer coisa da pasta, e a versão mínima dela vale para o que já está instalado.
      $estadoChaves = AnvConferirEstadoDasChaves -Tag ''
      if (-not $estadoChaves.Ok) { AnvParar 3 $estadoChaves.Motivo }
      if (-not (AnvVersaoDaPastaAtendeMinima -Versao $verificacao.Versao -Minima $estadoChaves.VersaoMinima)) {
        AnvParar 1 "A pasta $pasta tem o Anvilore na versão $($verificacao.Versao), e a lista atual do site exige a versão $($estadoChaves.VersaoMinima) ou mais nova. Por segurança, não executei nada dela e nada foi mudado. $script:AnvMsgPastaNova"
      }
      AnvEscrever "Já existe uma instalação em $pasta. Só vou conferir o que falta; nada da pasta é sobrescrito."
      AnvDefinirLog -Pasta $pasta
      $versao = ''
      # O atualizador da pasta confere a tag com o seguranca/assinantes que a pasta já tem, e uma instalação que ficou para trás
      # na troca de chave não conhece a chave nova. Entrega a ele as chaves embutidas deste instalador pela opção
      # --assinantes-do-instalador (só nesta chamada; nada é gravado na pasta e nada passa por variável de ambiente, que um
      # `atualizar` manual ou agendado herdaria sem querer): com elas o atualizador confere a tag só contra o que este instalador traz.
      $assinReinstalacao = Join-Path $temp 'assinantes-reinstalacao'
      Set-Content -LiteralPath $assinReinstalacao -Value $estadoChaves.Assinantes -NoNewline -Encoding ASCII
      $at = AnvExecutar $bun @('src/cli.ts', 'atualizar', '--assinantes-do-instalador', $assinReinstalacao) $pasta
      # Código 2 = uso inválido: o atualizador da pasta é de uma versão que não conhece a opção. Não esconde o erro nem segue
      # como se tivesse conferido (nada foi mudado).
      if ($at.Codigo -eq 2) { AnvParar 1 (AnvMensagemBaseMinima -Pasta $pasta -Resultado @{ Motivo = 'atualizador' } -Base $base) }
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
    $argsInstalar = @('src/cli.ts', 'instalar', '--destino', $pasta)
    if (AnvAutoCommitDaPasta -Pasta $pasta -JaInstalado $jaInstalado) { $argsInstalar += '--auto-commit' }
    $ins = AnvExecutar $bun $argsInstalar $pasta
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
    $res = AnvResultadoFinal -TemAgente (@($agentes).Count -gt 0) -DoctorOk ($doc.Codigo -eq 0) -Pasta $pasta -Versao $versao -Agentes $agentes -SemRg (-not $temRg) -Atalho $atalho -SemYtDlp (-not (AnvComando 'yt-dlp'))
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
