# anvilore

Um kit mínimo para manter uma wiki pessoal curada por um agente de LLM: você
acumula fontes, o agente lê, resume, cruza referências e mantém um conjunto
de páginas markdown interligadas — sem RAG, sem banco vetorial, sem infra.

## O que é

`anvilore` não é um produto nem um serviço. É um **método empacotado como
repositório**: três pastas (`raw/`, `wiki/`, `SCHEMA.md`), duas skills
(`ingest`, `query`) e um validador. Clone, aponte seu agente de código
(Claude Code, Codex, ou equivalente) para `AGENTS.md`, e comece a acumular
conhecimento a partir da primeira fonte que você jogar em `raw/`.

O repositório carrega só o método. O conteúdo — as fontes que você ingere,
as páginas que o agente escreve — é seu, fica de fora do git por padrão
(veja `.gitignore`), e nunca sai da sua máquina a menos que você decida
publicar.

## A quem serve

Quem já tentou manter uma base de conhecimento pessoal — Obsidian, Notion,
uma pasta de markdown — e abandonou porque a parte de organizar, cruzar
referências e manter tudo atualizado é chata e ninguém sustenta por mais de
duas semanas. A proposta aqui é delegar exatamente essa parte chata a um
agente, mantendo curadoria e autoridade sobre o que é verdade com você.

Serve também a quem programa com um agente de código no dia a dia e quer
aplicar o mesmo fluxo de trabalho — instrução clara, contrato explícito,
verificação automatizada — a uma coleção de conhecimento em vez de uma
base de código.

## De onde isto veio

Nada aqui nasceu do zero, e acho que vale contar a linhagem inteira — inclusive
porque ela explica melhor o repositório do que qualquer descrição de features.

**O ponto de partida foi o [Segundo Cérebro](https://www.buildingasecondbrain.com/book),
de Tiago Forte.** Capturar, organizar, destilar e expressar. A parte de capturar
sempre foi fácil. Organizar e destilar é que nunca sobreviveu a duas semanas —
é trabalho chato, repetitivo, e sem ele o resto não compõe.

**Depois veio o gist [`llm-wiki.md`](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f),
do Andrej Karpathy.** Ele descreve o padrão: em vez de perguntar a um LLM e
jogar a resposta fora, deixe o agente manter uma wiki que sobrevive à conversa.
O gist é deliberadamente abstrato — um padrão, não uma implementação. Está
reproduzido na íntegra em `raw/exemplo/` deste repositório, como fonte de teste.

**E a implementação que me mostrou que o padrão funcionava foi a
[`wiki-wonka`](https://github.com/cooperacode/wiki-wonka), da Coopera Code.**
Foi dela que saiu o desenho que está aqui: o fluxo de dois tempos do `ingest`
(discutir antes de escrever), o `query` que só responde citando página, o
frontmatter, os wikilinks e o sistema de callouts. As skills deste repositório
são **obra derivada** dela — traduzidas para português do Brasil e adaptadas,
sob a licença MIT, com o aviso de copyright original preservado no `LICENSE`.

O que este repositório acrescenta por cima: o passo de despacho de subagentes
no `ingest`, o validador `scripts/validar-wiki.sh` com testes, um schema
deliberadamente menor, e a ideia de que a coisa cresce em níveis — você começa
com duas skills e um contrato, e só adiciona estrutura quando a dor aparece.

## Começo em 5 minutos

```bash
git clone <este-repositório>
cd anvilore
```

1. Abra o repositório com seu agente de código de preferência. `CLAUDE.md`
   aponta para `AGENTS.md` — é o contrato que ele precisa ler antes de tocar
   em qualquer arquivo.
2. Peça ao agente para seguir `skills/ingest/SKILL.md` e ingerir
   `raw/exemplo/llm-wiki.md` — o próprio texto que originou este padrão.
3. Depois de ingerido, peça para ele seguir `skills/query/SKILL.md` e
   responder alguma pergunta sobre o conteúdo ingerido, citando as páginas
   que criou.
4. Valide a estrutura:

   ```bash
   bash scripts/validar-wiki.sh
   ```

   Espera-se `VALIDACAO: PASS`, com uma linha de dívida de conhecimento
   (gaps e contradições sinalizados, se houver — zero também é uma resposta
   válida).

   > O validador é shell puro. A única checagem opcional que precisa de algo
   > além disso é o [perfil de proveniência](SCHEMA.md#perfil-de-proveniência-opcional),
   > que lê o frontmatter com **PyYAML** (`pip install pyyaml`). Sem ele, o
   > validador pula esse perfil com uma linha `SKIP:` dizendo por quê e segue
   > normalmente — nunca reprova por falta da dependência.

Isso é o nível 02 completo. Não tem mais nada além disso rodando por trás.

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

**Este repositório entrega os níveis 01 e 02.** É deliberadamente mínimo: o
esqueleto de `wiki/` que você acabou de clonar é plano — só `wiki/index.md`
e `wiki/log.md`, sem `wiki/<área>/` nem campo `area` no `SCHEMA.md`. Isso não
é uma peça esquecida. Organizar um punhado de páginas em áreas temáticas é
cerimônia que ninguém sente falta com 20 páginas; organizar centenas sem
nenhuma estrutura é inviável. Precisar de áreas — e de tudo que vem junto,
como lint automatizado para pegar o que a disciplina manual deixa passar — é
justamente uma das dores que empurram para o nível 03. Ele chega quando
chegar essa dor, não antes.

O nível 04 (índice de busca dedicado, backup, automação de manutenção) não
está empacotado aqui de propósito: ele só faz sentido depois que uma wiki
real ultrapassa o que um índice markdown e um agente conseguem varrer numa
sessão, e nesse ponto as escolhas certas dependem tanto do seu volume de
dados e do seu agente que empacotar uma resposta genérica seria entregar
complexidade que você ainda não conquistou.

## Licença

MIT — veja [`LICENSE`](./LICENSE).
