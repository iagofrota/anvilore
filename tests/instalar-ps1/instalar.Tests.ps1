# Testes unitários do instalador do Windows (Pester 5). Rodam em PowerShell 5.1 e 7: o CI usa o 5.1 no
# windows-latest; no Linux, `pwsh` (docker) cobre as funções que não dependem do Windows.
#
# Cada cenário segue Dado / Quando / Então, em comentário (sem Cucumber).

BeforeAll {
  $env:ANVILORE_PS1_SO_FUNCOES = '1'
  $script:Instalador = Join-Path $PSScriptRoot '..\..\instalador\instalar.ps1'
  . $script:Instalador
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
  BeforeAll { $script:M = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'fixtures\dependencias-prova.json') | ConvertFrom-Json }
  It 'acha a entrada pela plataforma' {
    $d = AnvDependencia -Manifesto $script:M -Nome 'bun' -Plataforma 'windows-x64'
    $d.versao | Should -Be '1.4.1'
    $d.sha256 | Should -Match '^[0-9a-f]{64}$'
  }
  It 'plataforma sem entrada dá nulo'  { AnvDependencia -Manifesto $script:M -Nome 'rg' -Plataforma 'linux-arm64' | Should -BeNullOrEmpty }
  It 'dependência sem entrada dá nulo' { AnvDependencia -Manifesto $script:M -Nome 'nada' -Plataforma 'windows-x64' | Should -BeNullOrEmpty }
  It 'manifesto nulo dá nulo'          { AnvDependencia -Manifesto $null -Nome 'bun' -Plataforma 'windows-x64' | Should -BeNullOrEmpty }
  It 'entrada sem hash válido é recusada' {
    $ruim = '{"dependencias":{"bun":{"windows-x64":{"versao":"1.0.0","url":"https://x/y.zip","sha256":"abc"}}}}' | ConvertFrom-Json
    AnvDependencia -Manifesto $ruim -Nome 'bun' -Plataforma 'windows-x64' | Should -BeNullOrEmpty
  }
  It 'entrada com URL que não é https é recusada' {
    $ruim = '{"dependencias":{"bun":{"windows-x64":{"versao":"1.0.0","url":"http://x/y.zip","sha256":"52b1f3028b01f43d37fefdf669d034a1ee2e0d96c56bb13c393bdaf169b1af84"}}}}' | ConvertFrom-Json
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
