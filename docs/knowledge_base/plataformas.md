---
generated: 2026-10-27
---

# Plataformas

**Alvo:** Linux, Windows nativo e macOS, os três obrigatórios. É decisão do dono do projeto em
2026-10-23. O estado de hoje é mais estreito, e esta página separa o que já está tratado no código
do que ainda é só hipótese.

## Estado de hoje

- O `README.md` ainda diz que o suporte é só Linux. O hook antigo em bash, que declarava "Alvo
  declarado: Linux", foi substituído por `anvilore hook proteger-raw` (`src/comandos/hook-proteger-raw.ts`). O instalador já está em TypeScript no Bun:
  `src/comandos/instalar.ts`, com caminhos de `node:path` e links de `node:fs/promises`.
- O hook em TypeScript não depende de `jq` nem de `python3`, só do Bun. O
  instalador não depende mais de utilitários de shell nem de Python; só usa Git se precisar
  recuperar um esqueleto ausente na árvore-fonte. Sem Git nessa situação, reprova explicitamente.
- Os testes antigos em bash (`tests/test-*.sh`) cobrem as peças ainda não portadas e não rodam no
  CI. O instalador é exercitado por `tests/instalar.test.ts` e a ligação de diretórios por
  `tests/juncoes.test.ts`.
- **Fundação confirmada:** CI do PR #8, run 40100219630, em 2026-10-24: 258 testes passaram,
  nenhum falhou ou foi pulado, em ubuntu-latest, macos-latest e windows-latest. O link simbólico
  funcionou no Windows desse CI (resultado registrado pelo líder). Isso não confirmava as novas
  junções do instalador; elas foram confirmadas depois (próximo item).
- **Ondas 1 e 2 confirmadas no CI:** PR #13 (Onda 1), run 40150863576: windows-latest com 1435 testes, 1428 passaram,
  7 pulados, 0 falharam; macos-latest e ubuntu-latest também passaram. PR #11 (Onda 2), run 40191764239: windows-latest
  com 1901 testes, 1848 passaram, 53 pulados, 0 falharam; macos-latest e ubuntu-latest também passaram. Nos dois runs, o
  passo `bun scripts/medir-ligacoes.ts` do job windows imprimiu `junção: criado (win32)` e `link de arquivo: criado (win32)`.
- O `.gitattributes` fixa `eol=lf` para texto, Markdown e TypeScript, para o checkout no Windows
  não trazer CRLF.

- **Estado das chaves (`src/lib/confianca.ts`):** a consulta ao confianca.json usa o `fetch` do Bun e calcula a
  fingerprint SHA-256 da chave em TypeScript (igual ao `ssh-keygen -lf`, conferido no teste), então não depende de
  binário nem de shell e é a mesma nos três sistemas. O allowed_signers temporário vai para a pasta temporária do
  sistema (`os.tmpdir()`) e é apagado depois do `verify-tag`. Os testes só falam com loopback; o TLS real contra o
  domínio do dono **não** foi provado em nenhum sistema.

## MCP de consulta: configuração por agente

O servidor usa stdio e o campo de protocolo `instructions` no `initialize`. O teste do SDK verifica
que esse campo chega ao cliente MCP de teste. A documentação oficial consultada não garante como
cada agente incorpora essas instruções ao contexto do modelo; portanto, Claude Code, Codex, Gemini
CLI e Copilot CLI recebem o campo no protocolo, mas o efeito no comportamento de cada agente não foi
validado nesta entrega.

