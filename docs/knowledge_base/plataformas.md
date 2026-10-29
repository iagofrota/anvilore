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
| Cópia e restauração do atualizador (`src/lib/atualizacao.ts`) | Caminhos guardados com `/` e montados com `node:path`; link que aponta para pasta é marcado e volta como junção no Windows, como o `instalar` cria. Caminho que passa por link dentro do kit é recusado. | Só o Linux executou os cenários de `tests/atualizar.test.ts`; a restauração de junção e o `readlink` de junção no Windows não foram provados. O `instalar` cria a junção com caminho absoluto; um link de pasta **relativo** criado pela pessoa voltaria como junção resolvida contra a pasta do processo, não a do link — a conferência por `readlink` acusaria a diferença (falha visível), mas o link ficaria errado. |
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

## O que esta página não afirma

- Que o CI da Onda 1 esteja verde nos três sistemas; só a fundação tem execução confirmada acima.
- Qualquer número de latência no Windows ou no macOS; só o Linux local foi medido.
- Que o instalador funcione fora do Linux.

Quando o CI rodar e provar ou desmentir cada risco, ajuste a linha correspondente e peça a revisão
por pessoa (veja [contribuindo.md](contribuindo.md)).

Contexto da escolha de plataforma: [decisoes.md](decisoes.md).
