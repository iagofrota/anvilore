---
generated: 2026-10-24
---

# Plataformas

**Alvo:** Linux, Windows nativo e macOS, os três obrigatórios. É decisão do dono do projeto em
2026-10-23. O estado de hoje é mais estreito, e esta página separa o que já está tratado no código
do que ainda é só hipótese.

## Estado de hoje

- O `README.md` ainda diz que o suporte é só Linux. O hook ativo declara "Alvo declarado:
  Linux" (`hooks/proteger-raw.sh`, linha 19). O instalador já está em TypeScript no Bun:
  `src/comandos/instalar.ts`, com caminhos de `node:path` e links de `node:fs/promises`.
- O hook ainda depende de `jq` e `python3` (`hooks/proteger-raw.sh`, linhas 64 a 72). O
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
| Caminho com barra invertida, `raw.`, `raw ` ou unidade `C:` | `estaEmRaw` (`src/lib/caminhos.ts`) separa por barra, barra invertida e `:`, tira ponto e espaço do fim e ignora a caixa. Teste: `tests/lib-caminhos.test.ts`. | O hook em TypeScript ainda não existe; o hook ativo é `hooks/proteger-raw.sh`. Falta também resolver o caminho e o link simbólico antes de comparar. |
| Links e junções | `ligarDiretorio` em `src/comandos/instalar.ts` usa junção no Windows e link simbólico relativo em Linux/macOS. O Copilot liga arquivos com link simbólico. Falha avisa e não copia; o instalador sai com 4. `tests/juncoes.test.ts` imprime o resultado e confere uma edição após a ligação. | Junção: a confirmar pelo CI do PR da Onda 1. A etapa de medição em `.github/workflows/ci.yml` imprime criado ou falhou por sistema e reprova se falhar. Link de arquivo no Windows pode depender de privilégio ou modo desenvolvedor. |
| Dependências do sistema (`jq`, `python3`, `awk`, `mktemp`, `readlink`) | Somem com o porte. | O `git` continua necessário; o diagnóstico de ambiente ainda não existe. |
| Latência do hook | Nada medido. | O hook roda a cada gravação do agente. Um processo Bun novo por gravação precisa de latência aceitável: **medir antes de declarar**. |

### macOS

| Risco | O que a biblioteca já trata | Falta |
|---|---|---|
| Maiúsculas e minúsculas: o disco padrão não diferencia Pagina.md de pagina.md | `chaveDeNome` (`src/lib/caminhos.ts`) compara em minúsculas, e o validador (`src/comandos/validar.ts`, linhas 91 a 98) reprova dois arquivos da mesma pasta que só diferem na caixa. Teste: `tests/validar.test.ts`, que só roda esse cenário em disco que distingue a caixa (Linux). | Só o Linux executou; a confirmação no macOS e no Windows depende do CI. |
| Nome de arquivo com acento decomposto (`e` mais acento no lugar de `é`) | `chaveDeNome` normaliza para NFC antes de comparar. `slugDe` (`src/lib/frontmatter.ts`) tira a extensão do nome. O validador compara o slug com o nome do arquivo em NFC (`src/comandos/validar.ts`, linha 195) e resolve wikilink por `chaveDeNome` (linha 221). Teste: `tests/validar.test.ts`. | Só o Linux executou; o nome decomposto de verdade só aparece no macOS. |

A função `estaEmRaw` (`src/lib/caminhos.ts`), que o futuro hook em TypeScript vai usar, ignora a
caixa, porque no macOS e no Windows Raw/a.md é a mesma pasta `raw/`. Com ela, no Linux uma pasta
chamada Raw seria bloqueada (falha fechada, de propósito). O hook **ativo**,
`hooks/proteger-raw.sh`, diferencia a caixa (linha 29): hoje Raw/a.md passa por ele. Veja
[governanca.md](governanca.md).

## O que esta página não afirma

- Que o CI da Onda 1 esteja verde nos três sistemas; só a fundação tem execução confirmada acima.
- Qualquer número de latência.
- Que o instalador funcione fora do Linux.

Quando o CI rodar e provar ou desmentir cada risco, ajuste a linha correspondente e peça a revisão
por pessoa (veja [contribuindo.md](contribuindo.md)).

Contexto da escolha de plataforma: [decisoes.md](decisoes.md).