O registro pelo CLI usa escopo de usuário: Claude `claude mcp add -s user anvilore -- ...`, Gemini
`gemini mcp add -s user anvilore -- ...`, Copilot `copilot mcp add anvilore -- ...` (configuração de
usuário por padrão) e Codex `codex mcp add anvilore -- ...` (em ~/.codex/config.toml). Fontes
oficiais: [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Codex MCP](https://developers.openai.com/codex/mcp),
[Gemini CLI MCP](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html) e
[GitHub Copilot CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

`doctor` e `mcp estado` limitam a cinco segundos a consulta `mcp list` de cada agente. O processo
é encerrado se exceder o prazo, um aviso identifica o agente e as consultas seguintes continuam.
Na abertura concorrente do índice FTS5, operações SQLite bloqueadas são repetidas com espera
progressiva antes de retornar falha.
O Gemini CLI documenta linhas de `mcp list` prefixadas por `✓`/`✗`; o leitor remove ANSI e aceita o
prefixo do status antes do nome do servidor.

O teste de FTS5/SDK e o [CI do PR #17, run 40576697228](https://github.com/iagofrota/anvilore/actions/runs/40576697228)
passaram em Linux, macOS e Windows para o commit 7bae5b2. Esse run confirmou também a reconstrução
do índice SQLite corrompido no Windows sem deixar arquivo bloqueado. As páginas desta base de
conhecimento descrevem a implementação e aguardam revisão do Iago.

## Busca da wiki: dependência e prova por shell

A skill `query` (`skills/query/SKILL.md`) depende do **ripgrep**, executável `rg`, no PATH.
`instalar` e `doctor` consultam o PATH e avisam quando falta; o aviso não muda o código de saída
nem instala a ferramenta (`src/lib/rg.ts`, `src/comandos/instalar.ts`, `src/comandos/doctor.ts`;
testes em `tests/instalar.test.ts` e `tests/doctor.test.ts`). As travas continuam sendo avaliadas.

Comandos conferidos nas fontes oficiais em 2026-10-26:

| Sistema | Como obter |
|---|---|
| Windows | `winget install BurntSushi.ripgrep.MSVC` ([manifesto do Winget](https://github.com/microsoft/winget-pkgs/tree/master/manifests/b/BurntSushi/ripgrep/MSVC)); alternativas `scoop install ripgrep` e `choco install ripgrep` no [README oficial](https://github.com/BurntSushi/ripgrep#installation) |
| macOS | `brew install ripgrep` ([catálogo Homebrew](https://formulae.brew.sh/formula/ripgrep)) |
| Linux | pacote ripgrep pelo gerenciador da distribuição ([instruções por distribuição](https://github.com/BurntSushi/ripgrep#installation)) |

O [run inicial 40408757058](https://github.com/iagofrota/anvilore/actions/runs/40408757058)
provou `rg` ausente no PATH original dos três runners. O ensaio registra esse baseline antes
de preparar uma versão oficial 15.1.0 em diretório temporário, com SHA-256 fixo e remoção ao final
(`scripts/rg-temporario-prova.ts`, `scripts/pacote-rg-prova.ts`). Isso prepara só o teste do CI.

As duas candidatas de callouts foram medidas no
[run 40411367465](https://github.com/iagofrota/anvilore/actions/runs/40411367465), em 2026-10-26,
com ripgrep 15.1.0. Cada célula abaixo é código de saída / ocorrências (esperado **0/4**).
A forma **b** foi adotada pela skill:

```text
a: rg --no-ignore -n "\[!gap\]|\[!contradiction\]" wiki/
b: rg --no-ignore -n "\[\x21(gap|contradiction)\]" wiki/
```

| Sistema | Shell | a | b | a / b em bash interativo com set -H |
|---|---|---|---|---|
| Windows | Git Bash | 0/4 | 0/4 | 0/4 / 0/4 |
| Windows | pwsh 7.6.7 | 0/4 | 0/4 | não se aplica |
| Windows | PowerShell 5.1 | 0/4 | 0/4 | não se aplica |
| Windows | cmd | 0/4 | 0/4 | não se aplica |
| Ubuntu | bash | 0/4 | 0/4 | 0/4 / 0/4 |
| Ubuntu | pwsh 7.6.6 | 0/4 | 0/4 | não se aplica |
| macOS | bash | 0/4 | 0/4 | 0/4 / 0/4 |
| macOS | pwsh 7.6.6 | 0/4 | 0/4 | não se aplica |

O bash roda com `-i`, recebe `set -H` antes da linha testada e tem histórico temporário.
O log registra `HISTEXPAND=on` e um controle negativo do expansor nativo (`history -p`), que
rejeita um evento inexistente (`HISTORY_CONTROL=1`). Nos shells medidos, a candidata a também
passou com histórico ligado; não se observou a falha nesse padrão específico com `[!`.
A forma b usa `\x21` para `!` e evita o caractere literal. A antiga forma com aspas simples
falhava só no cmd, saída 255, conforme o
[run da Fase 1](https://github.com/iagofrota/anvilore/actions/runs/40409439067).

### Acentos, codepage e caminhos

No mesmo run de medição, os três casos adicionais do Windows encontraram a página NFC com
a consulta governança NFC (esperado **0/1**), preservaram stdout UTF-8 e reabriram a citação:

| Ambiente | Obtido | Saída |
|---|---|---|
| cmd após chcp 850 | 0/1 | UTF-8 válido, caminho e conteúdo conferidos |
| PowerShell 5.1, OutputEncoding padrão us-ascii, console 65001 | 0/1 | idem |
| PowerShell 5.1 após chcp 850, OutputEncoding padrão us-ascii | 0/1 | idem |

A codepage anterior é restaurada após o ensaio. A prova captura a saída nativa por pipe;
não garante a renderização de todo terminal pt-BR, nem outros pipelines, redirecionamentos
ou editores. Esses casos de codepage são informativos, não bloqueiam o CI.

Em todos os oito pares shell/sistema, a consulta NFC encontrou só o conteúdo NFC e a NFD só
o conteúdo NFD: **não há equivalência canônica** nesta busca. Nenhum conteúdo é normalizado.
Os radicais sem acento `tribut` e `govern` encontraram as duas páginas e são a dica da skill.

No Windows, o resultado pode misturar separadores, por exemplo wiki/exemplo\concepts\pagina.md.
O arquivo abre com o caminho como veio: o ensaio reabre cada citação no sistema de origem
e confere o número da linha (`scripts/provar-busca.ts`). Separe `:linha:texto` do caminho.
Linux e macOS retornaram barras normais. Não se invocou um agente real para essa leitura.

A etapa de prova no CI (`.github/workflows/ci.yml`) lê os comandos da skill e reprova se faltar
`rg` na etapa preparada, se o termo de controle não der 0/2, se os callouts adotados não derem
0/4 (inclusive no bash com histórico) ou se a consulta sem `--no-ignore` não der 1/0 com stdout
vazio. Radicais e abertura das citações também são conferidos. Unicode cruzado e codepage 850
ficam como INFO. As páginas temporárias usam o `.gitignore` real, dentro de um repositório Git;
`--no-ignore` é necessário para encontrar o conteúdo pessoal ignorado.

A **decisão do dono sobre o shell real de Codex e Gemini no Windows** permanece aberta na
tabela de hooks abaixo: medir os shells não prova qual deles cada agente utiliza.

## Riscos: hipóteses até o CI provar

Nada abaixo foi observado em Windows ou macOS. O dono do projeto não tinha máquina desses sistemas
nem CI neles quando o risco foi levantado. Cada item diz o que a biblioteca em `src/lib/` já trata.
"Trata" quer dizer que há código e teste; só a execução nos três sistemas confirma.

### Windows

| Risco | O que a biblioteca já trata | Falta |
|---|---|---|
| Fim de linha CRLF (checkout no Windows) | `normalizarFimDeLinha` (`src/lib/caminhos.ts`) e `linhasDe` (`src/lib/frontmatter.ts`) leem CRLF como LF. Teste: `tests/lib-frontmatter.test.ts`. | Os scripts em bash e Python ainda não usam a biblioteca. |
| BOM no início do arquivo | `linhasDe` tira o BOM antes de procurar o frontmatter. | Idem. |
| Caminho com barra invertida, `raw.`, `raw ` ou unidade `C:` | `estaEmRaw` (`src/lib/caminhos.ts`) separa por barra, barra invertida e `:`, tira ponto e espaço do fim e ignora a caixa. Teste: `tests/lib-caminhos.test.ts`. | `decidir` (`src/comandos/hook-proteger-raw.ts`) usa `estaEmRaw`; testes em `tests/hook-proteger-raw.test.ts` cobrem caminho com unidade e barras invertidas e comando de PowerShell. Falta resolver o caminho e o link simbólico antes de comparar. |
| Links e junções | `ligarDiretorio` em `src/comandos/instalar.ts` usa junção no Windows e link simbólico relativo em Linux/macOS. O Copilot usa `ligarArquivo`. Falha avisa e não copia; o instalador sai com 4. `tests/juncoes.test.ts` confere edições após a ligação. `scripts/medir-ligacoes.ts` imprime o resultado para diretório e arquivo. | Junção confirmada no Windows: `junção: criado (win32)` e `link de arquivo: criado (win32)` no passo de medição do job windows do PR #13 (run 40150863576) e do PR #11 (run 40191764239). A medição em `.github/workflows/ci.yml` usa always(), mesmo após erro anterior, e reprova se uma ligação falhar. Link de arquivo no Windows pode exigir modo desenvolvedor ou administrador; o diagnóstico sugere essas opções. |
| Cópia e restauração do atualizador (`src/lib/atualizacao.ts`) | Caminhos guardados com `/` e montados com `node:path`. Link não é recriado dentro da cópia: o alvo dele, com SHA-256, fica no manifesto. Ao restaurar no Windows, `tipoDeLink` escolhe junção só para alvo absoluto (o que o `instalar` cria) e link simbólico de pasta para alvo relativo, porque, no Bun do CI windows-latest do PR #28, o alvo relativo de uma junção foi resolvido contra a pasta do processo. Caminho que passa por link dentro do kit é recusado. Fim de linha: o kit tem `.gitattributes` com `eol=lf`, que vale sobre o `core.autocrlf` no checkout; a preservação compara os bytes que o próprio atualizador copiou e as comparações pelo git (`hash-object` contra o blob) passam pelos mesmos filtros dos dois lados, então o atualizador não força `core.autocrlf`. | O CI Windows do PR #28 (primeira rodada) falhou ao conferir a cópia de um link relativo recriado como junção; corrigido, e as duas execuções seguintes do CI no PR #28 (runs 40881230637 e 40881238442) passaram no Windows. `readlink` de junção recriada (prefixo, barra final) e link relativo de pasta sem modo desenvolvedor não foram provados no Windows. |
| Dependências do sistema (`jq`, `python3`, `awk`, `mktemp`, `readlink`) | Somem com o porte. | O `git` continua necessário; o diagnóstico de ambiente ainda não existe. |
| Latência do hook | `scripts/medir-latencia-hook.ts` mede 20 execuções de `bun src/cli.ts hook proteger-raw` (escrita comum e terminal) e imprime mediana e p95. O CI roda essa etapa em cada sistema (`.github/workflows/ci.yml`, sempre, mesmo após falha anterior). Medida local em Linux, 2026-10-24: mediana 10,5 ms e p95 15 ms (escrita comum); mediana 10,8 ms e p95 11,8 ms (terminal). | Medida no CI dos PRs #13 (run 40150863576) e #11 (run 40191764239); a tabela por sistema e cenário está em "Resultado do CI", abaixo. No windows-latest: mediana de 33,3 a 38,2 ms e p95 de 36,9 a 43,9 ms nos dois runs. Decisão do dono: dizer se essa latência no Windows é aceitável (o plano manda não declarar aceitável sem ele). |
| Forma instalada do hook (shell do hook em cada agente) | `src/comandos/instalar.ts` grava, por agente: Claude `bun "$CLAUDE_PROJECT_DIR"/src/cli.ts hook proteger-raw \|\| exit 2` com `shell: "bash"` e `onFailure: "block"`; Copilot `bash` com `\|\| exit 2` e `powershell` com `...; if ($LASTEXITCODE -ne 0) { exit 2 }`; **Codex e Gemini (R65)** `bun "<raiz do clone>/src/cli.ts" hook proteger-raw; exit $LASTEXITCODE`, sem `\|\|` (o subcomando ignora os argumentos `exit $LASTEXITCODE` que o `cmd` repassa); o **Codex** ganha também `command_windows` com `...; if ($LASTEXITCODE -ne 0) { exit 2 }`, que fecha até sem o `bun` (fonte: <https://learn.chatgpt.com/docs/hooks>, `commandWindows`). `scripts/provar-forma-instalada.ts` gera a configuração num `--destino` temporário, pega a string exata de cada agente e a executa no shell real do sistema com um payload que escreve em `raw/` (espera saída 2), um que escreve em `wiki/` (espera 0) e com o `bun` fora do PATH (espera exatamente a saída 2, o único código que Claude, Gemini e Copilot tratam como bloqueio; para `command` de Codex e Gemini esse cenário é só medição). O CI roda essa etapa em cada sistema, sempre (`ANVILORE_EXIGIR_SHELLS=1`: shell ausente reprova): `bash` em Linux, macOS e Windows (Git Bash), `pwsh` em todos, `cmd` e `powershell` 5.1 no Windows; todas as formas são exigidas em todos os shells com bun presente. Testes: `tests/provar-forma.test.ts` (Linux, bash). | Executada no CI dos PRs #13 (run 40150863576) e #11 (run 40191764239): a saída obtida × esperada por agente e shell está em "Resultado do CI", abaixo. Pela documentação oficial (conferida em 2026-10-24): **Claude Code** roda o comando com `sh -c`, Git Bash no Windows ou PowerShell sem Git Bash; `onFailure: "block"` (2.1.295 ou mais novo) bloqueia quando o comando falha, e a página não diz o que versões anteriores fazem com a chave. **Copilot** fecha o `preToolUse` em saída diferente de 0, usa `powershell` no Windows, e timeout abre. **Codex** tem `commandWindows`, mas a página não diz o shell nem o que uma saída diferente de 2 faz; **Gemini** não documenta shell nem campo de Windows, e saída diferente de 0 e 2 é aviso (a CLI segue). **Medido com o `pwsh` 7.5.0 (2026-10-24):** com `\|\| exit 2` o PowerShell 7 não bloqueia (`exit` não é comando dentro de `\|\|` e o `-Command` devolve 1); a chamada pura ao bun também devolve 1 em `-Command`; `bun ...; exit $LASTEXITCODE` devolve o 2 do bun em `pwsh` (medido) e em `sh` (medido); no `cmd` e no PowerShell 5.1 a prova do CI é a medição. **`command_windows` do Codex só é provado em `pwsh` e PowerShell 5.1.** Se o Codex rodar o hook no `cmd`, o trecho `; if (...)` chega ao bun como argumentos que o subcomando não aceita e a saída é sempre 2: fecha tudo, sem furo, mas trava as ferramentas até alguém corrigir. **Limite declarado:** com o `bun` ausente, Codex (`command`, fora do Windows) e Gemini ficam sem o hook (`sh` devolve 127, `pwsh` devolve 0 porque `$LASTEXITCODE` fica vazio); o `anvilore doctor` trata o `bun` como pré-requisito e sai 1 se faltar, e avisa quando o `claude --version` é anterior à 2.1.295 (`onFailure`). Decisão do dono: confirmar o shell de Codex e Gemini no Windows. |
| Ponte da interface com o Claude Code (`src/lib/ponte-claude-code.ts`) | A regra de edição troca barra invertida por barra (duas barras e a unidade, C:/…); o `claude` é achado pelo PATH com `Bun.which` (acha `claude.exe` e `claude.cmd`); cancelar sem `result` depois do pedido conta como cancelado, porque no Windows o SIGINT encerra o processo sem o turno final. O `claude` falso dos testes (`tests/apoio/claude-falso.ts`) roda nos três sistemas. | Nada disso foi provado com o Claude Code real no Windows nem no macOS: a forma da regra com unidade, o SIGINT (que no Windows deve perder o turno parcial) e um `claude.cmd` instalado pelo npm recebendo o esquema JSON como argumento. |

O subcomando `indexar-log` separa linhas CRLF dos arquivos de dia antes de contar os tipos
(`src/comandos/indexar-log.ts`; `tests/indexar-log.test.ts`). O teste de CRLF passou em Linux e,
no CI do PR #11 (run 40191764239), também no windows-latest.

#### Resultado do CI: latência e forma instalada do hook

Fonte: log dos jobs `testes (windows-latest)`, `testes (macos-latest)` e `testes (ubuntu-latest)` do PR #13 (Onda 1), run
40150863576, e do PR #11 (Onda 2), run 40191764239. Nos seis jobs, os passos "Medir latência do hook" e "Provar a forma
instalada" terminaram com sucesso. A medição varia de um run para o outro no mesmo sistema (o Linux foi de 13,9 para 23 ms
na escrita comum); este texto só registra o que o log imprimiu.

Latência de `bun src/cli.ts hook proteger-raw`, 20 execuções por cenário, mediana / p95 em ms:

| Sistema | Cenário | Onda 1 (run 40150863576) | Onda 2 (run 40191764239) |
|---|---|---|---|
| Windows | escrita comum | 33,3 / 36,9 | 36,5 / 38 |
| Windows | terminal | 35,2 / 42,5 | 38,2 / 43,9 |
| macOS | escrita comum | 14,7 / 18,6 | 18,5 / 29,6 |
| macOS | terminal | 16,6 / 26,6 | 25 / 54 |
| Linux (CI) | escrita comum | 13,9 / 16,1 | 23 / 24,9 |
| Linux (CI) | terminal | 15,2 / 16 | 25,1 / 27 |

Decisão do dono: dizer se essa latência no Windows é aceitável (o plano manda não declarar aceitável sem ele).

Forma instalada: saída obtida (esperada) de cada string gravada pelo instalador, executada no shell indicado. As colunas
são os três cenários: escrita em `raw/` (esperado 2), escrita em `wiki/` (esperado 0) e `bun` fora do PATH (esperado 2).
Os dois runs imprimiram exatamente as mesmas saídas em todos os sistemas.

| Agente e forma | Shell | Em quais sistemas | `raw/` | `wiki/` | sem `bun` |
|---|---|---|---|---|---|
| Claude `command` | bash | Windows (Git Bash), macOS, Linux | 2 (2) | 0 (0) | 2 (2) |
| Codex `command` | bash | Windows, macOS, Linux | 2 (2) | 0 (0) | 127 (2), INFO |
| Codex `command` | pwsh | Windows, macOS, Linux | 2 (2) | 0 (0) | 0 (2), INFO |
| Codex `command` | cmd | Windows | 2 (2) | 0 (0) | 1 (2), INFO |
| Codex `command` | powershell | Windows | 2 (2) | 0 (0) | 0 (2), INFO |
| Codex `command_windows` | pwsh | Windows, macOS, Linux | 2 (2) | 0 (0) | 2 (2) |
| Codex `command_windows` | powershell | Windows | 2 (2) | 0 (0) | 2 (2) |
| Gemini `command` | bash | Windows, macOS, Linux | 2 (2) | 0 (0) | 127 (2), INFO |
| Gemini `command` | pwsh | Windows, macOS, Linux | 2 (2) | 0 (0) | 0 (2), INFO |
| Gemini `command` | cmd | Windows | 2 (2) | 0 (0) | 1 (2), INFO |
| Gemini `command` | powershell | Windows | 2 (2) | 0 (0) | 0 (2), INFO |
| Copilot `bash` | bash | Windows, macOS, Linux | 2 (2) | 0 (0) | 2 (2) |
| Copilot `powershell` | pwsh | Windows, macOS, Linux | 2 (2) | 0 (0) | 2 (2) |
| Copilot `powershell` | powershell | Windows | 2 (2) | 0 (0) | 2 (2) |

- Cada job imprimiu linhas só com `ok` ou `INFO`: Windows 42 (34 `ok`, 8 `INFO`), macOS 24 (20 `ok`, 4 `INFO`) e Linux 24
  (20 `ok`, 4 `INFO`) por run; nenhuma linha `FALHA`. **Nenhuma divergência reprovou o passo.**
- As divergências são todas do cenário "sem `bun` no PATH" e só das formas `command` de Codex e Gemini, que o script trata
  como medição (`INFO`): 127 em bash, 0 em pwsh e em powershell, 1 em cmd. Nos escritos em `raw/` e `wiki/` não houve divergência.
- Saída 0 sem o `bun` quer dizer que, nesse cenário, a string não devolve o 2 que bloqueia: é o limite declarado acima para
  Codex e Gemini. `command_windows` do Codex devolveu 2 sem o `bun` em pwsh e em powershell; em cmd ele não foi executado
  (só pwsh e powershell, e pwsh também em macOS e Linux).

### macOS

| Risco | O que a biblioteca já trata | Falta |
|---|---|---|
| Maiúsculas e minúsculas: o disco padrão não diferencia Pagina.md de pagina.md | `chaveDeNome` (`src/lib/caminhos.ts`) compara em minúsculas, e o validador (`src/comandos/validar.ts`, linhas 91 a 98) reprova dois arquivos da mesma pasta que só diferem na caixa. Teste: `tests/validar.test.ts`, que só roda esse cenário em disco que distingue a caixa (Linux). | Só o Linux executou; a confirmação no macOS e no Windows depende do CI. |
| Nome de arquivo com acento decomposto (`e` mais acento no lugar de `é`) | `chaveDeNome` normaliza para NFC antes de comparar. `slugDe` (`src/lib/frontmatter.ts`) tira a extensão do nome. O validador compara o slug com o nome do arquivo em NFC (`src/comandos/validar.ts`, linha 195) e resolve wikilink por `chaveDeNome` (linha 221). Teste: `tests/validar.test.ts`. | Só o Linux executou; o nome decomposto de verdade só aparece no macOS. |

A função `estaEmRaw` (`src/lib/caminhos.ts`), que o hook em TypeScript usa, ignora a
caixa, porque no macOS e no Windows Raw/a.md é a mesma pasta `raw/`. Com ela, no Linux uma pasta
chamada Raw seria bloqueada (falha fechada, de propósito). O hook
(`src/comandos/hook-proteger-raw.ts`) usa `estaEmRaw`: Raw/a.md é bloqueado em qualquer sistema,
e no Linux isso é falso positivo aceito. Veja [governanca.md](governanca.md).

## Instalador do Linux (instalar.sh)

Fatia U3 dos instaladores. O script (`instalador/instalar.sh`) instala o kit em Linux x64 e arm64 e é a base
do macOS (que ainda recusa com mensagem simples). Ele faz os passos 1 a 9, 11 e 12 do plano: confere o sistema,
instala o que falta (git, `ssh-keygen`, `unzip`, Bun e rg), baixa a última release, **confere a assinatura da tag**,
liga os agentes que a pessoa tem, grava o estado da atualização, roda o `doctor` e termina com três linhas: o
que foi instalado, onde está e o próximo passo. O atalho (passo 10) é da fatia U6: o script só tem a função
`criar_atalho`, vazia, com o contrato escrito no comentário.

Onde cada coisa fica (Linux):

```
~/Anvilore/                    kit e dados (clone da tag assinada); registro em .anvilore/instalacao.log
~/.bun/bin/bun                 só se o Bun do sistema faltava ou era mais velho (marca bunGerenciado no estado)
~/.local/bin/bun               link para o de cima, para sessões novas acharem o bun
~/.local/bin/rg                só se o rg faltava (zip/tar do manifesto, SHA-256 conferido)
~/.profile                     bloco marcado "Anvilore: PATH" (criado se faltar); idem em ~/.bashrc, ~/.zshrc, ~/.bash_profile e ~/.bash_login, só se já existem
```

- **PATH persistente.** Os hooks dos agentes chamam `bun` pelo PATH (e a busca chama `rg`), e exportar o PATH só no processo do
  instalador não sobrevive a ele. No fim da instalação (`persistir_path` em `instalador/instalar.sh`) o script acrescenta, no fim de
  cada arquivo acima, um bloco entre `# >>> Anvilore: PATH >>>` e `# <<< Anvilore: PATH <<<` que põe ~/.local/bin (e ~/.bun/bin,
  se o Bun é o gerenciado) no PATH só quando a pasta ainda não está nele, como fazem os instaladores do Bun e do rustup. Reinstalar
  não duplica (bloco já presente: o arquivo nem é aberto para escrita) e o resto do arquivo nunca é reescrito. Arquivo sem permissão
  de escrita vira aviso em linguagem simples, não erro. O resumo final diz que um terminal novo já acha o comando. Os hooks
  continuam chamando `bun` pelo PATH, sem caminho absoluto. O `doctor` e o `--conferir` não precisam saber disso: eles olham o PATH
  do terminal em que rodam, que num terminal novo já traz o bloco. ~/.bash_profile e ~/.bash_login entram porque o bash de login
  ignora o ~/.profile quando um deles existe. **Não provado:** `fish` e `zsh` de login sem ~/.zshrc (o zsh só lê o ~/.zshrc em
  shell interativo), e sessões gráficas que não passam por um shell de login (o PATH do ambiente gráfico não muda).
- **Pasta de passagem do download.** O clone vai para `.anvilore-baixando.<pid>.<aleatório>` ao lado do destino, criada com `mkdir`
  (que falha se o caminho existe) e sem `rm -rf` antes: nada que já estava lá é apagado. Só o que o próprio script criou é limpo.

- **Manifesto e chave dentro do script.** `instalador/dependencias.json` (versão, URL oficial e SHA-256 de Bun, rg
  e PortableGit por plataforma) e a chave pública (arquivo seguranca/assinantes, ainda sem chave real) vão
  embutidos no instalar.sh pela release, junto com a **base mínima** (`instalador/base-minima`, um `X.Y.Z`): `scripts/embutir-instalador.ts` gera o script e, com `--conferir`,
  prova que a cópia embutida é igual aos arquivos. O instalar.sh do repositório é só o modelo: sem manifesto e sem
  chave válida ele recusa instalar e explica. O manifesto traz uma entrada por linha para o `awk` do script ler
  (não há `jq` nem Python garantidos); `tests/instalador-manifesto.test.ts` trava esse formato.
- **Assinatura.** O clone é `--no-checkout` e os hooks ficam desligados (`core.hooksPath` vazio) até a assinatura passar: nenhum
  arquivo da candidata é gravado, e nenhum filtro do git ou hook da configuração global roda sobre ela. O script confere:
  que a tag é anotada, que tem bloco de assinatura SSH (OpenPGP e x509 são recusados e os programas de gpg ficam
  desligados), que `git verify-tag` aprova com a chave embutida (com `gpg.ssh.program=ssh-keygen` fixado no comando, para a configuração global não escolher o verificador), que o nome assinado é o da tag, que ela aponta
  direto para um commit e que o `HEAD` baixado é esse commit. Só então faz o `checkout` desse commit. Falhou: apaga o que baixou, não liga agente nenhum
  e diz por quê. O mesmo critério do atualizador (`src/lib/atualizacao.ts`).
- **Transporte.** `ls-remote` e `clone` rodam em `git_rede`: `GIT_ALLOW_PROTOCOL` só com o protocolo da origem (https; `file` ou `ssh` quando a origem é trocada nos testes), `credential.helper` zerado, `GIT_ASKPASS` vazio e `GIT_TERMINAL_PROMPT=0`. A configuração global não abre `ext::` nem `fd::` antes da assinatura, e o resto dela (proxy, por exemplo) continua valendo.
- **Estado das chaves.** Depois de descobrir a tag e antes do clone (instalação nova), ou depois da base mínima e antes de executar qualquer coisa da pasta (reinstalação), `conferir_estado_das_chaves` consulta a lista do site (`curl -q --proto =https --max-redirs 0 --max-time 15 --max-filesize 65536`, `Cache-Control` e `Pragma`, loopback http só no build de teste), valida o documento com rigor (regex sobre o texto, sem `jq`), grava num arquivo temporário só as linhas embutidas cuja fingerprint (`ssh-keygen -lf`) está na lista e para se a interseção é vazia, se a tag está abaixo da `versaoMinima` ou, na reinstalação, se a pasta instalada está abaixo dela. Sem cache e sem fallback.
- **Pasta instalada e base mínima.** Pasta instalada = a estrutura do kit (`.git`, `AGENTS.md`, `src/cli.ts`, `skills/`), o mesmo critério do instalar.ps1; não exige o estado da atualização (a `0.2.0` não o tem) nem o `package.json` (a versão é lida depois). Antes de **qualquer** passo sobre a pasta (inclusive gravar o registro nela), o script lê o `version` do `package.json` como texto e compara, número a número, com a base mínima embutida: menor, ausente, ilegível, inválida, pré-release ou com metadado de build recusa com mensagem simples e saída 1, sem executar nada da pasta (nem o `src/cli.ts`, nem `bunfig.toml`, nem hooks do git) e sem mudar HEAD nem arquivo (`tests/instalar-sh-base-minima.test.ts` prova com marcadores). A leitura é um trecho do próprio instalador no Bun, com a pasta de trabalho na pasta temporária. A mensagem manda instalar numa pasta nova e pedir ao agente que traga a wiki de forma conferida; não há migração automática (backlog).
- **Reinstalação.** Numa pasta já instalada (na base mínima ou acima dela) o script roda o atualizador dela, passando as chaves embutidas pela opção interna `--assinantes-do-instalador <arquivo>` (arquivo temporário, só nessa chamada; não por variável de ambiente): o atualizador confere a tag contra elas e não contra o arquivo seguranca/assinantes antigo da pasta, que não conhece uma chave nova. Nada é gravado na pasta por causa disso. A opção não prova que quem chamou é o instalador (um processo local hostil pode passá-la, assim como poderia trocar o PATH); o ganho é que a âncora não é mais herdada por acidente numa atualização manual ou agendada. Se o atualizador da pasta é antigo e devolve código 2 ("Uso:") para a opção (defesa em profundidade: a base mínima já deveria ter recusado), o instalador para com a mensagem da pasta nova e saída diferente de zero, sem mexer na pasta.
- **Perguntas.** Respostas vêm de /dev/tty, porque `curl | bash` ocupa a entrada. Sem terminal, ou com
  `ANVILORE_SEM_PERGUNTAS=1`, vale a resposta padrão (instalar pacotes que faltam: sim; instalar o Claude Code:
  não, salvo `ANVILORE_INSTALAR_CLAUDE=sim`). `ANVILORE_ESPERAR_ENTER=1` faz o script esperar Enter no fim, para a
  janela de um atalho com `Terminal=true` não fechar antes de a pessoa ler o resumo.
- **Variáveis para teste e QA:** `ANVILORE_ORIGEM` (clonar de um repositório local), `ANVILORE_VERSAO` (uma tag
  específica) e `ANVILORE_PASTA`. O `ANVILORE_DESTINO` do kit não é usado aqui, para não confundir a pasta do kit com a
  pasta de uma wiki.
- **Pasta que já é instalação** (tem `.git`, `AGENTS.md`, `src/cli.ts`, `skills/` e o estado em
  .anvilore/atualizacao.json) vira "atualizar": roda `anvilore atualizar` e `instalar` de novo, sem sobrescrever o
  que é da pessoa nem as escolhas gravadas (modo, canal, commit automático desligado) e não recria a área da wiki que
  ela apagou; só a primeira instalação cria as áreas padrão. Se a primeira rodada caiu no meio, a seguinte a termina
  como instalação nova (marcador instalacao-em-andamento). Pasta que existe e é outra coisa: pergunta outro nome, ou
  para (sem terminal), sem tocar em nada.
- **Sem agente:** o kit fica instalado, o `doctor` sai 1 e o resultado é "parcial", com exit 0. **Sem rg:** a
  instalação continua e o resumo avisa que a busca da skill `query` fica indisponível.
- **Pacotes do sistema:** `git`, `curl`, `ssh-keygen` (pacote `openssh-client`, `openssh-clients` ou `openssh`) e
  `unzip` (só se o Bun precisa ser baixado). Falta algum: pergunta e usa `sudo` com `apt`, `dnf`, `pacman` ou
  `zypper`. O pacote `.deb`/`.rpm` da fatia U9 deve declarar `openssh-client` como dependência, além do plano.

Provas: `tests/instalar-sh.test.ts`, `tests/instalar-sh-funcoes.test.ts` (inclui pseudoterminal) e
`tests/instalar-sh-kit-real.test.ts` (kit de verdade, com rede para o npm), todos em HOME vazio e com tag assinada
por chave descartável. **Não provado aqui:** `curl | bash` contra o GitHub real (a primeira release assinada ainda não
existe), `sudo` e gerenciadores de pacote reais (os testes usam substitutos), o login do Claude Code, e distribuições
que não sejam as do CI.

## Instalador do Windows (instalar.ps1)

Fatia U4 dos instaladores. O script (`instalador/instalar.ps1`) instala o kit no Windows 10/11 x64 **sem administrador**
e faz os passos 1 a 9, 11 e 12 do plano, na mesma ordem do `instalador/instalar.sh`: confere o sistema; usa o Git da pessoa (2.34 ou
mais novo e com o bash do Git for Windows) ou baixa o PortableGit para `%LOCALAPPDATA%\Anvilore\git`; garante o Bun
(`%USERPROFILE%\.bun\bin`) e o rg (`%LOCALAPPDATA%\Anvilore\bin`) com SHA-256 do manifesto; baixa a última release,
**confere a assinatura da tag**; liga os agentes, grava o estado da atualização (o arquivo atualizacao.json, na pasta .anvilore), roda o `doctor` e termina com o resumo.
O passo 10 (atalhos) é da fatia U6: o script só tem `AnvCriarAtalho`, que não cria nada e devolve `$false` (igual ao
`criar_atalho` do `instalador/instalar.sh`). Não existe `abrir.ps1` ainda.

- **Como chamar.** `irm <url> | iex` ou `powershell -NoProfile -Command "& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 'instalar.ps1')))"`.
  Não use `-ExecutionPolicy Bypass -File`: uma política de grupo vence o parâmetro (PROVA-U0 item 3). O script **nunca chama
  `exit`** (num `irm | iex` fecharia o terminal da pessoa); o resultado fica em `$LASTEXITCODE`: 0 completo, 10 parcial (sem
  agente), 1 falhou, 2 sistema não suportado, 3 assinatura que não confere, 4 download de dependência falhou ou não confere.
- **Acentos.** O arquivo é UTF-8 **sem BOM** e quem o lê usa `-Encoding UTF8`. O Windows PowerShell 5.1 lê arquivo sem BOM
  como ANSI, e os bytes `0x84` e `0x91`-`0x94` viram aspas tipográficas, que o PowerShell trata como aspas de verdade: o
  primeiro CI deste instalador quebrou assim, por causa de um travessão. Por isso o script não usa travessão nem `Ó`/`Ô`
  (`tests/instalar-ps1.test.ts` trava isso) e define `[Console]::OutputEncoding` como UTF-8 (com `chcp 65001` quando o
  modo de linguagem não deixa).
- **Constrained Language Mode.** O script lê `$ExecutionContext.SessionState.LanguageMode`; se não for `FullLanguage`,
  grava o `PATH` e as variáveis do usuário com `reg.exe` (os métodos .NET do registro e `SetEnvironmentVariable` ficam
  bloqueados). No modo normal ele grava no registro mantendo o tipo `REG_EXPAND_SZ` e **sem expandir** `%VARIÁVEL%` do
  `PATH` da pessoa, e avisa o Explorer da mudança. O `PATH` do processo também recebe as pastas, para os passos seguintes.
- **Commit automático.** A instalação nova liga (`--auto-commit`); a reinstalação respeita o `autoCommit` do .anvilore/atualizacao.json
  (`AnvAutoCommitDaPasta`), como o instalador/instalar.sh: desligado pela pessoa continua desligado, e estado ilegível ou sem a chave também deixa
  desligado. Sem atualizacao.json (a primeira rodada parou antes de gravá-lo), liga como numa instalação nova.
- **Origem e assinatura.** `ANVILORE_ORIGEM` troca a origem (CI e QA usam um repositório local); `ANVILORE_VERSAO`, `ANVILORE_PASTA`,
  `ANVILORE_INSTALAR_CLAUDE` e `ANVILORE_ESPERAR_ENTER` têm os mesmos nomes do Linux. O clone usa `-c core.autocrlf=false` e
  vai primeiro para uma pasta de passagem única (`Anvilore.novo-<12 caracteres aleatórios>`, criada por `AnvCriarStaging` ao lado do
  destino, no mesmo volume, e que falha se o nome já existe); só depois de conferido é movido para o lugar. Uma pasta `Anvilore.novo`
  da pessoa nunca é tocada, e a limpeza (`finally` em `AnvBaixarKit`) apaga só a pasta que esta execução criou, no sucesso e na falha. A conferência é a do `instalador/instalar.sh`: a tag
  é anotada, tem bloco `-----BEGIN SSH SIGNATURE-----` (OpenPGP e x509 são recusados), `git verify-tag` aprova com a chave
  embutida, o nome assinado é o da tag, ela aponta para um commit e o commit é o do `HEAD`. Falhou: apaga o que baixou e
  não liga agente nenhum. Correções da revisão de segurança (A1 e A2), no mesmo desenho do `instalador/instalar.sh`: o clone é
  `--no-checkout` e todo comando git do staging leva `core.hooksPath` para uma pasta vazia, então nenhum filtro (smudge,
  git-lfs) nem hook da configuração global da pessoa roda sobre a candidata antes da assinatura; só depois dela vem o
  `checkout --force --detach` do commit verificado. O `verify-tag` fixa `gpg.format=ssh`, `gpg.ssh.program=ssh-keygen`,
  `gpg.program=false`, `gpg.openpgp.program=false` e `gpg.x509.program=false`: um `gpg.ssh.program` aprovador no
  `.gitconfig` não aprova mais a tag de uma chave que não é a embutida. Continua pelo `PATH` (A3, backlog).
  O transporte (A5) também é fixado: `ls-remote` e `clone` rodam com `GIT_ALLOW_PROTOCOL` só do protocolo da origem, helper de credencial e askpass zerados e sem prompt (o ambiente volta ao valor anterior ao fim da chamada); numa pasta já instalada o instalador passa as chaves embutidas ao atualizador pela opção interna `--assinantes-do-instalador <arquivo>` (não por variável de ambiente; a opção não prova quem chamou, só evita que a âncora seja herdada por acidente numa atualização manual ou agendada). Se o atualizador da pasta é antigo e devolve código 2 ("Uso:") para a opção, o instalador para com a mensagem da pasta nova e saída diferente de zero, sem mexer na pasta.
  **Base mínima (decisão 1).** O mesmo critério de pasta instalada do instalar.sh (`AnvEhInstalacao`: a pasta `.git`, o `AGENTS.md`, o src/cli.ts e a pasta skills). Antes do registro na pasta e de qualquer execução, `AnvLerVersaoDaPasta` lê o `package.json` como texto (`ConvertFrom-Json`, UTF-8 estrito, BOM aceito) e `AnvVerificarBaseMinima` compara com a base embutida; menor, ausente, ilegível, inválida ou pré-release para com `AnvParar 1` e a mesma mensagem simples. Instalador sem a base embutida para com código 3, como sem a chave.
- **Estado das chaves.** `AnvConferirEstadoDasChaves` (antes do clone, ou depois da base mínima e antes de executar a pasta) consulta a lista com `HttpWebRequest` (`AnvLerConfiancaHttp`: sem redirecionamento, prazo de parede de 15 s no total, incluindo leituras, e cabeçalhos sem cache), valida o documento (`AnvValidarConfianca`), calcula a fingerprint de cada chave embutida em .NET (`AnvImpressaoDaLinha`, igual à do `ssh-keygen -lf`) e usa só a interseção (`AnvFiltrarAssinantes`) no `verify-tag` e na opção `--assinantes-do-instalador`; também recusa tag ou pasta instalada abaixo da `versaoMinima`. Provado em Pester (unitários e e2e com `scripts/servir-confianca-teste.ts` em loopback); o TLS real contra o domínio do dono não foi provado. O limite de 64 KiB vale durante a leitura: o corpo é lido em blocos e o pedido é abortado ao passar dele. Nome de campo repetido no documento é recusado (contagem no texto bruto), assim como qualquer barra invertida (`\`), para rejeitar escapes JSON. No Linux, `curl --max-time 15` já limita a requisição inteira; os testes de `instalar-sh` cobrem escapes em valor e nome.
- **Manifesto e chave.** Vêm embutidos pela release (`bun scripts/embutir-instalador.ts --modelo instalador/instalar.ps1`,
  e `--conferir` prova que a cópia é igual aos arquivos). O `instalar.ps1` do repositório é só o modelo: sem chave embutida
  ele **recusa instalar** (código 3). `ANVILORE_MANIFESTO` e `ANVILORE_ASSINANTES` (arquivos) só valem com a região
  correspondente vazia; numa release são ignorados, e há teste para isso.
- **Sem agente.** Nenhuma CLI no `PATH` e a oferta do Claude Code recusada (ou modo sem perguntas): o kit fica instalado e o
  código é 10, com "instale um agente e rode o instalador de novo". Reinstalar numa pasta já instalada só confere e roda
  `atualizar`, sem sobrescrever nada.
- **Bun gerenciado.** Se o instalador pôs o Bun, grava `bunGerenciado: true` no estado da atualização (o atualizador só mexe
  no Bun nesse caso); um marcador (o arquivo bun-gerenciado.txt, em %LOCALAPPDATA%\Anvilore) guarda isso se a instalação parar no meio.

Provas (job `instalar-ps1` do CI, `windows-latest`, Windows PowerShell 5.1): `tests/instalar-ps1/instalar.Tests.ps1` (funções,
Pester) e `tests/instalar-ps1/e2e.Tests.ps1` (o script de verdade, num perfil vazio com espaço no nome, contra um repositório
local com tag assinada por chave descartável criada no teste, usando o instalador **embutido pelo mesmo mecanismo da
release**). Os cenários cobertos: instalação do zero sem Git, Bun nem rg (baixa e confere os três), reinstalar sem mexer em
`raw/`, tag sem assinatura, de outra chave, com o nome trocado e com assinatura OpenPGP falsa (com um `gpg` de mentira que
aprovaria tudo), filtro de checkout e hook na configuração global, `gpg.ssh.program` aprovador (A1 e A2; cada um provado
com uma mutação que desfaz a correção e derruba o teste), instalador sem chave, `ANVILORE_ASSINANTES` ignorado numa release, sem agente, hash adulterado, versão e
pasta pedidas. `tests/instalar-ps1.test.ts` e `tests/instalador-embutir-ps1.test.ts` (Bun) guardam o contrato estático e o
embutir. **Não provado:** execução como usuário sem administrador (o runner é administrador; o plano da U0 já provou a
extração e o uso sem admin), duplo clique e SmartScreen, Explorer e terminais já abertos com o `PATH` novo, Constrained
Language Mode **real** (AppLocker/WDAC; os testes só forçam o caminho do `reg.exe`), CPU sem AVX2 (o Bun "baseline" só é
tentado se o normal não abrir), o instalador oficial do Claude Code, `irm | iex` contra o GitHub real (a primeira release
assinada ainda não existe) e a janela real com acentos.

## O que esta página não afirma

- Que o CI da Onda 1 esteja verde nos três sistemas; só a fundação tem execução confirmada acima.
- Qualquer número de latência no Windows ou no macOS; só o Linux local foi medido.
- Que o instalador funcione fora do Linux e do Windows x64 (e, no Windows, só o que o CI do `instalar-ps1` provou, listado acima).

Quando o CI rodar e provar ou desmentir cada risco, ajuste a linha correspondente e peça a revisão
por pessoa (veja [contribuindo.md](contribuindo.md)).

Contexto da escolha de plataforma: [decisoes.md](decisoes.md).
