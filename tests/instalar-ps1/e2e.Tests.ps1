# Prova de ponta a ponta do instalar.ps1 no runner windows-latest (Windows PowerShell 5.1), num perfil vazio.
#
# O dono não tem Windows (D12): isto é a única prova do instalador no Windows. Cada cenário roda o script de verdade
# em outro processo, com USERPROFILE/LOCALAPPDATA/TEMP numa pasta nova (com ESPAÇO no nome), contra um repositório
# local com tag assinada por chave SSH descartável criada aqui. Não prova: administrador (o runner é admin),
# duplo clique, SmartScreen, Explorer com PATH novo e GPO/AppLocker/WDAC reais. O CLM é simulado no teste do launcher.
#
# Só roda no Windows. Cenários em Dado / Quando / Então nos comentários.

BeforeDiscovery { $script:EhWindows = ($env:OS -eq 'Windows_NT') }

Describe 'abrir.ps1 em runtime no Windows' -Skip:(-not $script:EhWindows) {
  BeforeAll {
    $script:AbrirRaiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:Abrir = Join-Path $script:AbrirRaiz 'instalador\abrir.ps1'
    $script:AbrirBase = Join-Path $env:TEMP ('anv abrir runtime ' + [guid]::NewGuid().ToString('N'))
    $script:AbrirPasta = Join-Path $script:AbrirBase 'instalacao'
    $script:AbrirBin = Join-Path $script:AbrirBase 'bin'
    $script:AbrirPathAntes = $env:Path
    $script:AbrirPerfilAntes = $env:USERPROFILE
    $script:AbrirLocalAntes = $env:LOCALAPPDATA
    $script:AbrirPastaAntes = $env:ANVILORE_PASTA
    $script:AbrirLancadorAntes = $env:ANVILORE_LANCADOR
    $script:AbrirDestinoAntes = $env:ANVILORE_DESTINO
    New-Item -ItemType Directory -Path @((Join-Path $script:AbrirPasta '.git'), (Join-Path $script:AbrirPasta 'src'), (Join-Path $script:AbrirPasta 'skills'), $script:AbrirBin) -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $script:AbrirPasta 'AGENTS.md') -Value ''
    Set-Content -LiteralPath (Join-Path $script:AbrirPasta 'src\cli.ts') -Value ''
    $script:AbrirBun = Join-Path $script:AbrirBin 'bun.cmd'
    Set-Content -LiteralPath $script:AbrirBun -Encoding ASCII -Value "@echo off`r`necho bun falso: UI`r`nexit /b 7`r`n"
  }

  BeforeEach {
    $env:ANVILORE_PASTA = $script:AbrirPasta
    $env:ANVILORE_LANCADOR = $script:Abrir
    $env:USERPROFILE = $script:AbrirBase
    $env:LOCALAPPDATA = Join-Path $script:AbrirBase 'AppData\Local'
    $env:Path = "$script:AbrirBin;$script:AbrirPathAntes"
  }

  AfterEach {
    $env:Path = $script:AbrirPathAntes
    $env:USERPROFILE = $script:AbrirPerfilAntes
    $env:LOCALAPPDATA = $script:AbrirLocalAntes
    $env:ANVILORE_PASTA = $script:AbrirPastaAntes
    $env:ANVILORE_LANCADOR = $script:AbrirLancadorAntes
    $env:ANVILORE_DESTINO = $script:AbrirDestinoAntes
  }

  AfterAll { Remove-Item -LiteralPath $script:AbrirBase -Recurse -Force -ErrorAction SilentlyContinue }

  It 'Dado bun falso, Quando a UI termina com código 7, Então mostra o erro do lançador e aguarda Enter' {
    Mock Read-Host { 'enter' }
    $consoleAntes = [Console]::OutputEncoding
    $outputAntes = $global:OutputEncoding
    try { $saida = & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $script:Abrir))) *>&1 | Out-String }
    finally { [Console]::OutputEncoding = $consoleAntes; $global:OutputEncoding = $outputAntes }
    $saida | Should -Match 'A interface do Anvilore fechou com erro \(código 7\)'
    Should -Invoke Read-Host -Times 1 -Exactly
  }

  It 'Dado que Bun não está no PATH, Quando abro a instalação, Então mostro o erro e aguardo Enter' {
    $env:Path = $script:AbrirBase
    Mock Read-Host { 'enter' }
    $consoleAntes = [Console]::OutputEncoding
    $outputAntes = $global:OutputEncoding
    try { $saida = & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $script:Abrir))) *>&1 | Out-String }
    finally { [Console]::OutputEncoding = $consoleAntes; $global:OutputEncoding = $outputAntes }
    $saida | Should -Match 'Bun não encontrado'
    Should -Invoke Read-Host -Times 1 -Exactly
  }

  It 'Dado Constrained Language Mode, Quando avalio o lançador com ScriptBlock.Create, Então reporto se o modo o permite' {
    $comando = @'
$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'
function global:Read-Host { Write-Output 'READ_HOST_CALLED'; return '' }
try {
  $bloco = [scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_LANCADOR))
  & $bloco
  exit 0
} catch {
  Write-Output 'CLM_SCRIPTBLOCK_BLOCKED'
  exit 42
}
'@
    $saida = & powershell.exe -NoProfile -NonInteractive -Command $comando 2>&1 | Out-String
    $codigo = $LASTEXITCODE
    if ($codigo -eq 42 -and $saida -match 'CLM_SCRIPTBLOCK_BLOCKED') {
      Write-Warning 'CLM bloqueou ScriptBlock.Create; abrir.ps1 precisa da rota de atalho do Inno Setup.'
    } else {
      $codigo | Should -Be 0
      $saida | Should -Match 'A interface do Anvilore fechou com erro \(código 7\)'
      $saida | Should -Match 'READ_HOST_CALLED'
    }
  }

  It 'Dado Constrained Language Mode, Quando o atalho avalia abrir.ps1 com Invoke-Expression, Então a UI falsa inicia e o erro é mostrado' {
    $comando = @'
$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'
$env:ANVILORE_PASTA = $env:ANVILORE_PASTA_TESTE
$env:ANVILORE_LANCADOR = $env:ANVILORE_LANCADOR_TESTE
function global:Read-Host { Write-Output 'READ_HOST_CALLED'; return '' }
try {
  Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ANVILORE_LANCADOR | Invoke-Expression
  if ($LASTEXITCODE -eq 7) { exit 0 }
  Write-Output "CLM_UNEXPECTED_EXIT_$LASTEXITCODE"
  exit 43
} catch {
  Write-Output "CLM_IEX_BLOCKED: $($_.Exception.Message)"
  exit 42
}
'@
    $variaveis = @('ANVILORE_PASTA_TESTE', 'ANVILORE_LANCADOR_TESTE')
    $antes = @{}
    foreach ($nome in $variaveis) { $antes[$nome] = [Environment]::GetEnvironmentVariable($nome, 'Process') }
    try {
      $env:ANVILORE_PASTA_TESTE = $script:AbrirPasta
      $env:ANVILORE_LANCADOR_TESTE = $script:Abrir
      $saida = & powershell.exe -NoProfile -NonInteractive -Command $comando 2>&1 | Out-String
      $codigo = $LASTEXITCODE
    } finally {
      foreach ($nome in $variaveis) { [Environment]::SetEnvironmentVariable($nome, $antes[$nome], 'Process') }
    }
    $codigo | Should -Be 0 -Because $saida
    $saida | Should -Match 'A interface do Anvilore fechou com erro \(código 7\)'
    $saida | Should -Match 'READ_HOST_CALLED'
  }
}

