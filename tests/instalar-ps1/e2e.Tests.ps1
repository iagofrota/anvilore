# Prova de ponta a ponta do instalar.ps1 no runner windows-latest (Windows PowerShell 5.1), num perfil vazio.
#
# O dono não tem Windows (D12): isto é a única prova do instalador no Windows. Cada cenário roda o script de verdade
# em outro processo, com USERPROFILE/LOCALAPPDATA/TEMP numa pasta nova (com ESPAÇO no nome), contra um repositório
# local com tag assinada por chave SSH descartável criada aqui. Não prova: administrador (o runner é admin),
# duplo clique, SmartScreen, Explorer com PATH novo, Constrained Language Mode real.
#
# Só roda no Windows. Cenários em Dado / Quando / Então nos comentários.

BeforeDiscovery { $script:EhWindows = ($env:OS -eq 'Windows_NT') }

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
      return @{ Privada = $f; Assinantes = $assin }
    }
    function script:GitCmd { & git @args 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { throw "git $args falhou ($LASTEXITCODE)" } }
    # Origem local: clone do checkout atual + tag. modo: assinada | sem-assinatura | outra-chave | nome-trocado
    function script:Origem($nome, $modo, $chaveBoa, $chaveOutra, [bool]$filtro = $false) {
      $dir = Join-Path $script:Base "origem-$nome"
      GitCmd clone --quiet --no-hardlinks $script:Raiz $dir
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
    # Gera o instalar.ps1 de release com o MESMO mecanismo do build (scripts/embutir-instalador.ts): manifesto e chave embutidos.
    function script:Embutir($nome, $assinantes, $manifesto) {
      $m = Join-Path $script:Base "manifesto-$nome.json"
      [IO.File]::WriteAllText($m, ((Get-Content -Raw -Encoding UTF8 $manifesto) -replace "`r`n", "`n"))
      $saida = Join-Path $script:Base "instalar-$nome.ps1"
      $o = & bun (Join-Path $script:Raiz 'scripts\embutir-instalador.ts') --modelo $script:Modelo --manifesto $m --assinantes $assinantes --saida $saida 2>&1 | Out-String
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
    It 'o passo 10 não criou atalho nem abrir.ps1 (é da U6)' {
      Get-ChildItem $script:P1 -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
      Get-ChildItem $script:Pasta1 -Recurse -Filter 'abrir.ps1' -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
    }
    It 'não sobrou pasta de passagem' { Test-Path (Join-Path $script:P1 'Anvilore.novo') | Should -BeFalse }
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
      Test-Path (Join-Path $r.Perfil 'Anvilore.novo') | Should -BeFalse
    }
    foreach ($c in @(@{ N = 'sem assinatura'; M = 'sem-assinatura' }, @{ N = 'outra chave'; M = 'outra-chave' }, @{ N = 'nome da tag trocado'; M = 'nome-trocado' })) {
      It "recusa a tag $($c.N)" -TestCases @($c) {
        param($N, $M)
        $origem = Origem "ruim-$M" $M $script:Boa $script:Outra
        $r = Rodar (Perfil "ruim-$M") $origem $script:Release $script:PathComAgente
        $r.Codigo | Should -Be 3
        $r.Saida | Should -Match 'conferência de segurança'
        Test-Path (Join-Path $r.Perfil 'Anvilore') | Should -BeFalse
        Test-Path (Join-Path $r.Perfil 'Anvilore.novo') | Should -BeFalse
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
      Test-Path (Join-Path $r.Perfil 'Anvilore.novo') | Should -BeFalse
    }
  }

  Context 'configuração global do git da pessoa não pode ajudar uma candidata (A1 e A2 da revisão de segurança)' {
    # A1 - Dado um filtro de checkout (smudge) ou um hook na config global e uma candidata sem assinatura válida;
    # Quando o instalador baixa; Então recusa (código 3), apaga o staging e NADA da candidata rodou (marcador ausente).
    # Com tag válida a instalação termina e o filtro só roda depois da autenticação.
    # A2 - Dado um gpg.ssh.program aprovador na config global e uma tag assinada por chave fora dos assinantes;
    # Então recusa (código 3).
    BeforeAll {
      function script:Fw($caminho) { return ($caminho -replace '\\', '/') }
      function script:ConfigGlobal($nome, $texto) {
        $f = Join-Path $script:Base "gitconfig-$nome"
        [IO.File]::WriteAllText($f, $texto)
        return $f
      }
      function script:ConfigComFiltro($nome) {
        $m = Join-Path $script:Base "marcador-smudge-$nome"
        Remove-Item $m -ErrorAction SilentlyContinue
        $cfg = ConfigGlobal "filtro-$nome" ("[filter `"x`"]`n`tsmudge = `"printf executado >> '$(Fw $m)' && cat`"`n`tclean = cat`n")
        return @{ Config = $cfg; Marcador = $m }
      }
      function script:ConfigComHook($nome) {
        $m = Join-Path $script:Base "marcador-hook-$nome"
        Remove-Item $m -ErrorAction SilentlyContinue
        $pasta = Join-Path $script:Base "hooks-da-pessoa-$nome"
        New-Item -ItemType Directory $pasta -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $pasta 'reference-transaction'), "#!/bin/sh`nprintf `"`$1 `" >> '$(Fw $m)'`ncat >/dev/null`n")
        $cfg = ConfigGlobal "hook-$nome" ("[core]`n`thooksPath = $(Fw $pasta)`n")
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
      Test-Path (Join-Path $r.Perfil 'Anvilore.novo') | Should -BeFalse
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
    }
    It 'A2: gpg.ssh.program aprovador global + tag de chave fora dos assinantes: recusa' {
      $apr = Join-Path $script:Base 'aprova-tudo.sh'
      [IO.File]::WriteAllText($apr, "#!/bin/sh`ncase `"`$*`" in`n  *find-principals*) echo atacante@exemplo ;;`n  *) echo 'Good `"git`" signature for atacante@exemplo with ED25519 key SHA256:falso' ;;`nesac`nexit 0`n")
      $cfg = ConfigGlobal 'aprovador' ("[gpg `"ssh`"]`n`tprogram = $(Fw $apr)`n")
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

  Context 'versão e pasta pedidas (ANVILORE_VERSAO e ANVILORE_PASTA)' {
    # Dado uma origem em que a v0.0.2 é falsa (nome trocado) e a v0.0.1 é boa; Quando a pessoa pede a 0.0.1 numa pasta
    # com espaço; Então instala a 0.0.1 nessa pasta.
    BeforeAll {
      $origem = Origem 'duas' 'nome-trocado' $script:Boa $script:Outra
      $script:P5 = Perfil 'pin'
      $script:R5 = Rodar $script:P5 $origem $script:Release $script:PathComAgente @{ ANVILORE_VERSAO = '0.0.1'; ANVILORE_PASTA = "$($script:P5)\minha pasta" }
    }
    It 'termina completo'               { $script:R5.Codigo | Should -Be 0 }
    It 'instalou na pasta pedida, na tag pedida' {
      (& git -C "$($script:P5)\minha pasta" describe --tags --exact-match).Trim() | Should -Be 'v0.0.1'
      Test-Path (Join-Path $script:P5 'Anvilore') | Should -BeFalse
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
}
