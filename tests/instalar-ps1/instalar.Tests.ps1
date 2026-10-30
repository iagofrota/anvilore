# Testes unitários do instalador do Windows (Pester 5). Rodam em PowerShell 5.1 e 7: o CI usa o 5.1 no
# windows-latest; no Linux, `pwsh` (docker) cobre as funções que não dependem do Windows.
#
# Cada cenário segue Dado / Quando / Então, em comentário (sem Cucumber).

BeforeAll {
  $env:ANVILORE_PS1_SO_FUNCOES = '1'
  $script:Instalador = Join-Path $PSScriptRoot '..\..\instalador\instalar.ps1'
  # Carrega como a pessoa carrega (UTF-8 explícito): dot-source direto leria o arquivo sem BOM como ANSI no 5.1.
  . ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $script:Instalador)))
}

AfterAll { Remove-Item Env:ANVILORE_PS1_SO_FUNCOES -ErrorAction SilentlyContinue }

Describe 'forma do arquivo' {
  # Dado o instalador; Quando o PowerShell o lê; Então não há erro de sintaxe, nem BOM, nem `exit` solto.
  It 'não tem erro de sintaxe' {
    $erros = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($script:Instalador, [ref]$null, [ref]$erros)
    @($erros).Count | Should -Be 0
  }
  It 'é UTF-8 sem BOM (o Windows PowerShell 5.1 lê arquivo sem BOM como ANSI: quem chama usa -Encoding UTF8)' {
    $bytes = [System.IO.File]::ReadAllBytes($script:Instalador)
    ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) | Should -BeFalse
  }
  It 'nunca chama exit (num irm | iex fecharia o terminal da pessoa)' {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($script:Instalador, [ref]$null, [ref]$null)
    $saidas = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.ExitStatementAst] }, $true)
    @($saidas).Count | Should -Be 0
  }
}

Describe 'AnvPlataforma' {
  # Dado Windows 64 bits; Quando confere o sistema; Então é windows-x64. Windows arm64 e outros sistemas não são suportados.
  It 'reconhece Windows x64'          { AnvPlataforma -Sistema 'Windows_NT' -Arquitetura 'AMD64' | Should -Be 'windows-x64' }
  It 'recusa Windows arm64'           { AnvPlataforma -Sistema 'Windows_NT' -Arquitetura 'ARM64' | Should -BeNullOrEmpty }
  It 'recusa Windows de 32 bits'      { AnvPlataforma -Sistema 'Windows_NT' -Arquitetura 'x86'   | Should -BeNullOrEmpty }
  It 'recusa outro sistema'           { AnvPlataforma -Sistema '' -Arquitetura 'AMD64'           | Should -BeNullOrEmpty }
}

Describe 'AnvCompararVersao' {
  It 'igual'                          { AnvCompararVersao '1.4.1' '1.4.1' | Should -Be 0 }
  It 'compara por número, não texto'  { AnvCompararVersao '1.10.0' '1.9.9' | Should -Be 1 }
  It 'menor'                          { AnvCompararVersao '1.4.0' '1.4.1' | Should -Be -1 }
  It 'ignora sufixo (canary)'         { AnvCompararVersao '1.4.1-canary.3' '1.4.1' | Should -Be 0 }
  It 'texto que não é versão dá nulo' { AnvCompararVersao 'abc' '1.0.0' | Should -BeNullOrEmpty }
}