Describe 'instalar.ps1 no Windows' -Skip:(-not $script:EhWindows) {
  BeforeAll {
    $script:Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:Modelo = Join-Path $script:Raiz 'instalador\instalar.ps1'
    $script:Manifesto = Join-Path $script:Raiz 'instalador\dependencias.json'
    $script:Base = Join-Path $env:TEMP 'anv e2e'
    Remove-Item $script:Base -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory $script:Base -Force | Out-Null
    $script:PathUsuarioAntes = (Get-Item HKCU:\Environment).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
    $script:BashAntes = (Get-Item HKCU:\Environment).GetValue('CLAUDE_CODE_GIT_BASH_PATH', $null)

    $script:SshKeygen = (Get-Command ssh-keygen -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $script:SshKeygen) { $script:SshKeygen = 'C:\Program Files\Git\usr\bin\ssh-keygen.exe' }
    function script:Chave($nome) {
      $f = Join-Path $script:Base "chave-$nome"
      & $script:SshKeygen -q -t ed25519 -N '""' -C "$nome@anvilore.test" -f $f | Out-Null
      $pub = (Get-Content -Raw "$f.pub").Trim() -split '\s+'
      $assin = Join-Path $script:Base "assinantes-$nome"
      Set-Content -LiteralPath $assin -Value ("$nome@anvilore.test namespaces=`"git`" $($pub[0]) $($pub[1])`n") -NoNewline -Encoding ASCII
      $fp = ((& $script:SshKeygen -lf "$f.pub") -split '\s+')[1]
      return @{ Privada = $f; Assinantes = $assin; Fingerprint = $fp }
    }
    function script:GitCmd {
      $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # avisos do git vão para o stderr e não são erro
      try { & git @args 2>&1 | Out-Null; $cod = $LASTEXITCODE } finally { $ErrorActionPreference = $eap }
      if ($cod -ne 0) { throw "git $args falhou ($cod)" }
    }
    # Origem local: clone do checkout atual + tag. modo: assinada | sem-assinatura | outra-chave | nome-trocado
    function script:Origem($nome, $modo, $chaveBoa, $chaveOutra, [bool]$filtro = $false) {
      $dir = Join-Path $script:Base "origem-$nome"
      GitCmd clone --quiet --no-hardlinks --no-tags $script:Raiz $dir   # no CI de uma tag, a real (sem o objeto anotado) venceria a v0.0.1
      GitCmd -C $dir config user.email 'ci@anvilore.test'
      GitCmd -C $dir config user.name 'CI'
      GitCmd -C $dir config gpg.format ssh
      if ($filtro) {
        # Candidata com filtro de checkout em todos os arquivos (como um .gitattributes de git-lfs): o filtro mora na config da pessoa.
        [IO.File]::WriteAllText((Join-Path $dir '.gitattributes'), "* filter=x`n")
        GitCmd -C $dir add -f .gitattributes
        GitCmd -C $dir commit -q -m 'candidata com filtro'
      }
      switch ($modo) {
        'assinada' { GitCmd -C $dir config user.signingkey $chaveBoa.Privada; GitCmd -C $dir tag -s v0.0.1 -m 'prova' HEAD }
        'outra-chave' { GitCmd -C $dir config user.signingkey $chaveOutra.Privada; GitCmd -C $dir tag -s v0.0.1 -m 'prova' HEAD }
        'sem-assinatura' { GitCmd -C $dir tag -a v0.0.1 -m 'prova' HEAD }
        'pgp-falso' {
          # Tag cuja "assinatura" é um bloco OpenPGP inventado: sem a defesa, o verify-tag a entregaria ao gpg da pessoa.
          $sha = (& git -C $dir rev-parse HEAD).Trim()
          $corpo = "object $sha`ntype commit`ntag v0.0.1`ntagger CI <ci@anvilore.test> 1700000000 +0000`n`nprova`n-----BEGIN PGP SIGNATURE-----`n`niQEzBAABCAAdFiEEfalso`n=abcd`n-----END PGP SIGNATURE-----`n"
          $arq = Join-Path $script:Base 'tag-pgp.txt'
          [IO.File]::WriteAllText($arq, $corpo)
          $obj = (& git -C $dir hash-object -t tag -w $arq).Trim()
          GitCmd -C $dir update-ref refs/tags/v0.0.1 $obj
        }
        'nome-trocado' {
          GitCmd -C $dir config user.signingkey $chaveBoa.Privada; GitCmd -C $dir tag -s v0.0.1 -m 'prova' HEAD
          $objeto = (& git -C $dir rev-parse refs/tags/v0.0.1).Trim()
          GitCmd -C $dir update-ref refs/tags/v0.0.2 $objeto
        }
      }
      return $dir
    }
    # gpg de mentira que aprovaria qualquer assinatura OpenPGP (script com #! que o Git for Windows sabe executar).
    $script:GpgFalso = Join-Path $script:Base 'gpg-falso'
    New-Item -ItemType Directory $script:GpgFalso -Force | Out-Null
    $script:GpgFalsoArquivo = ((Join-Path $script:GpgFalso 'gpg') -replace '\\', '/')
    [IO.File]::WriteAllText((Join-Path $script:GpgFalso 'gpg'), "#!/bin/sh`necho '[GNUPG:] NEWSIG'`necho '[GNUPG:] GOODSIG ABCDEF0123456789 falso <f@x>'`necho '[GNUPG:] VALIDSIG ABCDEF0123456789 2026-10-29 1 0 4 0 1 8 00 ABCDEF0123456789'`necho '[GNUPG:] TRUST_ULTIMATE 0 pgp'`nexit 0`n")
    # A versão do kit sob teste (o checkout atual) é a base mínima dos instaladores gerados aqui: a instalação e a reinstalação seguem.
    $script:VersaoRepo = (Get-Content -Raw -Encoding UTF8 (Join-Path $script:Raiz 'package.json') | ConvertFrom-Json).version
    $script:Boa = Chave 'boa'
    $script:Outra = Chave 'outra'
    $script:AgenteFalso = Join-Path $script:Base 'agente'
    New-Item -ItemType Directory $script:AgenteFalso -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $script:AgenteFalso 'claude.cmd') -Value "@echo off`r`necho claude falso" -Encoding ASCII

    function script:PathSem($nomes, [bool]$git) {
      $manter = foreach ($e in ($env:Path -split ';')) {
        if (-not $e) { continue }
        if ($git -and $e -match '\\Git\\') { continue }
        $tem = $false
        foreach ($n in $nomes) { if (Test-Path -LiteralPath (Join-Path $e $n)) { $tem = $true } }
        if (-not $tem) { $e }
      }
      return ($manter -join ';')
    }
    # Servidor de loopback do confianca.json (scripts/servir-confianca-teste.ts, só 127.0.0.1): o instalador de teste leva esta URL
    # embutida (--aceitar-url-de-teste). Nada aqui acessa a rede real nem o site do dono.
    $script:ConfDir = Join-Path $script:Base 'confianca'
    New-Item -ItemType Directory $script:ConfDir -Force | Out-Null
    function script:Publicar($chaves, $minima = '0.0.0') {
      Remove-Item (Join-Path $script:ConfDir 'status') -ErrorAction SilentlyContinue
      $j = @{ formato = 1; chaves = @($chaves); versaoMinima = $minima } | ConvertTo-Json -Compress
      [IO.File]::WriteAllText((Join-Path $script:ConfDir 'confianca.json'), $j)
    }
    function script:StatusDoSite($codigo) { [IO.File]::WriteAllText((Join-Path $script:ConfDir 'status'), "$codigo") }
    function script:ModoDoSite($modo) { if ($modo) { [IO.File]::WriteAllText((Join-Path $script:ConfDir 'modo'), $modo) } else { Remove-Item (Join-Path $script:ConfDir 'modo') -ErrorAction SilentlyContinue } }
    function script:Requisicoes { $f = Join-Path $script:ConfDir 'requisicoes.log'; if (Test-Path $f) { @(Get-Content $f).Count } else { 0 } }
    Publicar @($script:Boa.Fingerprint, $script:Outra.Fingerprint)
    $bun = (Get-Command bun).Source
    $script:Servidor = Start-Process -FilePath $bun -ArgumentList @("`"$(Join-Path $script:Raiz 'scripts\servir-confianca-teste.ts')`"", "`"$($script:ConfDir)`"") -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 200 -and -not (Test-Path (Join-Path $script:ConfDir 'porta')); $i++) { Start-Sleep -Milliseconds 50 }
    if (-not (Test-Path (Join-Path $script:ConfDir 'porta'))) { throw 'o servidor de teste do confianca.json não subiu' }
    $script:UrlConfianca = "http://127.0.0.1:$((Get-Content -Raw (Join-Path $script:ConfDir 'porta')).Trim())/confianca.json"
    # Gera o instalar.ps1 de release com o MESMO mecanismo do build (scripts/embutir-instalador.ts): manifesto e chave embutidos.
    function script:Embutir($nome, $assinantes, $manifesto, $baseMinima = $script:VersaoRepo) {
      $m = Join-Path $script:Base "manifesto-$nome.json"
      [IO.File]::WriteAllText($m, ((Get-Content -Raw -Encoding UTF8 $manifesto) -replace "`r`n", "`n"))
      $b = Join-Path $script:Base "base-minima-$nome"
      [IO.File]::WriteAllText($b, "$baseMinima`n")
      $saida = Join-Path $script:Base "instalar-$nome.ps1"
      $o = & bun (Join-Path $script:Raiz 'scripts\embutir-instalador.ts') --modelo $script:Modelo --manifesto $m --assinantes $assinantes --base-minima $b --url-confianca $script:UrlConfianca --aceitar-url-de-teste --saida $saida 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) { throw "embutir falhou: $o" }
      return $saida
    }
    # Roda o instalador em outro processo, com o perfil dado. Devolve @{ Codigo; Saida; Perfil }.
    function script:Rodar($perfil, $origem, $instalador, $path, $extras = @{}) {
      $salvas = @{}
      $novas = @{
        USERPROFILE = $perfil; LOCALAPPDATA = "$perfil\AppData\Local"; APPDATA = "$perfil\AppData\Roaming"
        TEMP = "$perfil\tmp"; TMP = "$perfil\tmp"; HOME = $perfil
        ANVILORE_SEM_PERGUNTAS = '1'; ANVILORE_ORIGEM = $origem; ANVILORE_ASSINANTES = ''
        ANVILORE_MANIFESTO = ''; Path = $path; ANVILORE_WIKI = ''
      }
      foreach ($k in $extras.Keys) { $novas[$k] = $extras[$k] }
      foreach ($k in $novas.Keys) { $salvas[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
      try {
        foreach ($k in $novas.Keys) { [Environment]::SetEnvironmentVariable($k, $(if ($novas[$k]) { $novas[$k] } else { $null }), 'Process') }
        foreach ($d in @("$perfil\tmp", "$perfil\AppData\Local", "$perfil\AppData\Roaming")) { New-Item -ItemType Directory $d -Force | Out-Null }
        $cmd = "& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 '$instalador'))); exit `$LASTEXITCODE"
        $saida = & powershell.exe -NoProfile -NonInteractive -Command $cmd 2>&1 | Out-String
        $codigo = $LASTEXITCODE
      } finally {
        foreach ($k in $salvas.Keys) { [Environment]::SetEnvironmentVariable($k, $salvas[$k], 'Process') }
      }
      Write-Host "----- instalador (perfil $perfil), código $codigo`n$saida"
      return @{ Codigo = $codigo; Saida = $saida; Perfil = $perfil }
    }
    function script:Perfil($nome) { $p = Join-Path $script:Base "perfil $nome"; New-Item -ItemType Directory $p -Force | Out-Null; return $p }
    $script:OrigemBoa = Origem 'boa' 'assinada' $script:Boa $script:Outra
    # Instalador de release: manifesto real + chave "boa" embutidos.
    $script:Release = Embutir 'release' $script:Boa.Assinantes $script:Manifesto
    $script:PathComAgente = (PathSem @() $false) + ';' + $script:AgenteFalso
  }

  AfterAll {
    if ($script:Servidor) { Stop-Process -Id $script:Servidor.Id -Force -ErrorAction SilentlyContinue }
    # Devolve o registro do runner como estava.
    Set-ItemProperty HKCU:\Environment -Name Path -Value $script:PathUsuarioAntes -Type ExpandString
    if ($null -eq $script:BashAntes) { Remove-ItemProperty HKCU:\Environment -Name CLAUDE_CODE_GIT_BASH_PATH -ErrorAction SilentlyContinue }
    else { Set-ItemProperty HKCU:\Environment -Name CLAUDE_CODE_GIT_BASH_PATH -Value $script:BashAntes }
  }

  Context 'instalação do zero, sem Git, sem Bun e sem rg (cenários 2, 32 e 17)' {
    # Dado um perfil vazio e um PATH sem Git, Bun nem rg, com um agente; Quando o instalador roda em silêncio;
    # Então baixa PortableGit/Bun/rg com o hash do manifesto, clona, confere a assinatura e o doctor sai 0.
    BeforeAll {
      $script:P1 = Perfil 'zero'
      $path = (PathSem @('git.exe', 'bun.exe', 'rg.exe', 'bun.cmd') $true) + ';' + $script:AgenteFalso
      (Get-Command git -ErrorAction SilentlyContinue) | Out-Null
      $script:R1 = Rodar $script:P1 $script:OrigemBoa $script:Release $path
      $script:Pasta1 = Join-Path $script:P1 'Anvilore'
    }
    It 'termina completo (código 0)'                  { $script:R1.Codigo | Should -Be 0 }
    It 'extraiu o PortableGit no perfil'              { Test-Path "$($script:P1)\AppData\Local\Anvilore\git\cmd\git.exe" | Should -BeTrue; Test-Path "$($script:P1)\AppData\Local\Anvilore\git\bin\bash.exe" | Should -BeTrue }
    It 'instalou o Bun em .bun\bin'                   { Test-Path "$($script:P1)\.bun\bin\bun.exe" | Should -BeTrue }
    It 'instalou o rg'                                { Test-Path "$($script:P1)\AppData\Local\Anvilore\bin\rg.exe" | Should -BeTrue }
    It 'clonou o kit na tag assinada, sem CRLF forçado' {
      Test-Path (Join-Path $script:Pasta1 'package.json') | Should -BeTrue
      $cfg = & "$($script:P1)\AppData\Local\Anvilore\git\cmd\git.exe" -C $script:Pasta1 config --local --get core.autocrlf
      "$cfg".Trim() | Should -Be 'false'
    }
    It 'gravou atualizacao.json automático/estável e Bun gerenciado, sem BOM' {
      $f = Join-Path $script:Pasta1 '.anvilore\atualizacao.json'
      $b = [IO.File]::ReadAllBytes($f)
      ($b[0] -eq 0xEF) | Should -BeFalse
      $j = Get-Content -Raw $f | ConvertFrom-Json
      $j.modo | Should -Be 'automatico'; $j.canal | Should -Be 'estavel'; $j.versao | Should -Be 1
      $j.bunGerenciado | Should -BeTrue; $j.autoCommit | Should -BeTrue; $j.githubBackup | Should -BeFalse
    }
    It 'ligou o commit automático e não o backup' {
      $t = Get-Content -Raw (Join-Path $script:Pasta1 'anvilore.toml')
      $t | Should -Match 'auto_commit\s*=\s*true'
      $t | Should -Not -Match 'github_backup\s*=\s*true'
    }
    It 'o kit tem o hook que protege raw/ para o Claude' { Test-Path (Join-Path $script:Pasta1 '.claude\settings.json') | Should -BeTrue }
    It 'acrescentou git, bun e rg ao PATH do usuário (HKCU)' {
      $p = (Get-Item HKCU:\Environment).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
      $p | Should -Match ([regex]::Escape("$($script:P1)\AppData\Local\Anvilore\git\cmd"))
      $p | Should -Match ([regex]::Escape("$($script:P1)\.bun\bin"))
      $p | Should -Match ([regex]::Escape("$($script:P1)\AppData\Local\Anvilore\bin"))
    }
    It 'gravou o registro em .anvilore\instalacao.log com UTF-8 legível' {
      $l = Get-Content -Raw -Encoding UTF8 (Join-Path $script:Pasta1 '.anvilore\instalacao.log')
      $l | Should -Match 'fim, código 0'
    }
    It 'escreveu os acentos certos na saída' { $script:R1.Saida | Should -Match 'instalação' }
    It 'criou os atalhos do Menu Iniciar e da Área de Trabalho apontando para abrir.ps1' {
      $menu = Join-Path $script:P1 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Anvilore\Anvilore.lnk'
      $desktop = Join-Path $script:P1 'Desktop\Anvilore.lnk'
      $abrir = Join-Path $script:Pasta1 'instalador\abrir.ps1'
      $log = Get-Content -Raw -Encoding UTF8 (Join-Path $script:Pasta1 '.anvilore\instalacao.log')
      Test-Path -LiteralPath $abrir | Should -BeTrue
      foreach ($caminho in @($menu, $desktop)) {
        Test-Path -LiteralPath $caminho | Should -BeTrue -Because $log
        $atalho = (New-Object -ComObject WScript.Shell).CreateShortcut($caminho)
        $atalho.TargetPath | Should -Match 'powershell(\.exe)?$'
        $atalho.Arguments | Should -Match 'Get-Content -Raw -Encoding UTF8'
        $atalho.Arguments | Should -Match ([regex]::Escape($abrir))
        $atalho.IconLocation | Should -Match 'powershell(\.exe)?,0'
      }
    }
    It 'não sobrou pasta de passagem' { @(Get-ChildItem -LiteralPath $script:P1 -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty }
  }

  Context 'reinstalar (cenário 4)' {
    # Dado uma instalação com uma fonte da pessoa em raw/; Quando o instalador roda de novo; Então nada da pasta muda.
    BeforeAll {
      $script:Pasta1 = Join-Path $script:P1 'Anvilore'
      New-Item -ItemType Directory (Join-Path $script:Pasta1 'raw') -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $script:Pasta1 'raw\minha-fonte.txt') -Value 'conteúdo meu' -Encoding UTF8
      $script:HashAntes = (Get-FileHash (Join-Path $script:Pasta1 'raw\minha-fonte.txt')).Hash
      $script:HeadAntes = (& git -C $script:Pasta1 rev-parse HEAD).Trim()
      $path = $script:PathComAgente
      $script:R2 = Rodar $script:P1 $script:OrigemBoa $script:Release $path
    }
    It 'termina completo'                   { $script:R2.Codigo | Should -Be 0 }
    It 'diz que já está instalado'          { $script:R2.Saida | Should -Match 'Já existe uma instalação' }
    It 'não mexe no que é da pessoa'        { (Get-FileHash (Join-Path $script:Pasta1 'raw\minha-fonte.txt')).Hash | Should -Be $script:HashAntes }
    It 'não troca o commit do kit'          { (& git -C $script:Pasta1 rev-parse HEAD).Trim() | Should -Be $script:HeadAntes }
    It 'não repete entradas no PATH do usuário' {
      $p = (Get-Item HKCU:\Environment).GetValue('Path', '', 'DoNotExpandEnvironmentNames') -split ';'
      @($p | Where-Object { $_ -eq "$($script:P1)\.bun\bin" }).Count | Should -Be 1
    }
  }

  Context 'pasta Anvilore.novo da pessoa nunca é apagada (achado P1 do Codex)' {
    # Dado um perfil com uma pasta Anvilore.novo da pessoa, com um arquivo dentro; Quando o instalador baixa o kit (pasta padrão,
    # pasta escolhida por ANVILORE_PASTA, ou uma instalação que falha na assinatura); Então a Anvilore.novo e o arquivo continuam
    # iguais, e nenhuma pasta de passagem sobra.
    BeforeAll {
      function script:PerfilComNovo($nome) {
        $p = Perfil $nome
        New-Item -ItemType Directory (Join-Path $p 'Anvilore.novo') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $p 'Anvilore.novo\do-usuario.txt'), "meu trabalho`n")
        return $p
      }
      function script:IntactaNovo($p) { [IO.File]::ReadAllText((Join-Path $p 'Anvilore.novo\do-usuario.txt')) }
      function script:Sobras($p) { @(Get-ChildItem -LiteralPath $p -Filter 'Anvilore.novo-*' -Force -ErrorAction SilentlyContinue) }
    }
    It 'instalação nova na pasta padrão deixa a Anvilore.novo da pessoa intacta' {
      $p = PerfilComNovo 'novo-padrao'
      $r = Rodar $p $script:OrigemBoa $script:Release $script:PathComAgente
      $r.Codigo | Should -Be 0
      IntactaNovo $p | Should -Be "meu trabalho`n"
      Sobras $p | Should -BeNullOrEmpty
    }
    It 'instalação nova em outra pasta (ANVILORE_PASTA) deixa a Anvilore.novo do perfil intacta' {
      $p = PerfilComNovo 'novo-outra'
      $destino = Join-Path $script:Base 'destino fora do perfil'
      Remove-Item -LiteralPath $destino -Recurse -Force -ErrorAction SilentlyContinue
      $r = Rodar $p $script:OrigemBoa $script:Release $script:PathComAgente @{ ANVILORE_PASTA = $destino }
      $r.Codigo | Should -Be 0
      IntactaNovo $p | Should -Be "meu trabalho`n"
      Test-Path (Join-Path $destino 'package.json') | Should -BeTrue
      @(Get-ChildItem -LiteralPath $script:Base -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
    }
    It 'instalação que falha na assinatura deixa a Anvilore.novo da pessoa intacta e não sobra pasta de passagem' {
      $p = PerfilComNovo 'novo-falha'
      $origem = Origem 'novo-sem-assinatura' 'sem-assinatura' $script:Boa $script:Outra
      $r = Rodar $p $origem $script:Release $script:PathComAgente
      $r.Codigo | Should -Be 3
      IntactaNovo $p | Should -Be "meu trabalho`n"
      Sobras $p | Should -BeNullOrEmpty
      Test-Path (Join-Path $p 'Anvilore') | Should -BeFalse
    }
  }

  Context 'reinstalar respeita o commit automático desligado (achado P2 do Codex)' {
    # Dado uma instalação cuja pessoa desligou o commit automático (atualizacao.json com autoCommit false e sem anvilore.toml);
    # Quando o instalador roda de novo; Então o commit automático continua desligado: anvilore.toml não aparece e o estado não muda.
    # Dado uma instalação nova; Então o commit automático nasce ligado (coberto na instalação do zero).
    BeforeAll {
      $script:PAc = Perfil 'autocommit'
      $script:RAc1 = Rodar $script:PAc $script:OrigemBoa $script:Release $script:PathComAgente
      $script:PastaAc = Join-Path $script:PAc 'Anvilore'
      $arq = Join-Path $script:PastaAc '.anvilore\atualizacao.json'
      [IO.File]::WriteAllText($arq, ((Get-Content -Raw -Encoding UTF8 $arq) -replace '"autoCommit":true', '"autoCommit":false'))
      Remove-Item -LiteralPath (Join-Path $script:PastaAc 'anvilore.toml') -Force
      $script:RAc2 = Rodar $script:PAc $script:OrigemBoa $script:Release $script:PathComAgente
    }
    It 'a primeira instalação terminou completa'             { $script:RAc1.Codigo | Should -Be 0 }
    It 'a reinstalação termina completa'                     { $script:RAc2.Codigo | Should -Be 0 }
    It 'não religou o commit automático (sem anvilore.toml)' { Test-Path -LiteralPath (Join-Path $script:PastaAc 'anvilore.toml') | Should -BeFalse }
    It 'mantém autoCommit false no estado'                   { (Get-Content -Raw (Join-Path $script:PastaAc '.anvilore\atualizacao.json') | ConvertFrom-Json).autoCommit | Should -BeFalse }
  }

  Context 'base mínima: a pasta antiga é recusada ANTES de executar qualquer coisa dela (decisão 1)' {
    # Dado uma pasta instalada cuja versão é menor que a base mínima embutida, ou cujo package.json está ausente, ilegível,
    # inválido ou é pré-release; Quando o instalador roda de novo; Então para com a mensagem simples (código 1), nada da pasta
    # foi executado (cli.ts, bunfig.toml com preload e hooks do git gravam um marcador) e HEAD e arquivos continuam iguais.
    # Dado versão igual ou maior que a base; Então segue o fluxo atual.
    BeforeAll {
      $script:PastaBM = Join-Path $script:P1 'Anvilore'
      function script:Instantaneo($raiz) {
        @(Get-ChildItem -LiteralPath $raiz -Recurse -Force | ForEach-Object {
          if ($_.PSIsContainer) { "$($_.FullName)/" } else { "$($_.FullName) $((Get-FileHash -LiteralPath $_.FullName).Hash)" }
        }) | Sort-Object
      }
      function script:CasoBase($nome, $pacote) {
        $dir = Join-Path $script:Base "caso-$nome"
        Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $script:PastaBM -Destination $dir -Recurse -Force
        $marcador = "C:/anv-cfg-bm-$nome"
        Remove-Item ($marcador -replace '/', '\') -ErrorAction SilentlyContinue
        $cli = Join-Path $dir 'src\cli.ts'
        # A linha 1 do cli.ts é o shebang: o código do marcador entra logo depois dela.
        $linhasCli = [IO.File]::ReadAllLines($cli)
        $marca = @('import { appendFileSync as _a } from "node:fs";', "_a('$marcador', 'cli ' + process.argv.slice(2).join(' ') + '\n');")
        [IO.File]::WriteAllLines($cli, @($linhasCli[0]) + $marca + $linhasCli[1..($linhasCli.Count - 1)])
        [IO.File]::WriteAllText((Join-Path $dir 'marca.ts'), ('import { appendFileSync } from "node:fs";' + "`n" + "appendFileSync('$marcador', 'preload\n');`n"))
        [IO.File]::WriteAllText((Join-Path $dir 'bunfig.toml'), "preload = [`"./marca.ts`"]`n")
        foreach ($g in @('post-checkout', 'post-merge', 'post-rewrite', 'pre-commit', 'reference-transaction', 'post-commit')) {
          [IO.File]::WriteAllText((Join-Path $dir ".git\hooks\$g"), "#!/bin/sh`necho hook >> '$marcador'`nexit 0`n")
        }
        $pkg = Join-Path $dir 'package.json'
        $original = [IO.File]::ReadAllText($pkg)
        Remove-Item $pkg -Recurse -Force -ErrorAction SilentlyContinue
        # 'VERSAO:x.y.z' troca só a versão do package.json de verdade: o resto fica igual, para o `bun install --frozen-lockfile` da reinstalação passar.
        if ($pacote -like 'VERSAO:*') { [IO.File]::WriteAllText($pkg, ($original -replace '"version"\s*:\s*"[^"]*"', ('"version": "' + $pacote.Substring(7) + '"'))) }
        elseif ($pacote -eq 'DIRETORIO') { New-Item -ItemType Directory $pkg | Out-Null }
        elseif ($pacote -eq 'BINARIO') { [IO.File]::WriteAllBytes($pkg, [byte[]](0xFF, 0xFE, 0x00, 0x80, 0x7B)) }
        elseif ($null -ne $pacote) { [IO.File]::WriteAllText($pkg, $pacote) }
        return @{ Pasta = $dir; Marcador = ($marcador -replace '/', '\') ; Cabeca = (& git -C $dir rev-parse HEAD).Trim() }
      }
      function script:RodarCaso($caso) {
        return (Rodar $script:P1 $script:OrigemBoa $script:Release $script:PathComAgente @{ ANVILORE_PASTA = $caso.Pasta })
      }
    }
    foreach ($c in @(
        @{ N = 'versão antiga (0.0.1)';          P = '{"name":"anvilore","version":"0.0.1"}';        F = 'anterior à primeira versão assinada' },
        @{ N = 'package.json ausente';           P = $null;                                          F = 'Não reconheço a versão do Anvilore' },
        @{ N = 'package.json que é uma pasta';   P = 'DIRETORIO';                                    F = 'Não reconheço a versão do Anvilore' },
        @{ N = 'package.json com bytes inválidos'; P = 'BINARIO';                                    F = 'Não reconheço a versão do Anvilore' },
        @{ N = 'package.json que não é JSON';    P = '{ isto nao e json';                            F = 'Não reconheço a versão do Anvilore' },
        @{ N = 'sem version';                    P = '{"name":"anvilore"}';                          F = 'Não reconheço a versão do Anvilore' },
        @{ N = 'version número';                 P = '{"name":"anvilore","version":3}';              F = 'Não reconheço a versão do Anvilore' },
        @{ N = 'pré-release acima da base';      P = '{"name":"anvilore","version":"99.0.0-beta"}';  F = 'Não reconheço a versão do Anvilore' }
      )) {
      It "recusa: $($c.N)" -TestCases @($c) {
        param($N, $P, $F)
        $caso = CasoBase ([guid]::NewGuid().ToString('N').Substring(0, 8)) $P
        $antes = Instantaneo $caso.Pasta
        $r = RodarCaso $caso
        $r.Codigo | Should -Be 1
        $r.Saida | Should -Match $F
        $r.Saida | Should -Match 'nada foi mudado'
        $r.Saida | Should -Match 'numa pasta nova'
        $r.Saida | Should -Match 'de forma conferida'
        $r.Saida | Should -Match 'cópia de segurança'
        $r.Saida | Should -Not -Match 'Pronto'
        Test-Path $caso.Marcador | Should -BeFalse
        (& git -C $caso.Pasta rev-parse HEAD).Trim() | Should -Be $caso.Cabeca
        (Instantaneo $caso.Pasta) | Should -Be $antes
      }
    }
    It 'versão igual à base: segue o fluxo atual (reinstala)' {
      $caso = CasoBase 'igual' ('VERSAO:' + $script:VersaoRepo)
      $r = RodarCaso $caso
      $r.Codigo | Should -Be 0
      $r.Saida | Should -Match 'Já existe uma instalação'
      $r.Saida | Should -Not -Match 'anterior à primeira versão assinada'
    }
    It 'versão maior que a base: segue o fluxo atual (reinstala)' {
      $caso = CasoBase 'maior' 'VERSAO:99.0.0'
      $r = RodarCaso $caso
      $r.Codigo | Should -Be 0
      $r.Saida | Should -Match 'Já existe uma instalação'
    }
    It 'a base mínima do instalador é conferida contra o arquivo: instalador com base maior que a versão da pasta recusa' {
      $alto = Embutir 'base-alta' $script:Boa.Assinantes $script:Manifesto '99.0.0'
      $caso = CasoBase 'base-alta' ('VERSAO:' + $script:VersaoRepo)
      $r = Rodar $script:P1 $script:OrigemBoa $alto $script:PathComAgente @{ ANVILORE_PASTA = $caso.Pasta }
      $r.Codigo | Should -Be 1
      $r.Saida | Should -Match 'anterior à primeira versão assinada'
      Test-Path $caso.Marcador | Should -BeFalse
    }
  }

  Context 'reinstalar entrega as chaves embutidas ao atualizador pela opção (RR6, R1)' {
    # Dado uma pasta instalada cujo atualizador só conhece o seguranca/assinantes dela (que pode estar atrasado na troca de
    # chave); Quando o instalador roda de novo; Então o `atualizar` da pasta recebe o ARGUMENTO --assinantes-do-instalador
    # apontando para um arquivo com as chaves embutidas no instalador, e nenhuma variável de ambiente com elas. O
    # comportamento do atualizador com a opção é provado em tests/atualizar.test.ts; aqui prova-se o encanamento no
    # Windows, trocando o `atualizar` da pasta por um que só registra.
    BeforeAll {
      $script:PastaRR6 = Join-Path $script:P1 'Anvilore'
      $script:RegistroRR6 = 'C:\anv-cfg-rr6.json'
      Remove-Item $script:RegistroRR6 -ErrorAction SilentlyContinue
      $cli = Join-Path $script:PastaRR6 'src\cli.ts'
      $linhas = [IO.File]::ReadAllLines($cli)
      $gancho = 'if (process.argv[2] === "atualizar") { const args = process.argv.slice(3); const i = args.indexOf("--assinantes-do-instalador"); const arq = i >= 0 ? (args[i + 1] ?? "") : ""; await Bun.write("C:/anv-cfg-rr6.json", JSON.stringify({ args, variavel: process.env.ANVILORE_ASSINANTES_DO_INSTALADOR ?? "", arquivo: arq, conteudo: arq ? await Bun.file(arq).text() : "" })); process.exit(0); }'
      [IO.File]::WriteAllLines($cli, @($linhas[0], $gancho) + $linhas[1..($linhas.Count - 1)])
      $script:R2b = Rodar $script:P1 $script:OrigemBoa $script:Release $script:PathComAgente
    }
    It 'termina completo'                       { $script:R2b.Codigo | Should -Be 0 }
    It 'o atualizador da pasta foi chamado com a opção e o arquivo' {
      Test-Path $script:RegistroRR6 | Should -BeTrue
      $j = Get-Content -Raw -Encoding UTF8 $script:RegistroRR6 | ConvertFrom-Json
      @($j.args) | Should -Contain '--assinantes-do-instalador'
      $j.arquivo | Should -Not -BeNullOrEmpty
    }
    It 'não entrega as chaves por variável de ambiente' {
      (Get-Content -Raw -Encoding UTF8 $script:RegistroRR6 | ConvertFrom-Json).variavel | Should -BeNullOrEmpty
    }
    It 'o arquivo entregue tem as chaves embutidas no instalador' {
      $j = Get-Content -Raw -Encoding UTF8 $script:RegistroRR6 | ConvertFrom-Json
      $j.conteudo.Trim() | Should -Be ((Get-Content -Raw -Encoding ASCII $script:Boa.Assinantes).Trim())
    }
  }

  Context 'atualizador antigo na pasta, que responde com o uso (código 2) à opção (R1)' {
    # Dado uma pasta instalada cujo `atualizar` é de uma versão que não conhece a opção (devolve 2 com "Uso:"); Quando o
    # instalador roda de novo; Então para com a mensagem própria, em linguagem simples, saída diferente de zero, sem mudar
    # o commit do kit nem os arquivos da pessoa.
    BeforeAll {
      $script:PastaAntiga = Join-Path $script:P1 'Anvilore'
      $cli = Join-Path $script:PastaAntiga 'src\cli.ts'
      $linhas = [IO.File]::ReadAllLines($cli)
      $gancho = 'if (process.argv[2] === "atualizar") { console.error("Uso: anvilore atualizar [--verificar | --voltar | --estado]"); process.exit(2); }'
      # A linha 1 é o gancho do contexto anterior (registra e sai com 0): troca por este.
      [IO.File]::WriteAllLines($cli, @($linhas[0], $gancho) + $linhas[2..($linhas.Count - 1)])
      $script:HashAntiga = (Get-FileHash (Join-Path $script:Pasta1 'raw\minha-fonte.txt')).Hash
      $script:HeadAntiga = (& git -C $script:PastaAntiga rev-parse HEAD).Trim()
      $script:R2c = Rodar $script:P1 $script:OrigemBoa $script:Release $script:PathComAgente
    }
    It 'sai com erro'                           { $script:R2c.Codigo | Should -Not -Be 0 }
    It 'explica em linguagem simples'           { $script:R2c.Saida | Should -Match 'anterior à primeira versão assinada e não sabe receber as chaves do instalador; nada foi mudado' }
    It 'diz o caminho: pasta nova e migração conferida' { $script:R2c.Saida | Should -Match 'numa pasta nova'; $script:R2c.Saida | Should -Match 'cópia de segurança' }
    It 'não dá o conselho circular de atualizar a pasta' { $script:R2c.Saida | Should -Not -Match 'pelo comando de atualização' }
    It 'não diz que concluiu'                   { $script:R2c.Saida | Should -Not -Match 'Pronto' }
    It 'não troca o commit do kit'              { (& git -C $script:PastaAntiga rev-parse HEAD).Trim() | Should -Be $script:HeadAntiga }
    It 'não mexe no que é da pessoa'            { (Get-FileHash (Join-Path $script:Pasta1 'raw\minha-fonte.txt')).Hash | Should -Be $script:HashAntiga }
  }

  Context 'estado das chaves no site: instalação nova (decisão 2)' {
    # Dado o instalador de teste com a URL de loopback embutida; Quando o site retira a chave, falha ou exige versão mais nova;
    # Então a instalação para ANTES de baixar o kit e não cria a pasta. Com a chave na lista, instala.
    BeforeAll {
      $script:PathEstado = (PathSem @() $false) + ';' + $script:AgenteFalso
      Publicar @($script:Outra.Fingerprint)
      $script:Rc1 = Rodar (Perfil 'chave-retirada') $script:OrigemBoa $script:Release $script:PathEstado
      Publicar @($script:Boa.Fingerprint, $script:Outra.Fingerprint)
      StatusDoSite 302
      $script:Rc2 = Rodar (Perfil 'site-302') $script:OrigemBoa $script:Release $script:PathEstado
      StatusDoSite 404
      $script:Rc3 = Rodar (Perfil 'site-404') $script:OrigemBoa $script:Release $script:PathEstado
      Publicar @($script:Boa.Fingerprint) '99.0.0'
      $script:Rc4 = Rodar (Perfil 'versao-minima') $script:OrigemBoa $script:Release $script:PathEstado
      # Site que responde sem parar: o instalador tem de abortar ao passar de 64 KiB (o servidor registra os bytes que saíram).
      Publicar @($script:Boa.Fingerprint, $script:Outra.Fingerprint)
      ModoDoSite 'infinito'
      $cron = [Diagnostics.Stopwatch]::StartNew()
      $script:Rc5 = Rodar (Perfil 'corpo-infinito') $script:OrigemBoa $script:Release $script:PathEstado
      $cron.Stop()
      $script:Rc5Segundos = $cron.Elapsed.TotalSeconds
      Start-Sleep -Milliseconds 500
      $script:Rc5Enviados = [long](Get-Content -Raw (Join-Path $script:ConfDir 'enviados')).Trim()
      ModoDoSite 'prazo'
      $cron = [Diagnostics.Stopwatch]::StartNew()
      $script:Rc6 = Rodar (Perfil 'prazo-total') $script:OrigemBoa $script:Release $script:PathEstado
      $cron.Stop()
      $script:Rc6Segundos = $cron.Elapsed.TotalSeconds
      ModoDoSite $null
      Publicar @($script:Boa.Fingerprint, $script:Outra.Fingerprint)
    }
    It 'chave retirada da lista: recusa, diz que o instalador está desatualizado e não cria a pasta' {
      $script:Rc1.Codigo | Should -Not -Be 0
      $script:Rc1.Saida | Should -Match 'não inclui a chave de assinatura deste instalador'
      Test-Path (Join-Path $script:Rc1.Perfil 'Anvilore') | Should -BeFalse
      $script:Rc1.Saida | Should -Not -Match 'Baixando'
    }
    It 'redirecionamento do site: recusa com a mensagem simples' {
      $script:Rc2.Codigo | Should -Not -Be 0
      $script:Rc2.Saida | Should -Match 'não consegui conferir a lista atual de chaves'
      Test-Path (Join-Path $script:Rc2.Perfil 'Anvilore') | Should -BeFalse
    }
    It 'HTTP 404 do site: recusa com a mensagem simples' {
      $script:Rc3.Codigo | Should -Not -Be 0
      $script:Rc3.Saida | Should -Match 'não consegui conferir a lista atual de chaves'
      Test-Path (Join-Path $script:Rc3.Perfil 'Anvilore') | Should -BeFalse
    }
    It 'resposta sem fim: aborta no limite de 64 KiB, recusa com a mensagem simples e não cria a pasta' {
      $script:Rc5.Codigo | Should -Not -Be 0
      $script:Rc5.Saida | Should -Match 'não consegui conferir a lista atual de chaves'
      $script:Rc5Enviados | Should -BeLessThan 1048576
      $script:Rc5Segundos | Should -BeLessThan 12
      Test-Path (Join-Path $script:Rc5.Perfil 'Anvilore') | Should -BeFalse
    }
    It 'cabeçalhos e byte perto do prazo: encerra até 20 s (15 s mais 5 s de inicialização) e não cria a pasta' {
      $script:Rc6.Codigo | Should -Not -Be 0
      $script:Rc6.Saida | Should -Match 'não consegui conferir a lista atual de chaves'
      $script:Rc6Segundos | Should -BeLessThan 20
      Test-Path (Join-Path $script:Rc6.Perfil 'Anvilore') | Should -BeFalse
    }
    It 'versão mínima acima da tag: recusa antes de baixar' {
      $script:Rc4.Codigo | Should -Not -Be 0
      $script:Rc4.Saida | Should -Match 'exige a versão 99.0.0'
      Test-Path (Join-Path $script:Rc4.Perfil 'Anvilore') | Should -BeFalse
    }
  }

  Context 'estado das chaves no site: reinstalação (decisão 2)' {
    # Dado uma pasta instalada; Quando o site retira a chave embutida, ou exige uma versão acima da instalada; Então o instalador
    # recusa antes de executar qualquer coisa da pasta (o HEAD e os arquivos ficam). Com a chave de volta, segue.
    BeforeAll {
      $script:PastaRe = Join-Path $script:P1 'Anvilore'
      $script:HeadRe = (& git -C $script:PastaRe rev-parse HEAD).Trim()
      $script:MarcaRe = Join-Path $script:Base 'marca-reinstalacao.txt'
      Remove-Item $script:MarcaRe -ErrorAction SilentlyContinue
      $cli = Join-Path $script:PastaRe 'src\cli.ts'
      $linhas = [IO.File]::ReadAllLines($cli)
      $gancho = 'if (process.argv[2] === "atualizar") { await Bun.write(' + "'" + ($script:MarcaRe -replace '\\', '/') + "'" + ', "executou"); process.exit(0); }'
      [IO.File]::WriteAllLines($cli, @($linhas[0], $gancho) + $linhas[2..($linhas.Count - 1)])
      $pathRe = (PathSem @() $false) + ';' + $script:AgenteFalso
      Publicar @($script:Outra.Fingerprint)
      $script:Rr1 = Rodar $script:P1 $script:OrigemBoa $script:Release $pathRe
      Publicar @($script:Boa.Fingerprint) '99.0.0'
      $script:Rr2 = Rodar $script:P1 $script:OrigemBoa $script:Release $pathRe
      Publicar @($script:Boa.Fingerprint, $script:Outra.Fingerprint)
      $script:Rr3 = Rodar $script:P1 $script:OrigemBoa $script:Release $pathRe
    }
    It 'chave retirada: recusa, sem executar o atualizador da pasta e sem mudar o HEAD' {
      $script:Rr1.Codigo | Should -Not -Be 0
      $script:Rr1.Saida | Should -Match 'não inclui a chave de assinatura deste instalador'
      $script:Rr1.Saida | Should -Not -Match 'Já existe uma instalação'
    }
    It 'pasta abaixo da versão mínima da lista: recusa antes de executar qualquer coisa dela' {
      $script:Rr2.Codigo | Should -Not -Be 0
      $script:Rr2.Saida | Should -Match 'exige a versão 99.0.0'
      $script:Rr2.Saida | Should -Match 'não executei nada dela'
    }
    It 'as duas recusas não executaram o atualizador nem mudaram o commit' {
      (& git -C $script:PastaRe rev-parse HEAD).Trim() | Should -Be $script:HeadRe
    }
    It 'com a chave de volta na lista, a reinstalação segue e chama o atualizador' {
      $script:Rr3.Codigo | Should -Be 0
      Test-Path $script:MarcaRe | Should -BeTrue
    }
    It 'a consulta pediu ao servidor a cada rodada (nunca usou cache)' {
      (Requisicoes) | Should -BeGreaterThan 3
    }
  }

  Context 'assinatura que não confere (cenários 5 e 9)' {
    # Dado uma tag sem assinatura / assinada por outra chave / com nome trocado; Quando o instalador baixa o kit;
    # Então apaga o que baixou, não liga agente nenhum e diz por quê.
    It 'recusa tag com assinatura OpenPGP falsa, mesmo com um gpg de mentira configurado que aprovaria tudo' {
      # A pessoa pode ter um gpg.program no .gitconfig dela. Aqui ele aprova qualquer assinatura OpenPGP.
      $origem = Origem 'ruim-pgp' 'pgp-falso' $script:Boa $script:Outra
      $cfg = Join-Path $script:Base 'gitconfig-pgp-falso'
      [IO.File]::WriteAllText($cfg, "[gpg]`n`tprogram = $($script:GpgFalsoArquivo)`n[gpg `"openpgp`"]`n`tprogram = $($script:GpgFalsoArquivo)`n")
      # Prova de que o ataque é real: sem a defesa, o git aprova a tag pelo gpg falso (a chave SSH nem é consultada).
      $antes = $env:GIT_CONFIG_GLOBAL; $eap = $ErrorActionPreference
      try {
        $env:GIT_CONFIG_GLOBAL = $cfg; $ErrorActionPreference = 'Continue'
        $saida = & git -C $origem -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$($script:Boa.Assinantes)" verify-tag refs/tags/v0.0.1 2>&1 | Out-String
        $cod = $LASTEXITCODE
      } finally { $env:GIT_CONFIG_GLOBAL = $antes; $ErrorActionPreference = $eap }
      "$cod $saida" | Should -Match '^0 '
      $r = Rodar (Perfil 'ruim-pgp') $origem $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $cfg }
      $r.Codigo | Should -Be 3
      $r.Saida | Should -Match 'assinatura SSH'
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
      @(Get-ChildItem -LiteralPath $r.Perfil -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
    }
    foreach ($c in @(@{ N = 'sem assinatura'; M = 'sem-assinatura' }, @{ N = 'outra chave'; M = 'outra-chave' }, @{ N = 'nome da tag trocado'; M = 'nome-trocado' })) {
      It "recusa a tag $($c.N)" -TestCases @($c) {
        param($N, $M)
        $origem = Origem "ruim-$M" $M $script:Boa $script:Outra
        $r = Rodar (Perfil "ruim-$M") $origem $script:Release $script:PathComAgente
        $r.Codigo | Should -Be 3
        $r.Saida | Should -Match 'conferência de segurança'
        Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
        @(Get-ChildItem -LiteralPath $r.Perfil -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
      }
    }
    It 'o arquivo de apoio ANVILORE_ASSINANTES é ignorado quando há chave embutida (a de fora não vale)' {
      $origem = Origem 'ruim-env' 'outra-chave' $script:Boa $script:Outra
      $r = Rodar (Perfil 'env-ignorado') $origem $script:Release $script:PathComAgente @{ ANVILORE_ASSINANTES = $script:Outra.Assinantes }
      $r.Codigo | Should -Be 3
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
    }
    It 'o modelo sem chave embutida (nem arquivo de apoio) recusa antes de baixar qualquer coisa' {
      $r = Rodar (Perfil 'sem-chave') $script:OrigemBoa $script:Modelo $script:PathComAgente
      $r.Codigo | Should -Be 3
      $r.Saida | Should -Match 'chave de assinatura'
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
      @(Get-ChildItem -LiteralPath $r.Perfil -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
    }
  }

  Context 'configuração global do git da pessoa não pode ajudar uma candidata (A1 e A2 da revisão de segurança)' {
    # A1 - Dado um filtro de checkout (smudge) ou um hook na config global e uma candidata sem assinatura válida;
    # Quando o instalador baixa; Então recusa (código 3), apaga o staging e NADA da candidata rodou (marcador ausente).
    # Com tag válida a instalação termina e o filtro só roda depois da autenticação.
    # A2 - Dado um gpg.ssh.program aprovador na config global e uma tag assinada por chave fora dos assinantes;
    # Então recusa (código 3).
    BeforeAll {
      # Arquivos que o git vai ler/rodar (config, hooks, aprovador) ficam num caminho curto e sem espaço.
      $script:Cfg = 'C:\anv-cfg'
      Remove-Item $script:Cfg -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -ItemType Directory $script:Cfg -Force | Out-Null
      function script:BarraNormal($caminho) { return ($caminho -replace '\\', '/') }
      function script:ConfigGlobal($nome, $texto) {
        $f = Join-Path $script:Cfg "gitconfig-$nome"
        [IO.File]::WriteAllText($f, $texto)
        Write-Host "----- config global de teste ($f):`n$texto-----"
        return $f
      }
      function script:ConfigComFiltro($nome) {
        $m = Join-Path $script:Cfg "marcador-smudge-$nome"
        Remove-Item $m -ErrorAction SilentlyContinue
        $cfg = ConfigGlobal "filtro-$nome" ("[filter `"x`"]`n`tsmudge = `"printf executado >> '$(BarraNormal $m)' && cat`"`n`tclean = cat`n")
        return @{ Config = $cfg; Marcador = $m }
      }
      function script:ConfigComHook($nome) {
        $m = Join-Path $script:Cfg "marcador-hook-$nome"
        Remove-Item $m -ErrorAction SilentlyContinue
        $pasta = Join-Path $script:Cfg "hooks-da-pessoa-$nome"
        New-Item -ItemType Directory $pasta -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $pasta 'reference-transaction'), "#!/bin/sh`nprintf `"ref-`$1 `" >> '$(BarraNormal $m)'`ncat >/dev/null`n")
        [IO.File]::WriteAllText((Join-Path $pasta 'post-checkout'), "#!/bin/sh`nprintf 'post-checkout ' >> '$(BarraNormal $m)'`n")
        $cfg = ConfigGlobal "hook-$nome" ("[core]`n`thooksPath = $(BarraNormal $pasta)`n")
        return @{ Config = $cfg; Marcador = $m }
      }
    }
    It 'A1: filtro de checkout global + tag sem assinatura: recusa e o filtro não roda' {
      $c = ConfigComFiltro 'ruim'
      $origem = Origem 'a1-filtro-ruim' 'sem-assinatura' $script:Boa $script:Outra $true
      $r = Rodar (Perfil 'a1-filtro-ruim') $origem $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $c.Config }
      $r.Codigo | Should -Be 3
      Test-Path $c.Marcador | Should -BeFalse
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
      @(Get-ChildItem -LiteralPath $r.Perfil -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
    }
    It 'A1: o mesmo filtro com tag válida: instala e o filtro só roda depois da autenticação' {
      $c = ConfigComFiltro 'bom'
      $origem = Origem 'a1-filtro-bom' 'assinada' $script:Boa $script:Outra $true
      $r = Rodar (Perfil 'a1-filtro-bom') $origem $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $c.Config }
      $r.Codigo | Should -Be 0
      Test-Path (Join-Path $r.Perfil 'Anvilore\src\cli.ts') | Should -BeTrue
      Test-Path $c.Marcador | Should -BeTrue
      (& git -C (Join-Path $r.Perfil 'Anvilore') rev-parse HEAD).Trim() | Should -Be (& git -C $origem rev-parse 'refs/tags/v0.0.1^{commit}').Trim()
    }
    It 'A1: hook reference-transaction em core.hooksPath global + tag sem assinatura: recusa e o hook não roda' {
      $c = ConfigComHook 'ruim'
      $origem = Origem 'a1-hook-ruim' 'sem-assinatura' $script:Boa $script:Outra
      $r = Rodar (Perfil 'a1-hook-ruim') $origem $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $c.Config }
      $r.Codigo | Should -Be 3
      Test-Path $c.Marcador | Should -BeFalse
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
    }
    It 'A1: o mesmo hook com tag válida: a instalação termina' {
      $c = ConfigComHook 'bom'
      $r = Rodar (Perfil 'a1-hook-bom') $script:OrigemBoa $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $c.Config }
      $r.Codigo | Should -Be 0
      Test-Path (Join-Path $r.Perfil 'Anvilore\src\cli.ts') | Should -BeTrue
      # O hook funciona neste runner: depois da autenticação ele roda (isso dá sentido a "não rodou" no teste da candidata ruim).
      Test-Path $c.Marcador | Should -BeTrue
    }
    It 'A2: gpg.ssh.program aprovador global + tag de chave fora dos assinantes: recusa' {
      $apr = Join-Path $script:Cfg 'aprova-tudo'
      [IO.File]::WriteAllText($apr, "#!/bin/sh`ncase `"`$*`" in`n  *find-principals*) echo atacante@exemplo ;;`n  *) echo 'Good `"git`" signature for atacante@exemplo with ED25519 key SHA256:falso' ;;`nesac`nexit 0`n")
      $cfg = ConfigGlobal 'aprovador' ("[gpg `"ssh`"]`n`tprogram = $(BarraNormal $apr)`n")
      $origem = Origem 'a2-outra' 'outra-chave' $script:Boa $script:Outra
      # Prova de que o ataque é real: sem fixar o verificador, o git aprova a tag da chave errada.
      $antes = $env:GIT_CONFIG_GLOBAL; $eap = $ErrorActionPreference
      try {
        $env:GIT_CONFIG_GLOBAL = $cfg; $ErrorActionPreference = 'Continue'
        $saida = & git -C $origem -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$($script:Boa.Assinantes)" verify-tag refs/tags/v0.0.1 2>&1 | Out-String
        $cod = $LASTEXITCODE
      } finally { $env:GIT_CONFIG_GLOBAL = $antes; $ErrorActionPreference = $eap }
      "$cod $saida" | Should -Match '^0 '
      $r = Rodar (Perfil 'a2-outra') $origem $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $cfg }
      $r.Codigo | Should -Be 3
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
    }
  }

  Context 'transporte do git da pessoa não pode rodar programa antes da assinatura (A5)' {
    # Dado protocol.ext.allow=always e um insteadOf da origem para ext:: (um helper que grava um marcador) na config global;
    # Quando o instalador descobre a tag (sem versão fixa) ou baixa a versão fixa; Então recusa (código 3), o helper não roda
    # e nada é instalado.
    BeforeAll {
      $script:CfgA5 = 'C:\anv-cfg-a5'
      Remove-Item $script:CfgA5 -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -ItemType Directory $script:CfgA5 -Force | Out-Null
      function script:ConfigExt($nome, $origem) {
        $m = Join-Path $script:CfgA5 "marcador-ext-$nome"
        Remove-Item $m -ErrorAction SilentlyContinue
        $h = Join-Path $script:CfgA5 "helper-ext-$nome.sh"
        [IO.File]::WriteAllText($h, "#!/bin/sh`nprintf executado >> '$($m -replace '\\', '/')'`nexit 1`n")
        $barraH = $h -replace '\\', '/'
        $origemEsc = $origem -replace '\\', '\\'
        $f = Join-Path $script:CfgA5 "gitconfig-ext-$nome"
        [IO.File]::WriteAllText($f, "[protocol `"ext`"]`n`tallow = always`n[url `"ext::sh $barraH`"]`n`tinsteadOf = $origemEsc`n")
        Write-Host "----- config global de teste ($f):`n$(Get-Content -Raw $f)-----"
        return @{ Config = $f; Marcador = $m }
      }
    }
    It 'A5: sem versão fixa (ls-remote): recusa e o helper não roda' {
      $origem = Origem 'a5-ls' 'assinada' $script:Boa $script:Outra
      $c = ConfigExt 'ls' $origem
      $r = Rodar (Perfil 'a5-ls') $origem $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $c.Config }
      $r.Codigo | Should -Be 3
      Test-Path $c.Marcador | Should -BeFalse
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
      @(Get-ChildItem -LiteralPath $r.Perfil -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
    }
    It 'A5: com ANVILORE_VERSAO (clone): recusa e o helper não roda' {
      $origem = Origem 'a5-clone' 'assinada' $script:Boa $script:Outra
      $c = ConfigExt 'clone' $origem
      $r = Rodar (Perfil 'a5-clone') $origem $script:Release $script:PathComAgente @{ GIT_CONFIG_GLOBAL = $c.Config; ANVILORE_VERSAO = '0.0.1' }
      $r.Codigo | Should -Be 3
      Test-Path $c.Marcador | Should -BeFalse
      Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
      @(Get-ChildItem -LiteralPath $r.Perfil -Filter 'Anvilore.novo*' -Force -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
    }
  }

  Context 'versão e pasta pedidas (ANVILORE_VERSAO e ANVILORE_PASTA)' {
    # Dado uma origem em que a v0.0.2 é falsa (nome trocado) e a v0.0.1 é boa; Quando a pessoa pede a 0.0.1 numa pasta
    # com espaço e apóstrofo; Então instala a 0.0.1 nessa pasta.
    BeforeAll {
      $origem = Origem 'duas' 'nome-trocado' $script:Boa $script:Outra
      $script:P5 = Perfil 'pin'
      $script:PastaCustomizada5 = Join-Path $script:P5 "minha pasta da Lia's wiki"
      $script:R5 = Rodar $script:P5 $origem $script:Release $script:PathComAgente @{ ANVILORE_VERSAO = '0.0.1'; ANVILORE_PASTA = $script:PastaCustomizada5 }
    }
    It 'termina completo'               { $script:R5.Codigo | Should -Be 0 }
    It 'instalou na pasta pedida, na tag pedida' {
      (& git -C $script:PastaCustomizada5 describe --tags --exact-match).Trim() | Should -Be 'v0.0.1'
      Test-Path (Join-Path $script:P5 'Anvilore') | Should -BeFalse
    }
    It 'o atalho preserva pasta personalizada com espaço e apóstrofo no runtime' {
      $atalhoPath = Join-Path $script:P5 'Desktop\Anvilore.lnk'
      $atalho = (New-Object -ComObject WScript.Shell).CreateShortcut($atalhoPath)
      $pastaLiteral = $script:PastaCustomizada5.Replace("'", "''")
      $atalho.Arguments | Should -Match ([regex]::Escape("ANVILORE_PASTA = '$pastaLiteral'"))

      $perfilSemInstalacao = Join-Path $script:Base 'perfil de runtime sem ANVILORE_PASTA'
      $fallback = Join-Path $perfilSemInstalacao 'Anvilore'
      $bunBin = Join-Path $perfilSemInstalacao '.bun\bin'
      $registro = Join-Path $script:Base 'destino do bun aberto pelo atalho.txt'
      New-Item -ItemType Directory -Path @((Join-Path $fallback '.git'), (Join-Path $fallback 'src'), (Join-Path $fallback 'skills'), $bunBin) -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $fallback 'AGENTS.md') -Value ''
      Set-Content -LiteralPath (Join-Path $fallback 'src\cli.ts') -Value ''
      Set-Content -LiteralPath (Join-Path $bunBin 'bun.cmd') -Encoding ASCII -Value "@echo off`r`necho %ANVILORE_DESTINO%>>`"%ANVILORE_TEST_DESTINO%`"`r`nexit /b 0`r`n"

      $variaveis = @('USERPROFILE', 'LOCALAPPDATA', 'ANVILORE_PASTA', 'ANVILORE_TEST_DESTINO')
      $ambienteAntes = @{}
      foreach ($nome in $variaveis) { $ambienteAntes[$nome] = [Environment]::GetEnvironmentVariable($nome, 'Process') }
      try {
        $env:USERPROFILE = $perfilSemInstalacao
        $env:LOCALAPPDATA = Join-Path $perfilSemInstalacao 'AppData\Local'
        $env:ANVILORE_PASTA = $null
        $env:ANVILORE_TEST_DESTINO = $registro
        $processo = Start-Process -FilePath $atalho.TargetPath -ArgumentList $atalho.Arguments -Wait -PassThru -WindowStyle Hidden
        $processo.ExitCode | Should -Be 0
        (Get-Content -Raw -LiteralPath $registro).Trim() | Should -Be $script:PastaCustomizada5
      } finally {
        foreach ($nome in $variaveis) { [Environment]::SetEnvironmentVariable($nome, $ambienteAntes[$nome], 'Process') }
      }
    }
  }

  Context 'sem agente (cenário 3)' {
    # Dado nenhuma CLI de agente no PATH e a oferta recusada (silencioso); Quando termina;
    # Então o kit fica instalado, o código é parcial (10) e a mensagem diz para instalar um agente e rodar de novo.
    BeforeAll { $script:R3 = Rodar (Perfil 'sem-agente') $script:OrigemBoa $script:Release (PathSem @() $false) }
    It 'sai parcial (10)'            { $script:R3.Codigo | Should -Be 10 }
    It 'o kit ficou instalado'       { Test-Path (Join-Path $script:R3.Perfil 'Anvilore\package.json') | Should -BeTrue }
    It 'diz para instalar um agente' { $script:R3.Saida | Should -Match 'rode o instalador de novo' }
  }

  Context 'download adulterado (cenário 33)' {
    # Dado um hash que não confere para o Git portátil e nenhum Git no PATH; Quando o instalador baixa;
    # Então apaga o arquivo, para com o código 4 e não instala nada.
    BeforeAll {
      $m = Get-Content -Raw -Encoding UTF8 $script:Manifesto | ConvertFrom-Json
      $m.dependencias.portablegit.plataformas.'windows-x64'.url = 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.1/SHASUMS256.txt'
      $ruim = Join-Path $script:Base 'dependencias-ruim.json'
      [IO.File]::WriteAllText($ruim, (($m | ConvertTo-Json -Depth 10) -replace "`r`n", "`n") + "`n")
      $adulterado = Embutir 'adulterado' $script:Boa.Assinantes $ruim
      $path = (PathSem @('git.exe') $true) + ';' + $script:AgenteFalso
      $script:R4 = Rodar (Perfil 'adulterado') $script:OrigemBoa $adulterado $path
    }
    It 'para com o código 4'              { $script:R4.Codigo | Should -Be 4 }
    It 'diz que o arquivo não confere'    { $script:R4.Saida | Should -Match 'não confere' }
    It 'não extraiu o Git nem clonou'     {
      Test-Path (Join-Path $script:R4.Perfil 'AppData\Local\Anvilore\git') | Should -BeFalse
      Test-Path (Join-Path $script:R4.Perfil 'Anvilore') | Should -BeFalse
    }
  }

  Context 'AnviloreSetup.exe (cenário 31)' {
    BeforeAll {
      $iscc = Get-ChildItem 'C:\Program Files*\Inno Setup*\ISCC.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $iscc) { throw 'ISCC.exe não está instalado no runner Windows' }
      $script:SetupSaida = Join-Path $script:Base 'setup-build'
      New-Item -ItemType Directory $script:SetupSaida -Force | Out-Null
      $script:SetupIss = Join-Path $script:Raiz 'instalador\windows\anvilore.iss'
      $out = & $iscc.FullName "/DVersao=$script:VersaoRepo" "/DInstallerPs1=$script:Release" "/O$script:SetupSaida" $script:SetupIss 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) { throw "ISCC falhou ($LASTEXITCODE): $out" }
      $script:SetupExe = Join-Path $script:SetupSaida 'AnviloreSetup.exe'
      $script:SetupKit = Join-Path $script:Base 'perfil setup\Anvilore'
      $script:SetupApp = Join-Path $env:LOCALAPPDATA 'Programs\Anvilore'
      $script:SetupPrograms = [Environment]::GetFolderPath('Programs')
      $script:SetupDesktop = [Environment]::GetFolderPath('DesktopDirectory')
      $script:SetupMenuShortcut = Join-Path $script:SetupPrograms 'Anvilore\Anvilore.lnk'
      $script:SetupDesktopShortcut = Join-Path $script:SetupDesktop 'Anvilore.lnk'
      $script:SetupPathAntes = (Get-Item HKCU:\Environment).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
      $script:SetupAmbienteAntes = @{}
      foreach ($nome in @('ANVILORE_PASTA', 'ANVILORE_ORIGEM', 'ANVILORE_SEM_PERGUNTAS', 'Path')) {
        $script:SetupAmbienteAntes[$nome] = [Environment]::GetEnvironmentVariable($nome, 'Process')
      }
      $env:ANVILORE_PASTA = $script:SetupKit
      $env:ANVILORE_ORIGEM = $script:OrigemBoa
      $env:Path = $script:PathComAgente
      $env:ANVILORE_SEM_PERGUNTAS = '1'
      $p = Start-Process -FilePath $script:SetupExe -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
      $script:SetupInstallCode = $p.ExitCode
      $script:SetupShortcut = New-Object -ComObject WScript.Shell
    }

    AfterAll {
      if (Test-Path -LiteralPath $script:SetupApp) {
        $unins = Get-ChildItem -LiteralPath $script:SetupApp -Filter 'unins*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($unins) { Start-Process -FilePath $unins.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait | Out-Null }
      }
      if ($null -ne $script:SetupPathAntes) { Set-ItemProperty HKCU:\Environment -Name Path -Value $script:SetupPathAntes }
      foreach ($nome in $script:SetupAmbienteAntes.Keys) {
        [Environment]::SetEnvironmentVariable($nome, $script:SetupAmbienteAntes[$nome], 'Process')
      }
    }

    It 'Dado a origem local assinada, Quando instalo silenciosamente, Então o doctor sai 0 e os atalhos apontam para o lançador do setup' {
      $script:SetupInstallCode | Should -Be 0
      Test-Path (Join-Path $script:SetupKit 'package.json') | Should -BeTrue
      $bun = (Get-Command bun -ErrorAction Stop).Source
      Push-Location $script:SetupKit
      try { & $bun src/cli.ts doctor | Out-Null; $codigoDoctor = $LASTEXITCODE } finally { Pop-Location }
      $codigoDoctor | Should -Be 0
      foreach ($caminho in @($script:SetupMenuShortcut, $script:SetupDesktopShortcut)) {
        Test-Path -LiteralPath $caminho | Should -BeTrue
        $lnk = $script:SetupShortcut.CreateShortcut($caminho)
        $lnk.TargetPath | Should -Match 'powershell\.exe$'
        $lnk.Arguments | Should -Match 'Get-Content'
        $lnk.Arguments | Should -Match 'Invoke-Expression'
        $lnk.Arguments | Should -Not -Match '\s-File\s'
      }
    }

    It 'Dado o kit instalado, Quando desinstalo silenciosamente, Então os atalhos e o programa saem e a pasta da pessoa fica' {
      $unins = Get-ChildItem -LiteralPath $script:SetupApp -Filter 'unins*.exe' | Select-Object -First 1
      $unins | Should -Not -BeNullOrEmpty
      $p = Start-Process -FilePath $unins.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
      $p.ExitCode | Should -Be 0
      Test-Path -LiteralPath $script:SetupApp | Should -BeFalse
      Test-Path -LiteralPath $script:SetupMenuShortcut | Should -BeFalse
      Test-Path -LiteralPath $script:SetupDesktopShortcut | Should -BeFalse
      Test-Path -LiteralPath (Join-Path $script:SetupKit 'package.json') | Should -BeTrue
    }

    It 'Dado Windows sem Git no PATH, Quando instalo silenciosamente, Então uso PortableGit por usuário sem UAC e o doctor passa' {
      $kitAntes = Join-Path $script:Base 'perfil sem git\Anvilore'
      $localDataSemGit = Join-Path $script:Base 'perfil sem git\AppData\Local'
      $pathSemGit = (PathSem @('git.exe') $true) + ';' + $script:AgenteFalso
      $salvas = @{}
      foreach ($nome in @('ANVILORE_PASTA', 'ANVILORE_ORIGEM', 'ANVILORE_SEM_PERGUNTAS', 'LOCALAPPDATA', 'Path')) {
        $salvas[$nome] = [Environment]::GetEnvironmentVariable($nome, 'Process')
      }
      try {
        $env:ANVILORE_PASTA = $kitAntes
        $env:ANVILORE_ORIGEM = $script:OrigemBoa
        $env:ANVILORE_SEM_PERGUNTAS = '1'
        $env:LOCALAPPDATA = $localDataSemGit
        $env:Path = $pathSemGit
        (Get-Command git.exe -ErrorAction SilentlyContinue) | Should -BeNullOrEmpty
        $p = Start-Process -FilePath $script:SetupExe -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
        $p.ExitCode | Should -Be 0
        $gitPortatil = Join-Path $localDataSemGit 'Anvilore\git\cmd\git.exe'
        $bashPortatil = Join-Path $localDataSemGit 'Anvilore\git\bin\bash.exe'
        Test-Path -LiteralPath $gitPortatil | Should -BeTrue
        Test-Path -LiteralPath $bashPortatil | Should -BeTrue
        (Get-Item HKCU:\Environment).GetValue('CLAUDE_CODE_GIT_BASH_PATH', '') | Should -Be $bashPortatil

        $pathUsuario = (Get-Item HKCU:\Environment).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
        $env:Path = [Environment]::ExpandEnvironmentVariables($pathUsuario) + ';' + $pathSemGit
        $check = Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList '-NoLogo', '-NoProfile', '-Command', 'git --version; exit $LASTEXITCODE' -Wait -PassThru -WindowStyle Hidden
        $check.ExitCode | Should -Be 0
        Push-Location $kitAntes
        try { & bun src/cli.ts doctor | Out-Null; $codigoDoctor = $LASTEXITCODE } finally { Pop-Location }
        $codigoDoctor | Should -Be 0
      } finally {
        $unins = Get-ChildItem -LiteralPath $script:SetupApp -Filter 'unins*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($unins) { Start-Process -FilePath $unins.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait | Out-Null }
        foreach ($nome in $salvas.Keys) { [Environment]::SetEnvironmentVariable($nome, $salvas[$nome], 'Process') }
        Remove-Item -LiteralPath (Join-Path $localDataSemGit 'Anvilore\git') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $kitAntes -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
}
