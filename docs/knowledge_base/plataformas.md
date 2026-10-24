---
generated: 2026-10-24
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
  funcionou no Windows desse CI (resultado registrado pelo líder). Isso não confirma as novas
  junções do instalador. A Onda 1 continua a confirmar pelo CI do seu PR; a declaração geral
  de suporte só muda depois dessa execução.
- O `.gitattributes` fixa `eol=lf` para texto, Markdown e TypeScript, para o checkout no Windows
  não trazer CRLF.

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
| Links e junções | `ligarDiretorio` em `src/comandos/instalar.ts` usa junção no Windows e link simbólico relativo em Linux/macOS. O Copilot usa `ligarArquivo`. Falha avisa e não copia; o instalador sai com 4. `tests/juncoes.test.ts` confere edições após a ligação. `scripts/medir-ligacoes.ts` imprime o resultado para diretório e arquivo. | Junção: a confirmar pelo CI do PR da Onda 1. A medição em `.github/workflows/ci.yml` usa always(), mesmo após erro anterior, e reprova se uma ligação falhar. Link de arquivo no Windows pode exigir modo desenvolvedor ou administrador; o diagnóstico sugere essas opções. |
| Dependências do sistema (`jq`, `python3`, `awk`, `mktemp`, `readlink`) | Somem com o porte. | O `git` continua necessário; o diagnóstico de ambiente ainda não existe. |
| Latência do hook | `scripts/medir-latencia-hook.ts` mede 20 execuções de `bun src/cli.ts hook proteger-raw` (escrita comum e terminal) e imprime mediana e p95. O CI roda essa etapa em cada sistema (`.github/workflows/ci.yml`, sempre, mesmo após falha anterior). Medida local em Linux, 2026-10-24: mediana 10,5 ms e p95 15 ms (escrita comum); mediana 10,8 ms e p95 11,8 ms (terminal). | Windows e macOS: a ler do log do CI do PR da Onda 1. Se o Windows vier alto, o plano manda parar e levar ao dono, não declarar aceitável. |
| Forma instalada do hook (shell do hook em cada agente) | `src/comandos/instalar.ts` grava, por agente: Claude `bun "$CLAUDE_PROJECT_DIR"/src/cli.ts hook proteger-raw \|\| exit 2` com `shell: "bash"` e `onFailure: "block"`; Codex e Gemini o mesmo comando com `\|\| exit 2`; Copilot `bash` com o mesmo e `powershell` com `...; if ($LASTEXITCODE -ne 0) { exit 2 }`. `scripts/provar-forma-instalada.ts` gera a configuração num `--destino` temporário, pega a string exata de cada agente e a executa no shell real do sistema com um payload que escreve em `raw/` (espera saída 2), um que escreve em `wiki/` (espera 0) e com o `bun` fora do PATH (espera saída diferente de 0). O CI roda essa etapa em cada sistema, sempre (`ANVILORE_EXIGIR_SHELLS=1`: shell ausente reprova): bash em Linux, macOS e Windows (Git Bash), `pwsh` em todos, `cmd` e `powershell` 5.1 no Windows. Testes: `tests/provar-forma.test.ts` (Linux, bash). | A ler do log do CI do PR da Onda 1. Pela documentação oficial (conferida em 2026-10-24): **Claude Code** roda o comando com `sh -c`, Git Bash no Windows ou PowerShell sem Git Bash; `onFailure: "block"` (2.1.295 ou mais novo) bloqueia quando o comando falha, e a página não diz o que versões anteriores fazem com a chave. **Copilot** fecha o `preToolUse` em saída diferente de 0, usa `powershell` no Windows, e timeout abre. **Codex** tem `commandWindows`, mas a página não diz o shell nem o que uma saída diferente de 2 faz; **Gemini** não documenta shell nem campo de Windows, e saída diferente de 0 e 2 é aviso (a CLI segue). **Medido com o `pwsh` 7.5.0 (2026-10-24):** nos comandos de Codex e Gemini (`... \|\| exit 2`) o PowerShell 7 também **não bloqueia**: `exit` não é comando dentro de `\|\|` e o `-Command` devolve 1 em vez do código do bun (um `bun ... ; exit $LASTEXITCODE` devolve 2). No PowerShell 5.1 o `\|\|` é erro de sintaxe. Em Codex e Gemini, portanto, o hook só fecha em `sh`/Git Bash e em `cmd`; a etapa do CI imprime o resultado de `pwsh` e `powershell` desses dois como INFO (com shell, comando, saída, stdout e stderr). O Copilot não sofre disso porque tem o campo `powershell`, exigido no CI em `pwsh` e `powershell`. Decisão do dono: qual shell Codex e Gemini usam no Windows. Risco aceito até o CI e o dono decidirem: pedir ao dono que confirme o shell de cada agente no Windows. |

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