Describe 'AnvAdicionarAoPath' {
  # Dado um PATH; Quando acrescenta uma pasta; Então entra uma vez só, sem importar maiúsculas nem barra final.
  It 'acrescenta no fim'              { AnvAdicionarAoPath -Atual 'C:\a;C:\b' -Pasta 'C:\c' | Should -Be 'C:\a;C:\b;C:\c' }
  It 'acrescenta no início'           { AnvAdicionarAoPath -Atual 'C:\a;C:\b' -Pasta 'C:\c' -NoInicio | Should -Be 'C:\c;C:\a;C:\b' }
  It 'não repete (maiúsculas)'        { AnvAdicionarAoPath -Atual 'C:\a;C:\B' -Pasta 'c:\b' | Should -Be 'C:\a;C:\B' }
  It 'não repete (barra final)'       { AnvAdicionarAoPath -Atual 'C:\a;C:\b\' -Pasta 'C:\b' | Should -Be 'C:\a;C:\b\' }
  It 'preserva %VARIAVEL% como veio'  { AnvAdicionarAoPath -Atual '%USERPROFILE%\bin;C:\a' -Pasta 'C:\c' | Should -Be '%USERPROFILE%\bin;C:\a;C:\c' }
  It 'PATH vazio'                     { AnvAdicionarAoPath -Atual '' -Pasta 'C:\c' | Should -Be 'C:\c' }
  It 'ignora entradas vazias'         { AnvAdicionarAoPath -Atual 'C:\a;;' -Pasta 'C:\c' | Should -Be 'C:\a;C:\c' }
}

Describe 'AnvDependencia (adaptador do manifesto)' {
  BeforeAll { $script:M = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\..\instalador\dependencias.json') | ConvertFrom-Json }
  It 'acha a entrada pela plataforma' {
    $d = AnvDependencia -Manifesto $script:M -Nome 'bun' -Plataforma 'windows-x64'
    $d.versao | Should -Be '1.4.1'
    $d.sha256 | Should -Match '^[0-9a-f]{64}$'
    $d.url | Should -Match '^https://'
  }
  It 'o baseline do Bun é uma plataforma própria' {
    (AnvDependencia -Manifesto $script:M -Nome 'bun' -Plataforma 'windows-x64-baseline').url | Should -Match 'baseline'
  }
  It 'traz o PortableGit com o tamanho' {
    (AnvDependencia -Manifesto $script:M -Nome 'portablegit' -Plataforma 'windows-x64').tamanhoMB | Should -Be 392
  }
  It 'plataforma sem entrada dá nulo'  { AnvDependencia -Manifesto $script:M -Nome 'rg' -Plataforma 'macos-x64' | Should -BeNullOrEmpty }
  It 'dependência sem entrada dá nulo' { AnvDependencia -Manifesto $script:M -Nome 'nada' -Plataforma 'windows-x64' | Should -BeNullOrEmpty }
  It 'manifesto nulo dá nulo'          { AnvDependencia -Manifesto $null -Nome 'bun' -Plataforma 'windows-x64' | Should -BeNullOrEmpty }
  It 'entrada sem hash válido é recusada' {
    $ruim = '{"dependencias":{"bun":{"versao":"1.0.0","plataformas":{"windows-x64":{"url":"https://x/y.zip","sha256":"abc"}}}}}' | ConvertFrom-Json
    AnvDependencia -Manifesto $ruim -Nome 'bun' -Plataforma 'windows-x64' | Should -BeNullOrEmpty
  }
  It 'entrada com URL que não é https é recusada' {
    $ruim = '{"dependencias":{"bun":{"versao":"1.0.0","plataformas":{"windows-x64":{"url":"http://x/y.zip","sha256":"52b1f3028b01f43d37fefdf669d034a1ee2e0d96c56bb13c393bdaf169b1af84"}}}}}' | ConvertFrom-Json
    AnvDependencia -Manifesto $ruim -Nome 'bun' -Plataforma 'windows-x64' | Should -BeNullOrEmpty
  }
}

Describe 'AnvLerManifesto' {
  It 'sem manifesto embutido nem arquivo de apoio: nulo' {
    AnvLerManifesto -Embutido '' -Arquivo '' | Should -BeNullOrEmpty
  }
  It 'embutido vale' {
    $m = AnvLerManifesto -Embutido '{"dependencias":{"bun":{"x":1}}}' -Arquivo ''
    $m.dependencias.bun | Should -Not -BeNullOrEmpty
  }
  It 'arquivo de apoio só vale com o embutido vazio' {
    $f = Join-Path $TestDrive 'm.json'; Set-Content $f '{"dependencias":{"rg":{"x":1}}}'
    (AnvLerManifesto -Embutido '' -Arquivo $f).dependencias.rg | Should -Not -BeNullOrEmpty
    $m = AnvLerManifesto -Embutido '{"dependencias":{"bun":{"x":1}}}' -Arquivo $f
    $m.dependencias.rg | Should -BeNullOrEmpty
  }
  It 'JSON quebrado dá nulo' { AnvLerManifesto -Embutido '{nao e json' -Arquivo '' | Should -BeNullOrEmpty }
}

Describe 'AnvAssinantes' {
  # Dado o instalador sem chave embutida; Quando pede os assinantes; Então não há confiança nenhuma (nulo).
  It 'embutido vazio e sem arquivo: nulo (nada é aceito)' {
    AnvAssinantes -Embutido "# só comentário`n`n" -Arquivo '' | Should -BeNullOrEmpty
  }
  It 'embutido com chave vale' {
    $linha = 'iago@exemplo namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXEMPLOEXEMPLOEXEMPLOEXEMPLOEXEMPLOEXEMPLO12'
    AnvAssinantes -Embutido "# comentário`n$linha`n" -Arquivo '' | Should -Match 'ssh-ed25519'
  }
  It 'arquivo de apoio só vale com o embutido vazio (o do CI e do QA)' {
    $f = Join-Path $TestDrive 'a.txt'; Set-Content $f 'ci namespaces="git" ssh-ed25519 AAAAteste'
    AnvAssinantes -Embutido '' -Arquivo $f | Should -Match 'AAAAteste'
  }
  It 'arquivo de apoio é ignorado quando há chave embutida' {
    $f = Join-Path $TestDrive 'a2.txt'; Set-Content $f 'ladrao namespaces="git" ssh-ed25519 AAAAladrao'
    $r = AnvAssinantes -Embutido 'iago namespaces="git" ssh-ed25519 AAAAreal' -Arquivo $f
    $r | Should -Match 'AAAAreal'
    $r | Should -Not -Match 'AAAAladrao'
  }
  It 'arquivo de apoio vazio: nulo' {
    $f = Join-Path $TestDrive 'a3.txt'; Set-Content $f "# nada`n"
    AnvAssinantes -Embutido '' -Arquivo $f | Should -BeNullOrEmpty
  }
}

Describe 'AnvEscolherTag' {
  # Dado a lista do `git ls-remote --tags`; Quando escolhe a versão; Então é a estável mais alta.
  It 'escolhe a mais alta por número' {
    $l = @("a`trefs/tags/v0.9.0", "b`trefs/tags/v0.10.0", "c`trefs/tags/v0.2.0")
    AnvEscolherTag $l | Should -Be 'v0.10.0'
  }
  It 'ignora pré-lançamento no canal estável' {
    AnvEscolherTag @("a`trefs/tags/v1.0.0-rc.1", "b`trefs/tags/v0.3.0") | Should -Be 'v0.3.0'
  }
  It 'ignora a linha ^{} e tags que não são versão' {
    AnvEscolherTag @("a`trefs/tags/v0.3.0^{}", "b`trefs/tags/prova", "c`trefs/tags/v0.3.0") | Should -Be 'v0.3.0'
  }
  It 'sem versão publicada: nulo' { AnvEscolherTag @() | Should -BeNullOrEmpty }
  It 'só pré-lançamento: nulo'    { AnvEscolherTag @("a`trefs/tags/v1.0.0-rc.1") | Should -BeNullOrEmpty }
}

Describe 'AnvIdentidadeDaTag' {
  # `verify-tag` só prova que o objeto foi assinado, não que o NOME assinado é o da ref (como no atualizador).
  BeforeAll {
    $script:Commit = 'a' * 40
    $script:Ok = "object $($script:Commit)`ntype commit`ntag v0.3.0`ntagger Iago <i@x> 1 +0000`n`nmsg`n"
  }
  It 'aceita tag anotada com o nome certo e o commit do clone' {
    AnvIdentidadeDaTag -Cabecalho $script:Ok -Tag 'v0.3.0' -Commit $script:Commit | Should -BeNullOrEmpty
  }
  It 'recusa nome assinado diferente (ref trocada)' {
    AnvIdentidadeDaTag -Cabecalho $script:Ok -Tag 'v0.3.1' -Commit $script:Commit | Should -Match 'v0\.3\.0'
  }
  It 'recusa tag que não aponta para commit' {
    $c = $script:Ok -replace 'type commit', 'type tree'
    AnvIdentidadeDaTag -Cabecalho $c -Tag 'v0.3.0' -Commit $script:Commit | Should -Not -BeNullOrEmpty
  }
  It 'recusa quando o commit assinado não é o que foi baixado' {
    AnvIdentidadeDaTag -Cabecalho $script:Ok -Tag 'v0.3.0' -Commit ('b' * 40) | Should -Not -BeNullOrEmpty
  }
  It 'recusa cabeçalho vazio' {
    AnvIdentidadeDaTag -Cabecalho '' -Tag 'v0.3.0' -Commit $script:Commit | Should -Not -BeNullOrEmpty
  }
}

Describe 'AnvTemAssinaturaSsh' {
  # Dado o conteúdo de uma tag; Quando procuro o bloco de assinatura; Então só o bloco SSH vale (OpenPGP e x509 passariam
  # pelo gpg da pessoa, com o chaveiro dela, mesmo com gpg.format=ssh).
  It 'aceita o bloco SSH' {
    AnvTemAssinaturaSsh "object a`ntype commit`ntag v1`n`nmsg`n-----BEGIN SSH SIGNATURE-----`nU1NIU0lH`n-----END SSH SIGNATURE-----`n" | Should -BeTrue
  }
  It 'aceita o bloco SSH com fim de linha do Windows' {
    AnvTemAssinaturaSsh "msg`r`n-----BEGIN SSH SIGNATURE-----`r`nx`r`n" | Should -BeTrue
  }
  It 'recusa assinatura OpenPGP' {
    AnvTemAssinaturaSsh "msg`n-----BEGIN PGP SIGNATURE-----`nabc`n-----END PGP SIGNATURE-----`n" | Should -BeFalse
  }
  It 'recusa assinatura x509' {
    AnvTemAssinaturaSsh "msg`n-----BEGIN SIGNED MESSAGE-----`nabc`n" | Should -BeFalse
  }
  It 'recusa o texto da assinatura escrito no meio da mensagem' {
    AnvTemAssinaturaSsh "msg -----BEGIN SSH SIGNATURE----- no meio" | Should -BeFalse
  }
  It 'recusa tag sem assinatura' { AnvTemAssinaturaSsh "object a`ntype commit`n`nmsg`n" | Should -BeFalse }
}

Describe 'argumentos do git para a candidata (A1 e A2)' {
  BeforeAll { $script:Vazio = 'C:\tmp\sem-hooks'; $script:Ass = 'C:\tmp\assinantes' }
  It 'A1: o clone é sem checkout' {
    $a = AnvArgsClone -Origem 'C:\origem' -Tag 'v1.2.3' -Staging 'C:\st' -HooksVazio $script:Vazio
    $a | Should -Contain '--no-checkout'
    $a | Should -Contain 'core.autocrlf=false'
    $a[($a.IndexOf('--branch') + 1)] | Should -Be 'v1.2.3'
  }
  It 'A1: todo comando do staging começa com core.hooksPath para a pasta vazia' {
    $a = AnvArgsStaging -HooksVazio $script:Vazio -Argumentos @('-C', 'C:\st', 'cat-file', '-t', 'x')
    $a[0] | Should -Be '-c'; $a[1] | Should -Be "core.hooksPath=$($script:Vazio)"
    $a[-1] | Should -Be 'x'
  }
  It 'A1: o clone também desliga os hooks' {
    (AnvArgsClone -Origem 'o' -Tag 'v1.0.0' -Staging 's' -HooksVazio $script:Vazio)[1] | Should -Be "core.hooksPath=$($script:Vazio)"
  }
  It 'A2: o verify-tag fixa o verificador SSH e os programas de gpg/x509' {
    $a = AnvArgsVerificarTag -Staging 'C:\st' -Ref 'refs/tags/v1.2.3' -Assinantes $script:Ass -HooksVazio $script:Vazio
    foreach ($o in @("core.hooksPath=$($script:Vazio)", 'gpg.format=ssh', 'gpg.ssh.program=ssh-keygen', 'gpg.program=false', 'gpg.openpgp.program=false', 'gpg.x509.program=false', "gpg.ssh.allowedSignersFile=$($script:Ass)")) {
      $i = [array]::IndexOf($a, $o)
      $i | Should -BeGreaterThan 0
      $a[$i - 1] | Should -Be '-c'
    }
    $a[-2] | Should -Be 'verify-tag'
    $a[-1] | Should -Be 'refs/tags/v1.2.3'
  }
  It 'A1: o checkout só vem depois, do commit verificado, forçado e destacado' {
    $a = AnvArgsCheckout -Staging 'C:\st' -Commit ('a' * 40)
    ($a -join ' ') | Should -Be "-C C:\st checkout --quiet --force --detach $('a' * 40)"
  }
}

Describe 'AnvEscolherPasta (ANVILORE_PASTA)' {
  AfterEach { Remove-Item Env:ANVILORE_PASTA, Env:ANVILORE_SEM_PERGUNTAS -ErrorAction SilentlyContinue }
  It 'sem a variável, usa Anvilore dentro do perfil' {
    AnvEscolherPasta -Perfil $TestDrive | Should -Be (Join-Path $TestDrive 'Anvilore')
  }
  It 'usa a pasta pedida, se não existe' {
    $env:ANVILORE_PASTA = Join-Path $TestDrive 'minha'
    AnvEscolherPasta -Perfil $TestDrive | Should -Be (Join-Path $TestDrive 'minha')
  }
  It 'aceita pasta vazia que já existe' {
    $env:ANVILORE_PASTA = Join-Path $TestDrive 'vazia'; New-Item -ItemType Directory $env:ANVILORE_PASTA | Out-Null
    AnvEscolherPasta -Perfil $TestDrive | Should -Be $env:ANVILORE_PASTA
  }
  It 'pasta de outra coisa: sem perguntas, para sem mexer' {
    $env:ANVILORE_PASTA = Join-Path $TestDrive 'ocupada'; New-Item -ItemType Directory $env:ANVILORE_PASTA | Out-Null
    Set-Content (Join-Path $env:ANVILORE_PASTA 'arquivo.txt') 'meu'
    $env:ANVILORE_SEM_PERGUNTAS = '1'
    { AnvEscolherPasta -Perfil $TestDrive } | Should -Throw '*ANV-PARAR:1:*'
    Get-Content (Join-Path $env:ANVILORE_PASTA 'arquivo.txt') | Should -Be 'meu'
  }
}

Describe 'AnvEhInstalacao (critério igual ao do instalar.sh: estrutura do kit)' {
  # Dado uma pasta; Quando o instalador decide se é uma instalação do Anvilore; Então vale a estrutura do kit (.git, AGENTS.md,
  # src\cli.ts, skills\), sem exigir o estado da atualização nem o conteúdo do package.json (a versão é lida depois, pela base mínima).
  BeforeEach {
    $script:K = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory (Join-Path $script:K '.git'), (Join-Path $script:K 'src'), (Join-Path $script:K 'skills') -Force | Out-Null
    Set-Content (Join-Path $script:K 'AGENTS.md') 'contrato'
    Set-Content (Join-Path $script:K 'src\cli.ts') 'x'
  }
  It 'pasta com a estrutura do kit é instalação, mesmo sem o estado da atualização e sem package.json' {
    AnvEhInstalacao -Pasta $script:K | Should -BeTrue
  }
  It 'package.json ilegível não muda a classificação' {
    New-Item -ItemType Directory (Join-Path $script:K 'package.json') | Out-Null
    AnvEhInstalacao -Pasta $script:K | Should -BeTrue
  }
  It 'sem .git não é' { Remove-Item (Join-Path $script:K '.git') -Recurse -Force; AnvEhInstalacao -Pasta $script:K | Should -BeFalse }
  It 'sem AGENTS.md não é' { Remove-Item (Join-Path $script:K 'AGENTS.md'); AnvEhInstalacao -Pasta $script:K | Should -BeFalse }
  It 'sem src\cli.ts não é' { Remove-Item (Join-Path $script:K 'src\cli.ts'); AnvEhInstalacao -Pasta $script:K | Should -BeFalse }
  It 'sem skills\ não é' { Remove-Item (Join-Path $script:K 'skills') -Recurse -Force; AnvEhInstalacao -Pasta $script:K | Should -BeFalse }
  It 'pasta de outra coisa com package.json anvilore não é' {
    $o = Join-Path $TestDrive 'outra-coisa'; New-Item -ItemType Directory (Join-Path $o '.git') -Force | Out-Null
    Set-Content (Join-Path $o 'package.json') '{"name":"anvilore","version":"0.2.0"}'
    AnvEhInstalacao -Pasta $o | Should -BeFalse
  }
}

Describe 'AnvBaseMinima (a versão mínima embutida no instalador)' {
  # Dado o instalador; Quando pede a base mínima; Então só uma versão X.Y.Z vale. Vazia ou inválida: nulo (o instalador recusa reinstalar).
  It 'versão válida' { AnvBaseMinima -Embutido "0.3.0`n" | Should -Be '0.3.0' }
  It 'sem quebra de linha final também' { AnvBaseMinima -Embutido '0.3.0' | Should -Be '0.3.0' }
  It 'vazia: nulo' { AnvBaseMinima -Embutido '' | Should -BeNullOrEmpty }
  It 'pré-release: nulo' { AnvBaseMinima -Embutido '0.3.0-rc.1' | Should -BeNullOrEmpty }
  It 'texto: nulo' { AnvBaseMinima -Embutido 'nova' | Should -BeNullOrEmpty }
  It 'duas linhas: nulo' { AnvBaseMinima -Embutido "0.3.0`n0.4.0" | Should -BeNullOrEmpty }
}

Describe 'AnvLerVersaoDaPasta (lê o package.json sem executar nada da pasta)' {
  BeforeEach {
    $script:V = Join-Path $TestDrive ([guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $script:V | Out-Null
    $script:Marca = Join-Path $TestDrive 'marcador-leitura'; Remove-Item $script:Marca -ErrorAction SilentlyContinue
    # Se a leitura executasse o cli.ts ou o bunfig.toml da pasta, o marcador apareceria.
    New-Item -ItemType Directory (Join-Path $script:V 'src') | Out-Null
    Set-Content (Join-Path $script:V 'src\cli.ts') "require('fs').writeFileSync('$($script:Marca -replace '\\','/')', 'x')"
  }
  It 'lê a versão e não executa nada' {
    Set-Content (Join-Path $script:V 'package.json') '{"name":"anvilore","version":"0.3.0"}'
    AnvLerVersaoDaPasta -Pasta $script:V | Should -Be '0.3.0'
    Test-Path $script:Marca | Should -BeFalse
  }
  It 'aceita BOM no começo' {
    [IO.File]::WriteAllBytes((Join-Path $script:V 'package.json'), ([byte[]](0xEF,0xBB,0xBF) + [Text.Encoding]::UTF8.GetBytes('{"version":"1.2.3"}')))
    AnvLerVersaoDaPasta -Pasta $script:V | Should -Be '1.2.3'
  }
  It 'ausente: nulo' { AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
  It 'pasta no lugar do arquivo: nulo' { New-Item -ItemType Directory (Join-Path $script:V 'package.json') | Out-Null; AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
  It 'bytes que não são texto: nulo' { [IO.File]::WriteAllBytes((Join-Path $script:V 'package.json'), [byte[]](0xFF,0xFE,0x00,0x80,0x7B)); AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
  It 'que não é JSON: nulo' { Set-Content (Join-Path $script:V 'package.json') '{ nao e json'; AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
  It 'lista: nulo' { Set-Content (Join-Path $script:V 'package.json') '[]'; AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
  It 'sem version: nulo' { Set-Content (Join-Path $script:V 'package.json') '{"name":"anvilore"}'; AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
  It 'version só dentro de dependencies: nulo' { Set-Content (Join-Path $script:V 'package.json') '{"dependencies":{"version":"9.9.9"}}'; AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
  It 'version número: nulo' { Set-Content (Join-Path $script:V 'package.json') '{"version":3}'; AnvLerVersaoDaPasta -Pasta $script:V | Should -BeNullOrEmpty }
}

Describe 'AnvVerificarBaseMinima (menor, ausente, inválida e pré-release recusam; igual ou maior segue)' {
  BeforeEach { $script:W = Join-Path $TestDrive ([guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $script:W | Out-Null }
  It '<nome>' -ForEach @(
    @{ nome = 'igual à base segue';                    json = '{"version":"0.3.0"}';          base = '0.3.0'; ok = $true;  motivo = '' }
    @{ nome = 'patch maior segue';                     json = '{"version":"0.3.1"}';          base = '0.3.0'; ok = $true;  motivo = '' }
    @{ nome = '0.10.0 contra 0.9.0 segue (número)';    json = '{"version":"0.10.0"}';         base = '0.9.0'; ok = $true;  motivo = '' }
    @{ nome = 'major maior segue';                     json = '{"version":"1.0.0"}';          base = '0.3.0'; ok = $true;  motivo = '' }
    @{ nome = 'v0.2.0 recusa como antiga';             json = '{"version":"0.2.0"}';          base = '0.3.0'; ok = $false; motivo = 'antiga' }
    @{ nome = '0.8.9 contra 0.9.0 recusa como antiga'; json = '{"version":"0.8.9"}';          base = '0.9.0'; ok = $false; motivo = 'antiga' }
    @{ nome = 'pré-release acima da base recusa';      json = '{"version":"0.3.1-beta"}';     base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
    @{ nome = 'pré-release da base recusa';            json = '{"version":"0.3.0-rc.1"}';     base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
    @{ nome = 'metadado de build recusa';              json = '{"version":"0.3.0+abc"}';      base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
    @{ nome = 'com v na frente recusa';                json = '{"version":"v0.3.0"}';         base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
    @{ nome = 'só major.minor recusa';                 json = '{"version":"0.3"}';            base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
    @{ nome = 'zero à esquerda recusa';                json = '{"version":"0.03.0"}';         base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
    @{ nome = 'duas linhas recusa';                    json = '{"version":"0.3.0\n9.9.9"}';   base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
    @{ nome = 'número gigante recusa';                 json = '{"version":"99999999999999999999.0.0"}'; base = '0.3.0'; ok = $false; motivo = 'desconhecida' }
  ) {
    Set-Content (Join-Path $script:W 'package.json') $json
    $r = AnvVerificarBaseMinima -Pasta $script:W -Base $base
    $r.Ok | Should -Be $ok
    $r.Motivo | Should -Be $motivo
  }
  It 'package.json ausente recusa como desconhecida' {
    $r = AnvVerificarBaseMinima -Pasta $script:W -Base '0.3.0'
    $r.Ok | Should -BeFalse
    $r.Motivo | Should -Be 'desconhecida'
  }
}

Describe 'AnvMensagemBaseMinima (linguagem simples, sem comando técnico)' {
  It 'versão antiga: diz a versão, a primeira assinada, que nada foi mudado e o caminho da pasta nova' {
    $m = AnvMensagemBaseMinima -Pasta 'C:\Anvilore' -Resultado @{ Ok = $false; Motivo = 'antiga'; Versao = '0.2.0' } -Base '0.3.0'
    $m | Should -Match 'anterior à primeira versão assinada'
    $m | Should -Match '0\.2\.0'
    $m | Should -Match 'nada foi mudado'
    $m | Should -Match 'numa pasta nova'
    $m | Should -Match 'de forma conferida'
    $m | Should -Match 'cópia de segurança'
    $m | Should -Not -Match 'bun |cli\.ts|atualizar'
  }
  It 'versão desconhecida: diz que não reconhece e dá o mesmo caminho' {
    $m = AnvMensagemBaseMinima -Pasta 'C:\Anvilore' -Resultado @{ Ok = $false; Motivo = 'desconhecida'; Versao = '' } -Base '0.3.0'
    $m | Should -Match 'Não reconheço a versão do Anvilore'
    $m | Should -Match 'nada foi mudado'
    $m | Should -Match 'numa pasta nova'
  }
}

Describe 'AnvConfirmar' {
  AfterEach { Remove-Item Env:ANVILORE_SEM_PERGUNTAS -ErrorAction SilentlyContinue }
  # Dado ANVILORE_SEM_PERGUNTAS=1 (CI); Quando o instalador pergunta; Então responde o padrão, sem esperar.
  It 'sem perguntas devolve o padrão sim' {
    $env:ANVILORE_SEM_PERGUNTAS = '1'; AnvConfirmar -Pergunta 'ok?' -Padrao $true | Should -BeTrue
  }
  It 'sem perguntas devolve o padrão não' {
    $env:ANVILORE_SEM_PERGUNTAS = '1'; AnvConfirmar -Pergunta 'ok?' -Padrao $false | Should -BeFalse
  }
  It 'com pergunta, S e N' {
    Remove-Item Env:ANVILORE_SEM_PERGUNTAS -ErrorAction SilentlyContinue
    Mock Read-Host { 's' }; AnvConfirmar -Pergunta 'ok?' -Padrao $false | Should -BeTrue
    Mock Read-Host { 'N' }; AnvConfirmar -Pergunta 'ok?' -Padrao $true | Should -BeFalse
    Mock Read-Host { '' };  AnvConfirmar -Pergunta 'ok?' -Padrao $true | Should -BeTrue
  }
}

Describe 'registro em .anvilore\instalacao.log' {
  BeforeEach { AnvReiniciarLog }
  AfterEach { AnvReiniciarLog }
  It 'guarda na memória até a pasta existir e depois grava tudo' {
    $pasta = Join-Path $TestDrive 'Anvilore'
    AnvRegistrar 'primeira linha'
    Test-Path $pasta | Should -BeFalse
    AnvDefinirLog -Pasta $pasta
    AnvRegistrar 'segunda linha'
    $texto = Get-Content -Raw -Encoding UTF8 (Join-Path $pasta '.anvilore\instalacao.log')
    $texto | Should -Match 'primeira linha'
    $texto | Should -Match 'segunda linha'
  }
  It 'não grava usuário sem senha nem token github_pat_ em URL' {
    $pasta = Join-Path $TestDrive 'Anvilore3'
    AnvDefinirLog -Pasta $pasta
    AnvRegistrar 'clone https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/x/y.git e github_pat_11ABCDEF_xyz123'
    $l = Get-Content -Raw -Encoding UTF8 (Join-Path $pasta '.anvilore\instalacao.log')
    $l | Should -Not -Match 'ghp_abcdefghijklmnop'
    $l | Should -Not -Match 'github_pat_11ABCDEF'
  }
  It 'não grava segredo conhecido (token em URL)' {
    $pasta = Join-Path $TestDrive 'Anvilore2'
    AnvDefinirLog -Pasta $pasta
    AnvRegistrar 'clone https://usuario:segredo123@github.com/x/y.git'
    (Get-Content -Raw -Encoding UTF8 (Join-Path $pasta '.anvilore\instalacao.log')) | Should -Not -Match 'segredo123'
  }
}

Describe 'AnvBaixarComHash' {
  # Dado um download; Quando o hash não confere; Então o arquivo é apagado e o resultado diz isso (cenário 33).
  BeforeAll { $script:Conteudo = 'conteudo de teste'; $script:Hash = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($script:Conteudo))) -Algorithm SHA256).Hash.ToLower() }
  It 'hash certo: ok e o arquivo fica' {
    Mock Invoke-WebRequest { Set-Content -LiteralPath $OutFile -Value $script:Conteudo -NoNewline }
    $d = Join-Path $TestDrive 'ok.bin'
    AnvBaixarComHash -Dependencia ([pscustomobject]@{ url = 'https://x/y'; sha256 = $script:Hash }) -Destino $d | Should -Be 'ok'
    Test-Path $d | Should -BeTrue
  }
  It 'hash errado: hash-diferente e o arquivo é apagado' {
    Mock Invoke-WebRequest { Set-Content -LiteralPath $OutFile -Value 'adulterado' -NoNewline }
    $d = Join-Path $TestDrive 'ruim.bin'
    AnvBaixarComHash -Dependencia ([pscustomobject]@{ url = 'https://x/y'; sha256 = $script:Hash }) -Destino $d | Should -Be 'hash-diferente'
    Test-Path $d | Should -BeFalse
  }
  It 'download que falha: falha-download' {
    Mock Invoke-WebRequest { throw 'sem rede' }
    $d = Join-Path $TestDrive 'nada.bin'
    AnvBaixarComHash -Dependencia ([pscustomobject]@{ url = 'https://x/y'; sha256 = $script:Hash }) -Destino $d | Should -Be 'falha-download'
    Test-Path $d | Should -BeFalse
  }
  It 'compara o hash sem importar maiúsculas' {
    Mock Invoke-WebRequest { Set-Content -LiteralPath $OutFile -Value $script:Conteudo -NoNewline }
    $d = Join-Path $TestDrive 'caixa.bin'
    AnvBaixarComHash -Dependencia ([pscustomobject]@{ url = 'https://x/y'; sha256 = $script:Hash.ToUpper() }) -Destino $d | Should -Be 'ok'
  }
}

Describe 'AnvResultadoFinal' {
  # Dado o que ficou pronto; Quando resume; Então o código distingue completo (0) de parcial (10).
  It 'completo'                { (AnvResultadoFinal -TemAgente $true -DoctorOk $true).Codigo | Should -Be 0 }
  It 'sem agente é parcial'    { (AnvResultadoFinal -TemAgente $false -DoctorOk $false).Codigo | Should -Be 10 }
  It 'doctor reprovou com agente é falha' { (AnvResultadoFinal -TemAgente $true -DoctorOk $false).Codigo | Should -Be 1 }
  It 'completo com atalho aponta para o atalho' {
    (AnvResultadoFinal -TemAgente $true -DoctorOk $true -Atalho $true).Linhas -join ' ' | Should -Match 'atalho Anvilore'
  }
  It 'completo sem atalho aponta para o agente na pasta' {
    (AnvResultadoFinal -TemAgente $true -DoctorOk $true -Atalho $false).Linhas -join ' ' | Should -Match 'abra o seu agente'
  }
  It 'completo avisa para fechar e abrir o terminal (PATH novo)' {
    (AnvResultadoFinal -TemAgente $true -DoctorOk $true).Linhas -join ' ' | Should -Match 'Feche e abra o terminal'
  }
  It 'sem rg avisa que a busca fica indisponível' {
    (AnvResultadoFinal -TemAgente $true -DoctorOk $true -SemRg $true).Linhas -join ' ' | Should -Match 'sem o ripgrep'
  }
  It 'sem agente diz para instalar um e rodar de novo' {
    (AnvResultadoFinal -TemAgente $false -DoctorOk $false).Linhas -join ' ' | Should -Match 'rode o instalador de novo'
  }
}

Describe 'PATH e variáveis do usuário no registro' -Skip:($env:OS -ne 'Windows_NT') {
  # Dado o PATH do usuário com %VARIAVEL%; Quando o instalador acrescenta uma pasta; Então o valor continua REG_EXPAND_SZ
  # e a parte com %VARIAVEL% não é expandida. Usa uma chave de teste, nunca o HKCU\Environment real.
  BeforeEach {
    $script:Chave = 'HKCU:\Software\AnviloreTeste\Env'
    AnvDefinirChaveEnv -Chave $script:Chave
    Remove-Item 'HKCU:\Software\AnviloreTeste' -Recurse -ErrorAction SilentlyContinue
    New-Item $script:Chave -Force | Out-Null
    New-ItemProperty -Path $script:Chave -Name 'Path' -Value '%USERPROFILE%\bin;C:\a' -PropertyType ExpandString | Out-Null
  }
  AfterAll { Remove-Item 'HKCU:\Software\AnviloreTeste' -Recurse -ErrorAction SilentlyContinue; AnvDefinirChaveEnv -Chave 'HKCU:\Environment' }

  foreach ($via in @($false, $true)) {
    $nome = if ($via) { 'via reg.exe (Constrained Language Mode)' } else { 'via registro' }
    It "acrescenta ao PATH do usuário $nome, preserva REG_EXPAND_SZ e não expande" {
      AnvAcrescentarPathUsuario -Pasta 'C:\novo' -ForcarRegExe:$via
      $chave = Get-Item $script:Chave
      $chave.GetValueKind('Path').ToString() | Should -Be 'ExpandString'
      $chave.GetValue('Path', '', 'DoNotExpandEnvironmentNames') | Should -Be '%USERPROFILE%\bin;C:\a;C:\novo'
    }
    It "é idempotente $nome" {
      AnvAcrescentarPathUsuario -Pasta 'C:\novo' -ForcarRegExe:$via
      AnvAcrescentarPathUsuario -Pasta 'C:\novo' -ForcarRegExe:$via
      (Get-Item $script:Chave).GetValue('Path', '', 'DoNotExpandEnvironmentNames') | Should -Be '%USERPROFILE%\bin;C:\a;C:\novo'
    }
    It "grava variável de usuário $nome" {
      AnvGravarVariavelUsuario -Nome 'ANVILORE_TESTE_VAR' -Valor 'C:\Program Files\x y' -ForcarRegExe:$via
      (Get-Item $script:Chave).GetValue('ANVILORE_TESTE_VAR') | Should -Be 'C:\Program Files\x y'
    }
  }
  It 'cria o PATH do usuário se ele não existir' {
    Remove-ItemProperty -Path $script:Chave -Name 'Path'
    AnvAcrescentarPathUsuario -Pasta 'C:\novo'
    (Get-Item $script:Chave).GetValue('Path', '', 'DoNotExpandEnvironmentNames') | Should -Be 'C:\novo'
  }
  It 'detecta o modo de linguagem' { AnvModoLinguagem | Should -Be 'FullLanguage' }
}

Describe 'transporte do git antes da assinatura (A5)' {
  # Dado uma chamada de rede do git (ls-remote ou clone) antes de a tag ser autenticada; Quando os argumentos e o ambiente são
  # montados; Então só o protocolo da origem é aceito (GIT_ALLOW_PROTOCOL vence qualquer protocol.<nome>.allow da config da pessoa),
  # o helper de credencial e o askpass ficam zerados e não há prompt de terminal.
  BeforeAll { $script:Vazio = 'C:\tmp\sem-hooks' }
  It 'AnvProtocolosDaOrigem: a origem oficial e qualquer https usam só https' {
    AnvProtocolosDaOrigem -Origem $script:AnvOrigemPadrao | Should -Be 'https'
    AnvProtocolosDaOrigem -Origem 'https://exemplo.com/x.git' | Should -Be 'https'
  }
  It 'AnvProtocolosDaOrigem: caminho local do teste usa só file' {
    AnvProtocolosDaOrigem -Origem 'C:\anv\origem' | Should -Be 'file'
    AnvProtocolosDaOrigem -Origem 'C:/anv/origem' | Should -Be 'file'
    AnvProtocolosDaOrigem -Origem '\\servidor\pasta' | Should -Be 'file'
    AnvProtocolosDaOrigem -Origem 'file:///C:/anv/origem' | Should -Be 'file'
  }
  It 'AnvProtocolosDaOrigem: ssh só quando a origem é ssh' { AnvProtocolosDaOrigem -Origem 'ssh://git@github.com/a/b.git' | Should -Be 'ssh' }
  It 'AnvProtocolosDaOrigem: ext, fd, git e http nunca entram (cai em https, que o git não confunde com eles)' {
    foreach ($o in @('ext::sh -c x', 'fd::3', 'git://exemplo/x.git', 'http://exemplo/x.git', '')) { AnvProtocolosDaOrigem -Origem $o | Should -Be 'https' }
  }
  It 'AnvAmbienteRede: protocolo da origem, sem prompt e sem askpass' {
    $a = AnvAmbienteRede -Origem 'C:\anv\origem'
    $a['GIT_ALLOW_PROTOCOL'] | Should -Be 'file'
    $a['GIT_TERMINAL_PROMPT'] | Should -Be '0'
    $a['GIT_ASKPASS'] | Should -Be 'false'
  }
  It 'AnvArgsClone: leva o helper de credencial e o askpass zerados, depois do core.hooksPath' {
    $a = AnvArgsClone -Origem 'o' -Tag 'v1.0.0' -Staging 's' -HooksVazio $script:Vazio
    $a[0] | Should -Be '-c'; $a[1] | Should -Be "core.hooksPath=$($script:Vazio)"
    foreach ($o in @('credential.helper=', 'core.askPass=')) {
      $i = [array]::IndexOf($a, $o)
      $i | Should -BeGreaterThan 0
      $a[$i - 1] | Should -Be '-c'
      $i | Should -BeLessThan ([array]::IndexOf($a, 'clone'))
    }
  }
  It 'AnvArgsLsRemote: mesma guarda do clone, com a origem no fim' {
    $a = AnvArgsLsRemote -Origem 'C:\anv\origem' -HooksVazio $script:Vazio
    $a[1] | Should -Be "core.hooksPath=$($script:Vazio)"
    ($a -contains 'credential.helper=') | Should -BeTrue
    ($a -contains 'core.askPass=') | Should -BeTrue
    $a[-1] | Should -Be 'C:\anv\origem'
    $a | Should -Contain 'ls-remote'
  }
  It 'AnvExecutarComAmbiente: o programa vê o ambiente e, depois, o valor anterior volta (e o que não existia some)' {
    $env:ANV_TESTE_A = 'antes'; Remove-Item Env:ANV_TESTE_B -ErrorAction SilentlyContinue
    $r = AnvExecutarComAmbiente -Exe 'cmd.exe' -Argumentos @('/c', 'echo %ANV_TESTE_A%-%ANV_TESTE_B%') -Ambiente @{ ANV_TESTE_A = 'dentro'; ANV_TESTE_B = 'novo' }
    $r.Saida.Trim() | Should -Be 'dentro-novo'
    $env:ANV_TESTE_A | Should -Be 'antes'
    (Test-Path Env:ANV_TESTE_B) | Should -BeFalse
    Remove-Item Env:ANV_TESTE_A -ErrorAction SilentlyContinue
  }
}

# Estado das chaves fora do GitHub (PARECER-SOL §2): a lista que o dono publica no site; o instalador só vale a interseção dela
# com as chaves embutidas. O comportamento de ponta a ponta (servidor de loopback, reinstalação) está em e2e.Tests.ps1.
Describe 'estado das chaves: URL, documento, fingerprint e interseção' {
  BeforeAll {
    $script:FpA = 'SHA256:/JgFK5PwZmasglTqgzoAjmXPyJUZMG00A2M8/094SLc'
    $script:FpB = 'SHA256:dqanDdeEV020uGcmGitbT6dlSS+jHYoL2XMmXUpqCD8'
    $script:LinhaA = 'unit@anvilore.test namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILzBKzpYMJNV3yvlaRIPDKwIjuHnYW4sJuBuwlXqU8+v'
    $script:LinhaB = 'unit2@anvilore.test namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKtLPcuTLjTVuWPqqPiG59ATxI72uAjPUaFxMdT9LV2X unit2'
    $script:Lista = { param($chaves, $minima = '0.0.0') (@{ formato = 1; chaves = $chaves; versaoMinima = $minima } | ConvertTo-Json -Compress) }
  }

  # Dado o endereço embutido; Quando o leio; Então só vale https (ou http em loopback, do build de teste), numa linha só.
  It 'AnvUrlConfianca aceita https e http em 127.0.0.1' {
    AnvUrlConfianca -Embutido "https://anvilore.iagofrota.com.br/confianca.json`n" | Should -Be 'https://anvilore.iagofrota.com.br/confianca.json'
    AnvUrlConfianca -Embutido 'http://127.0.0.1:8123/confianca.json' | Should -Be 'http://127.0.0.1:8123/confianca.json'
  }
  It 'AnvUrlConfianca recusa vazio, http fora de loopback, espaço, usuário, consulta e duas linhas' {
    foreach ($u in @('', "`n", 'http://anvilore.iagofrota.com.br/confianca.json', 'http://localhost:1/x', 'http://127.0.0.2/x', 'https://exemplo.com/a b', 'https://u:s@exemplo.com/x', 'https://exemplo.com/x?a=1', "https://exemplo.com/x`nhttps://outro.com/y", 'ftp://exemplo.com/x', 'exemplo.com/x')) {
      AnvUrlConfianca -Embutido $u | Should -BeNullOrEmpty
    }
  }

  It 'AnvValidarConfianca aceita o documento certo' {
    $c = AnvValidarConfianca -Texto (& $script:Lista @($script:FpA, $script:FpB) '0.3.0')
    $c | Should -Not -BeNullOrEmpty
    @($c.Chaves) | Should -Be @($script:FpA, $script:FpB)
    $c.VersaoMinima | Should -Be '0.3.0'
  }
  It 'AnvValidarConfianca recusa campo extra, tipo errado, formato 2, chaves vazia ou repetida, fingerprint torta e versão com pré-release' {
    $ruins = @(
      '{', '[]', 'null', '"texto"',
      '{"formato":1,"chaves":["' + $script:FpA + '"],"versaoMinima":"0.3.0","extra":1}',
      '{"formato":1,"chaves":["' + $script:FpA + '"]}',
      '{"formato":"1","chaves":["' + $script:FpA + '"],"versaoMinima":"0.3.0"}',
      '{"formato":2,"chaves":["' + $script:FpA + '"],"versaoMinima":"0.3.0"}',
      '{"formato":1,"chaves":[],"versaoMinima":"0.3.0"}',
      '{"formato":1,"chaves":"' + $script:FpA + '","versaoMinima":"0.3.0"}',
      '{"formato":1,"chaves":[1],"versaoMinima":"0.3.0"}',
      '{"formato":1,"chaves":["' + $script:FpA + '","' + $script:FpA + '"],"versaoMinima":"0.3.0"}',
      '{"formato":1,"chaves":["SHA256:curta"],"versaoMinima":"0.3.0"}',
      '{"formato":1,"chaves":["' + $script:FpA.ToLowerInvariant() + '"],"versaoMinima":"0.3.0"}',
      '{"formato":1,"chaves":["' + $script:FpA + '"],"versaoMinima":"0.3.0-rc.1"}',
      '{"formato":1,"chaves":["' + $script:FpA + '"],"versaoMinima":"v0.3.0"}',
      '{"formato":1,"chaves":["' + $script:FpA + '"],"versaoMinima":3}'
    )
    foreach ($t in $ruins) { (AnvValidarConfianca -Texto $t) | Should -BeNullOrEmpty }
  }

  # Dado a linha de uma chave; Quando calculo a fingerprint; Então é a que o `ssh-keygen -lf` mostra.
  It 'AnvImpressaoDaLinha bate com a do ssh-keygen (com opções antes da chave e comentário depois)' {
    AnvImpressaoDaLinha -Linha $script:LinhaA | Should -Be $script:FpA
    AnvImpressaoDaLinha -Linha $script:LinhaB | Should -Be $script:FpB
  }
  It 'AnvImpressaoDaLinha: comentário, linha em branco e chave torta não têm fingerprint' {
    foreach ($l in @('', '# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILzBKzpYMJNV3yvlaRIPDKwIjuHnYW4sJuBuwlXqU8+v', 'so texto', 'x ssh-ed25519', 'x ssh-ed25519 nao_e_base64!', 'x ssh-ed25519 AAAA')) {
      AnvImpressaoDaLinha -Linha $l | Should -BeNullOrEmpty
    }
  }
  It 'AnvFiltrarAssinantes guarda só as linhas cuja fingerprint está na lista (a interseção)' {
    $texto = "# âncoras`n$($script:LinhaA)`n$($script:LinhaB)`n"
    AnvFiltrarAssinantes -Texto $texto -Chaves @($script:FpA) | Should -Be "$($script:LinhaA)`n"
    AnvFiltrarAssinantes -Texto $texto -Chaves @($script:FpB, ('SHA256:' + ('Z' * 43))) | Should -Be "$($script:LinhaB)`n"
    AnvFiltrarAssinantes -Texto $texto -Chaves @($script:FpA, $script:FpB) | Should -Be "$($script:LinhaA)`n$($script:LinhaB)`n"
    AnvFiltrarAssinantes -Texto $script:LinhaA -Chaves @($script:FpB) | Should -BeNullOrEmpty
  }
}

Describe 'AnvConsultarConfianca (busca da lista)' {
  BeforeAll {
    $script:Doc = '{"formato":1,"chaves":["SHA256:/JgFK5PwZmasglTqgzoAjmXPyJUZMG00A2M8/094SLc"],"versaoMinima":"0.3.0"}'
    $script:Url = 'https://anvilore.iagofrota.com.br/confianca.json'
    $script:Resp = { param($status, $conteudo) [pscustomobject]@{ StatusCode = $status; Content = $conteudo; RawContentLength = $conteudo.Length } }
  }
  It 'devolve o documento quando o site responde 200 e pede sem cache' {
    $script:Visto = $null
    $r = AnvConsultarConfianca -Url $script:Url -Buscar { param($u, $cabecalhos) $script:Visto = @{ Url = $u; Cabecalhos = $cabecalhos }; & $script:Resp 200 $script:Doc }
    $r.Ok | Should -BeTrue
    @($r.Chaves).Count | Should -Be 1
    $r.VersaoMinima | Should -Be '0.3.0'
    $script:Visto.Url | Should -Be $script:Url
    $script:Visto.Cabecalhos['Cache-Control'] | Should -Be 'no-cache'
    $script:Visto.Cabecalhos['Pragma'] | Should -Be 'no-cache'
  }
  It 'recusa HTTP diferente de 200, redirecionamento, erro de rede/TLS, documento inválido e resposta grande, com a mensagem simples' {
    $casos = @(
      { & $script:Resp 404 'nada' }, { & $script:Resp 302 '' }, { & $script:Resp 500 'erro' }, { throw 'falha de TLS' },
      { & $script:Resp 200 '{' }, { & $script:Resp 200 '{"formato":2,"chaves":[],"versaoMinima":"0.0.0"}' },
      { [pscustomobject]@{ StatusCode = 200; Content = $script:Doc; RawContentLength = 70000 } },
      { & $script:Resp 200 ($script:Doc + (' ' * 70000)) }
    )
    foreach ($b in $casos) {
      $r = AnvConsultarConfianca -Url $script:Url -Buscar $b
      $r.Ok | Should -BeFalse
      $r.Motivo | Should -Match 'não consegui conferir a lista atual de chaves'
      $r.Motivo | Should -Match 'nada mudou'
      $r.Motivo | Should -Match ([regex]::Escape($script:Url))
    }
  }
}

Describe 'AnvConferirEstadoDasChaves (consulta + interseção + versão mínima)' {
  BeforeAll {
    $script:FpA = 'SHA256:/JgFK5PwZmasglTqgzoAjmXPyJUZMG00A2M8/094SLc'
    $script:FpB = 'SHA256:dqanDdeEV020uGcmGitbT6dlSS+jHYoL2XMmXUpqCD8'
    $script:LinhaA = 'unit@anvilore.test namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILzBKzpYMJNV3yvlaRIPDKwIjuHnYW4sJuBuwlXqU8+v'
    $script:LinhaB = 'unit2@anvilore.test namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKtLPcuTLjTVuWPqqPiG59ATxI72uAjPUaFxMdT9LV2X'
    $script:Servir = { param($chaves, $minima = '0.0.0') $j = (@{ formato = 1; chaves = $chaves; versaoMinima = $minima } | ConvertTo-Json -Compress); { param($u, $c) [pscustomobject]@{ StatusCode = 200; Content = $j; RawContentLength = $j.Length } }.GetNewClosure() }
    $script:Ancoras = "$($script:LinhaA)`n$($script:LinhaB)`n"
    $script:UrlOk = 'https://anvilore.iagofrota.com.br/confianca.json'
  }
  It 'chave na lista: devolve só as linhas permitidas' {
    $r = AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url $script:UrlOk -Assinantes $script:Ancoras -Buscar (& $script:Servir @($script:FpA))
    $r.Ok | Should -BeTrue
    $r.Assinantes | Should -Be "$($script:LinhaA)`n"
  }
  It 'lista sem nenhuma chave embutida (chave retirada): recusa dizendo que o instalador está desatualizado' {
    $r = AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpB))
    $r.Ok | Should -BeFalse
    $r.Motivo | Should -Match 'não inclui a chave de assinatura deste instalador'
  }
  It 'o site nunca acrescenta chave: chave da lista que não está nas âncoras não entra' {
    $r = AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpA, $script:FpB))
    $r.Assinantes | Should -Be "$($script:LinhaA)`n"
  }
  It 'versão mínima: candidata abaixo recusa; igual ou acima passa; pré-release da mínima recusa; sem tag (reinstalação) não compara' {
    (AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpA) '0.3.1')).Ok | Should -BeFalse
    (AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpA) '0.3.1')).Motivo | Should -Match 'exige a versão 0.3.1'
    (AnvConferirEstadoDasChaves -Tag 'v0.3.1' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpA) '0.3.1')).Ok | Should -BeTrue
    (AnvConferirEstadoDasChaves -Tag 'v0.10.0' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpA) '0.9.0')).Ok | Should -BeTrue
    (AnvConferirEstadoDasChaves -Tag 'v0.3.1-rc.1' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpA) '0.3.1')).Ok | Should -BeFalse
    (AnvConferirEstadoDasChaves -Tag '' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar (& $script:Servir @($script:FpA) '9.9.9')).Ok | Should -BeTrue
  }
  It 'sem URL embutida válida ou sem chave embutida: recusa sem consultar' {
    $script:Chamou = $false
    $busca = { param($u, $c) $script:Chamou = $true; [pscustomobject]@{ StatusCode = 200; Content = '{}'; RawContentLength = 2 } }
    (AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url '' -Assinantes $script:LinhaA -Buscar $busca).Ok | Should -BeFalse
    (AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url 'http://exemplo.com/x' -Assinantes $script:LinhaA -Buscar $busca).Ok | Should -BeFalse
    $script:Chamou | Should -BeFalse
  }
  It 'falha da consulta: recusa com a mensagem simples' {
    $r = AnvConferirEstadoDasChaves -Tag 'v0.3.0' -Url $script:UrlOk -Assinantes $script:LinhaA -Buscar { throw 'sem rede' }
    $r.Ok | Should -BeFalse
    $r.Motivo | Should -Match 'não consegui conferir a lista atual de chaves'
  }
}

Describe 'AnvVersaoDaPastaAtendeMinima (a pasta instalada contra a versão mínima da lista)' {
  It 'abaixo da mínima recusa; igual ou acima passa; comparação por número' {
    AnvVersaoDaPastaAtendeMinima -Versao '0.3.0' -Minima '0.3.1' | Should -BeFalse
    AnvVersaoDaPastaAtendeMinima -Versao '0.3.1' -Minima '0.3.1' | Should -BeTrue
    AnvVersaoDaPastaAtendeMinima -Versao '0.10.0' -Minima '0.9.0' | Should -BeTrue
    AnvVersaoDaPastaAtendeMinima -Versao '0.9.0' -Minima '0.10.0' | Should -BeFalse
  }
  It 'versão ou mínima que não é X.Y.Z recusa (nunca assume que passa)' {
    AnvVersaoDaPastaAtendeMinima -Versao '' -Minima '0.3.1' | Should -BeFalse
    AnvVersaoDaPastaAtendeMinima -Versao '0.3.0' -Minima '' | Should -BeFalse
    AnvVersaoDaPastaAtendeMinima -Versao 'abc' -Minima '0.3.1' | Should -BeFalse
  }
}
