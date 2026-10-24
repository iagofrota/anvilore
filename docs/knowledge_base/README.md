---
generated: 2026-10-24
---

# Knowledge base do Anvilore

Esta pasta é a documentação do **produto**, escrita para agentes. Serve para quem precisa
entender como o Anvilore funciona e responder dúvidas sobre ele. Não fala das notas pessoais de
quem usa o kit e não é uma wiki gerada por ingestão: são páginas Markdown comuns, mantidas junto
com o código.

Quem **mantém uma wiki** com o Anvilore não precisa desta pasta: o contrato é o `AGENTS.md`.

## O que é o Anvilore

Um kit para manter uma wiki pessoal curada por um agente de LLM. A pessoa guarda as fontes em
`raw/`, o agente lê, resume e interliga páginas Markdown em `wiki/`, e as regras de formato estão
no `SCHEMA.md`. O kit carrega só o método; o conteúdo é de quem usa (`README.md`, seção "O que é",
e `.gitignore`).

Peças que existem hoje no repositório:

- Contrato do agente: `AGENTS.md` (e `CLAUDE.md`, que só aponta para ele).
- Skills de ingerir, consultar e varrer a wiki: `skills/ingest/SKILL.md`, `skills/query/SKILL.md`
  e `skills/lint/SKILL.md`.
- Validador e scripts de manutenção, ainda em bash e Python: `scripts/`.
- Proteção de `raw/` como hook: `hooks/proteger-raw.sh`.
- Instalador para Claude Code, Codex, Gemini e Copilot: `instalar.sh`.
- O porte para TypeScript no Bun, em andamento: `src/cli.ts` (tabela de subcomandos), a biblioteca
  em `src/lib/` e os subcomandos `checar-docs`, `checar-release` e `fatiar-log`, em `src/comandos/`.
  Os scripts, o hook e o instalador acima, salvo o `fatiar-log`, ainda não foram substituídos.

## Para onde ir com cada pergunta

| Pergunta | Página |
|---|---|
| Por que o projeto é assim? Por que TypeScript no Bun? Por que o humano cura? | [decisoes.md](decisoes.md) |
| O que protege a wiki hoje? O que não protege? Há risco de vazamento? | [governanca.md](governanca.md) |
| Funciona em Windows e macOS? O que pode dar errado? | [plataformas.md](plataformas.md) |
| Como rodo os testes? Como entrego uma mudança? Como sai uma release? | [contribuindo.md](contribuindo.md) |

## Páginas a escrever

Ainda não existem, de propósito: não se escreve sobre código que vai ser substituído. Cada uma
nasce quando o código novo que ela descreve estiver integrado.

- arquitetura: o mapa das camadas, dos componentes e do fluxo;
- comandos: cada subcomando, com entradas e códigos de saída;
- perguntas frequentes: as dúvidas que um agente costuma receber.

Enquanto não existem, a fonte é o código: `src/cli.ts` lista os subcomandos e cada um mora em
`src/comandos/`.

## Regras desta pasta

- **Afirme só o que dá para apontar.** Cada página cita os arquivos do repositório que sustentam o
  que diz. Quando uma decisão não tem arquivo que a sustente, a página diz isso e informa quem
  decidiu e quando.
- **Link e menção a arquivo são conferidos.** `bun src/cli.ts checar-docs` reprova o link
  relativo quebrado e a menção entre crases a arquivo que não existe. Ele está configurado para
  rodar no CI nos três sistemas (`.github/workflows/ci.yml`; ainda não executado). Veja o código em
  `src/comandos/checar-docs.ts`.
- **Revisão por pessoa.** Um agente pode redigir uma página; só uma pessoa a marca como revisada,
  com `verified: AAAA-MM-DD` no cabeçalho. `bun src/cli.ts checar-release` recusa a release
  enquanto houver página sem essa data (`src/comandos/checar-release.ts`). Por isso as páginas
  estão hoje só com `generated`, a data em que foram redigidas.
- **Mudou o comportamento, muda a página**, no mesmo momento ([contribuindo.md](contribuindo.md)).
