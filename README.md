# anvilore

Um kit mínimo para manter uma wiki pessoal curada por um agente de LLM: você
acumula fontes, o agente lê, resume, cruza referências e mantém um conjunto
de páginas markdown interligadas — sem RAG, sem banco vetorial, sem infra.

## O que é

`anvilore` não é um produto nem um serviço. É um **método empacotado como
repositório**:

| Peça | O que é |
|---|---|
| `raw/` | as fontes que você acumula. O agente lê; nunca escreve. |
| `wiki/` | as páginas markdown que o agente mantém e interliga |
| `SCHEMA.md` | o contrato de formato das páginas: tipos, frontmatter, wikilinks e callouts |
| `AGENTS.md` | o contrato do agente: o que ele faz, o que não faz |
| `skills/ingest`, `skills/query`, `skills/lint` | ingerir uma fonte; responder citando página; varrer a wiki atrás de problemas estruturais |
| `src/` | o comando `anvilore` em TypeScript, que roda no [Bun](https://bun.sh); traz validação, instalação, áreas, proteção de fontes e manutenção (índice, log, lacunas, auditoria e rejunção de linhas) |
| `scripts/` | a biblioteca do legado e as medições em TypeScript |
| `anvilore fechar` | sincroniza índices, reconstrói o log, valida a wiki e cobra o log do dia |
| `hooks/` | a regra "`raw/` é imutável" na forma de hook; a decisão mora num subcomando só (`anvilore hook proteger-raw`, em `src/comandos/hook-proteger-raw.ts`) |
| `anvilore instalar` | configura um clone para o agente que você usa: Claude Code, Codex, Gemini ou Copilot |
| `anvilore doctor` | diz, em linguagem simples, quais travas estão ligadas (proteção do `raw/`, validação, CI) e como ligar as que faltam |
| `tests/` | os testes que provam os scripts, o hook e o instalador |
| `docs/knowledge_base/` | a documentação do próprio Anvilore, escrita para agentes que desenvolvem o projeto ou respondem dúvidas sobre ele |

O repositório carrega só o método. O conteúdo — as fontes que você ingere,
as páginas que o agente escreve — é seu, fica de fora do git por padrão
(veja `.gitignore`), e nunca sai da sua máquina a menos que você decida
publicar.

Serve a quem quer manter uma base de conhecimento pessoal sem fazer à mão a
parte de organizar, cruzar referências e manter tudo atualizado.

**Por que ele é assim** — a fronteira rígida entre `raw/` e `wiki/`, a
curadoria humana como não-opcional, o crescimento por níveis, a ausência
deliberada de RAG e a neutralidade de provedor de agente — está em
[`FILOSOFIA.md`](./FILOSOFIA.md), junto com a linhagem de onde isto veio.

## Começo em 5 minutos

Linux. Não há suporte a Windows nem a macOS.

**Antes de começar** você precisa de dois programas:

- o [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`): o comando `anvilore`, o validador e o hook rodam nele;
- o `git`.

```bash
git clone https://github.com/iagofrota/anvilore.git
cd anvilore
bun install --frozen-lockfile
bun src/cli.ts instalar --simular
```

`--simular` só relata o que o instalador faria; não cria, não altera e não
remove nenhum arquivo. Quando a lista estiver do seu agrado, instale de
verdade:

```bash
bun src/cli.ts instalar --alvo claude
```

`--alvo` aceita `claude`, `codex`, `gemini`, `copilot` — separados por
vírgula — ou `todos`, que é o padrão. Alvo cuja CLI não estiver no `PATH` é
relatado e pulado, e a execução termina com sucesso. Para instalar em outro
clone que não o deste kit, use `--destino <dir>`: o instalador escreve
exclusivamente dentro desse diretório. `bun src/cli.ts instalar --help` descreve
o que cada agente recebe e os limites quando fonte e destino são clones diferentes.

O hook que protege `raw/` só vale em sessões do agente abertas **depois** da
instalação: se o agente já estava aberto, feche e reabra. Para conferir a
decisão sem agente nenhum (deve imprimir `2`, que é "bloqueado"):

```bash
printf '{"tool_name":"Write","tool_input":{"file_path":"raw/teste.md"}}' | bun src/cli.ts hook proteger-raw; echo $?
```

`bun src/cli.ts doctor` mostra, em linguagem simples, quais travas estão ligadas.

Com o clone configurado:

1. Abra (ou reabra) o repositório com seu agente de código. `CLAUDE.md` aponta para
   `AGENTS.md` — é o contrato que ele precisa ler antes de tocar em qualquer
   arquivo.
2. Escolha suas áreas da vida:

   ```bash
   bun src/cli.ts init
   ```

   O comando oferece as áreas padrão (pessoal, profissional,
   projetos-paralelos e saude); você aceita todas, tira algumas e adiciona
   outras, e cada área vira `wiki/<área>/{sources,entities,concepts}`. Sem
   terminal, passe `--areas pessoal,saude`. Repetir o comando não altera o que
   já existe. Se você usa um `anvilore.toml` com `areas`, o `init` recusa a área
   que não estiver na lista; e o `wiki/exemplo/` que veio no clone também não
   está nela, então apague-o antes de ligar o toml, senão o `validar` o reprova.
   Apague as duas coisas: a pasta (`rm -r wiki/exemplo`) **e** a seção do
   exemplo no `wiki/index.md`, que é a última do arquivo — do título
   `## Área: exemplo` até o fim do arquivo (o título, `### Conceitos` e a linha
   `- [[area-tematica]] — …`). Só a pasta deixaria o link `[[area-tematica]]` no
   índice, e o `validar` reprovaria por wikilink quebrado.
3. Peça ao agente para seguir `skills/ingest/SKILL.md` e ingerir
   `raw/exemplo/llm-wiki.md` — o próprio texto que originou este padrão. **Diga
   em que área ingerir** (se você criou uma só, ele usa essa). O ingest é uma
   conversa: o agente apresenta os pontos principais e a lista de páginas e
   espera o seu "pode seguir" antes de escrever.
4. Depois de ingerido, peça para ele seguir `skills/query/SKILL.md` e
   responder alguma pergunta sobre o conteúdo ingerido, citando as páginas
   que criou.
5. Revise e aprove o que o agente escreveu, e valide a estrutura. Toda página
   que o agente escreve nasce marcada como **rascunho** (bloco `generated` no
   frontmatter), e o validador reprova rascunho que nenhuma pessoa aprovou. Logo
   depois do ingest, então, o esperado é:

   ```bash
   bun src/cli.ts validar
   ```

   ```text
   ERRO: página gerada sem aprovação humana: pessoal/sources/llm-wiki.md
   ...
   VALIDACAO: FAIL
   ```

   Isso é o portão funcionando, não um defeito. Leia cada página e, se
   concordar, acrescente ao frontmatter dela a sua aprovação (o `at` tem de ser
   igual ou posterior ao `generated.at`, com o fuso):

   ```yaml
   verified:
     - by: human:seu-id
       at: 2026-10-24T11:00:00-03:00
   ```

   Rode `bun src/cli.ts validar` de novo: agora sim `VALIDACAO: PASS`, com uma
   linha de dívida de conhecimento (gaps e contradições sinalizados, se
   houver — zero também é uma resposta válida). O agente nunca escreve
   `verified`: quem aprova é você. Para fechar a sessão, `bun src/cli.ts fechar wiki`
   sincroniza os índices, regenera `wiki/log.md` a partir de `wiki/log/` e
   valida (o agente roda isso ao fim do ingest).

   Dois arquivos da wiki são rastreados pelo git e mudam a cada uso:
   `wiki/index.md` e `wiki/log.md`. Um `git pull` futuro pode conflitar com eles;
   o resto do conteúdo (suas páginas) fica fora do git.

   > O validador roda no [Bun](https://bun.sh) e não tem outra dependência: ele
   > lê o YAML do frontmatter sozinho, então o
   > [perfil de proveniência](SCHEMA.md#perfil-de-proveniência-opcional) nunca é
   > pulado. Sem o Bun o comando não roda — ele nunca imprime `VALIDACAO: PASS`
   > por falta de ferramenta. Além do formato das páginas, ele reprova wikilink
   > quebrado, página fora do `index.md` e página com `generated` sem
   > verificação humana posterior. Uma empresa pode restringir áreas, tipos e
   > campos obrigatórios num `anvilore.toml` (veja o `SCHEMA.md`).

Quando a wiki crescer, `skills/lint/SKILL.md` faz a varredura de manutenção:
o que está estruturalmente quebrado, o que virou dívida de conhecimento e o
que ficou invisível na navegação.
Para consultar os callouts abertos sem escrever o índice, rode
`bun src/cli.ts listar-lacunas wiki --consultar`. Sem `--consultar`, o comando
atualiza `wiki/_meta/lacunas.md`.

Para conferir as contagens dos índices de área sem escrever, rode
`bun src/cli.ts sincronizar-indice wiki --checar`. Sem `--checar`, o comando
atualiza a linha de contagem; uma área sem index.md é ignorada.

Para reconstruir `wiki/log.md` a partir de `wiki/log/log-*.md`, rode
`bun src/cli.ts indexar-log wiki`. Com `--stdout`, o comando só imprime o índice.
Se não houver arquivo de dia, preserva `wiki/log.md`.

## Os quatro níveis

O repositório é organizado em níveis progressivos. Cada um só existe porque
o anterior doeu em algum ponto específico — não adiante nível, adote o
próximo quando sentir a dor que ele resolve.

| Nível | Nome | Peças | Dor que motiva o próximo salto |
|---|---|---|---|
| 01 | princípio | `raw/`, `wiki/`, `AGENTS.md` | o agente organiza a wiki de qualquer jeito, sem convenção nenhuma |
| 02 | disciplina | `SCHEMA.md`, `skills/ingest`, `skills/query` | erros estruturais (frontmatter incompleto, slug divergente, tipo inválido) acumulam em silêncio |
| 03 | governança | `skills/lint`, `hooks/`, testes | a wiki cresce além do que cabe no contexto de uma sessão só |
| 04 | escala | índice de busca, backup, automação | (fora deste kit — ver abaixo) |

**Este repositório entrega os níveis 01, 02 e 03.** O esqueleto de `wiki/`
que você acabou de clonar já traz a *forma* das áreas: uma área de exemplo
neutra (`wiki/exemplo/{sources,entities,concepts}`), os diretórios
reservados `wiki/_meta/` e `wiki/log/`, e o campo opcional `area`
documentado no `SCHEMA.md`. Mas a estrutura de áreas é oferecida, não
exigida: uma wiki plana, com as páginas soltas na raiz de `wiki/`, continua
válida e continua validando.

A governança do nível 03 está no repositório: `skills/lint` varre a wiki e
separa o que dá para corrigir sem julgamento do que precisa de quem cura;
`anvilore hook proteger-raw` recusa escrita dentro de `raw/` (por ferramenta
de edição e por comando de terminal), na forma de configuração de cada agente; e `tests/` prova os scripts, o hook e o
instalador.

O nível 04 (índice de busca dedicado, backup, automação de manutenção) não
está empacotado aqui de propósito: ele só faz sentido depois que uma wiki
real ultrapassa o que um índice markdown e um agente conseguem varrer numa
sessão. Nesse ponto as escolhas certas dependem tanto do seu volume de dados
e do seu agente que uma resposta genérica entregaria complexidade que você
ainda não conquistou.

## Licença

MIT — veja [`LICENSE`](./LICENSE).
