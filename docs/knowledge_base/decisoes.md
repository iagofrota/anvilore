---
generated: 2026-10-27
---

# Decisões

O porquê das escolhas do Anvilore. Cada decisão diz o que a sustenta. Quando não há arquivo que a
sustente, ela vem marcada como **decisão do dono do projeto**, com a data. Nesse caso a página
registra a decisão e não a explica além do que o dono disse.

Para a linhagem do método e a argumentação completa das posições de design, leia `FILOSOFIA.md`.

## Rust descartado; TypeScript no Bun

- **Decisão do dono do projeto em 2026-10-23.** Rust foi descartado. TypeScript rodando no Bun foi
  escolhido pela integração futura com SDKs de agentes.
- O que o repositório mostra hoje: `package.json` fixa o Bun (`packageManager`), declara o
  executável `anvilore` apontando para `src/cli.ts`, inclui o SDK oficial do MCP como
  dependência de produção e deixa os tipos de Bun e o TypeScript como dependências de desenvolvimento;
  `tsconfig.json` liga o modo estrito; `bunfig.toml` define o
  limite de cobertura.
- O frontmatter é lido com o YAML que o próprio Bun traz (`Bun.YAML.parse`, em
  `src/lib/frontmatter.ts`), sem biblioteca de terceiros.

## Portar tudo, nos três sistemas

- **Decisão do dono do projeto em 2026-10-23.** Os scripts de manutenção, o instalador e o hook
  passam de bash e Python para TypeScript no Bun, e o alvo passa a ser Linux, Windows nativo e
  macOS, os três obrigatórios.
- O que o repositório mostra hoje: validação, manutenção, instalador e hook estão em TypeScript no Bun
  (`src/cli.ts`, `src/comandos/instalar.ts` e `src/comandos/hook-proteger-raw.ts`);
  o fechamento (`src/comandos/fechar.ts`) também é TypeScript. O `README.md`
  declara suporte a Linux, Windows e macOS. O CI roda nos três sistemas (`.github/workflows/ci.yml`) e passou nos PRs das Ondas 1 (#13, run 40150863576) e 2 (#11, run 40191764239). Os detalhes e os riscos
  estão em [plataformas.md](plataformas.md).

## Não fundir buscas

- **Decisão do Iago em 2026-10-26.** O MCP consulta apenas a wiki; cada outra fonte fica nos MCPs
  próprios, sem ranking fundido.
- O caminho sem MCP continua usando `rg --no-ignore` (`skills/query/SKILL.md`).

## Curadoria humana não é opcional

- O agente ingere, cruza e escreve. O que entra como verdade passa por quem cura
  (`FILOSOFIA.md`, seção 2; `README.md`, parágrafo "Por que ele é assim").
- Onde isso está escrito como regra: `skills/ingest/SKILL.md` manda o leitor ler a fonte sem
  escrever, mostrar de 3 a 5 takeaways e a lista de páginas numa parada só e só depois o escritor
  escrever (Passos 1 a 3). O `AGENTS.md` proíbe o agente de resolver uma contradição entre fontes
  por conta própria.
- **Limite honesto:** isso é texto de skill e de contrato. Nenhum script ou hook confere que a
  pessoa deu o aval. Veja [governanca.md](governanca.md).

## Leitor e escritor sempre separados

- **Decisão do Iago em 2026-10-27, trazida pelo líder do W06.** A ingestão separa sempre os dois
  papéis, para fonte de qualquer tamanho: o leitor lê e devolve o relatório, a pessoa aprova takeaways e
  páginas numa parada só, e só então o escritor escreve. A pessoa nunca roda comando.
- O que mudou do R70: ele dispensava subagentes abaixo de 400 000 bytes. O motivo era portabilidade, não
  custo: a skill não podia pressupor subagentes nem um modelo do Claude Code. Esse motivo continua. No
  Claude Code a skill despacha os agentes `anvilore-leitor` e `anvilore-escritor`, que o
  `anvilore instalar` gera dos prompts (`src/lib/papeis-ingestao.ts`). Onde não há subagente com
  ferramentas restritas, a própria sessão faz os dois papéis, guiada pelos mesmos arquivos. O tamanho da
  fonte decide só a janela de contexto (`anvilore rota-ingestao`).
- Os prompts (`skills/ingest/leitor.md`, `skills/ingest/escritor.md`) e o esquema do relatório
  (`skills/ingest/relatorio-leitor.schema.json`) são a fonte única para a skill no terminal e para a
  interface. O código só interpreta o esquema (`src/lib/relatorio-leitor.ts`).

## A fronteira rígida entre raw e wiki

- `raw/` é da pessoa; `wiki/` é do agente (`AGENTS.md`, tabela de camadas; `FILOSOFIA.md`,
  seção 1).
- O hook `anvilore hook proteger-raw` (`src/comandos/hook-proteger-raw.ts`) transforma a regra em
  recusa **para as ferramentas de edição de arquivo e para o comando de terminal**, dentro dos
  limites de [governanca.md](governanca.md). Ele falha fechado quando não consegue isolar o caminho. O alcance exato está em
  [governanca.md](governanca.md).

## Sem RAG; índice local opcional

- A wiki continua sendo Markdown. O índice FTS5 local é opcional, derivado e descartável, fica no
  diretório oculto local ignorado pelo Git, e pode ser reconstruído a partir de `wiki/`.
- Os comandos de métricas e o MCP usam o diretório local de dados na raiz do clone; `ANVILORE_DIR`
  substitui esse diretório para ambientes isolados.
- O servidor MCP roda sob demanda. Não há RAG, banco vetorial ou serviço residente.
- Uma falha temporária ao abrir o índice não desativa a sessão MCP: cada `buscar` tenta sincronizar
  de novo, e falhas de acesso/ocupação são relatadas como `indice_indisponivel`.
- Um symlink de Markdown cujo alvo real continua dentro de `wiki/` entra no índice só pelo caminho
  canônico do alvo, mantendo o endereço de busca consistente com `ler`.

## SDK oficial do protocolo MCP

- **Decisão do Iago em 2026-10-26.** @modelcontextprotocol/sdk é a primeira dependência de
  produção do kit, para manter a porta MCP conforme o protocolo oficial.

## Revisão web local opcional

- **Decisão do dono do projeto em 2026-10-27.** `anvilore ui` oferece uma interface local opcional
  para revisar rascunhos. O servidor só existe enquanto o comando roda; a wiki segue em arquivos
  Markdown e continua legível sem ele. Esta é uma exceção explícita à posição de não manter servidor
  (`FILOSOFIA.md`, seção 4). O backend usa `Bun.serve`; o front React+TypeScript é compilado por
  `bun run build:ui` e os assets são empacotados em `src/ui/public/`.
- Durante a escrita de uma ingestão, `ANVILORE_SEM_AUTOCOMMIT=1` desliga o autocommit do hook
  `hooks-wiki autocommit`; a aprovação posterior continua sendo feita pela interface.
- A fila calcula SHA-256 do conteúdo exibido; o servidor confere essa versão dentro de
  `aprovarPaginas` antes de registrar `verified`. Se o conteúdo mudou, a interface informa a pessoa
  e recarrega a fila para uma nova revisão (`src/lib/ui-fila.ts`, `src/comandos/aprovar.ts`,
  `src/ui/servidor/servidor.ts`, `ui/web/main.tsx`). A fila também usa a mesma validação de timestamp
  de `src/lib/okf.ts`, incluindo offsets só de horas.
- O comportamento está em `src/ui/servidor/`, `src/comandos/hooks-wiki.ts` e `tests/hooks-wiki.test.ts`.

## Neutralidade de provedor de agente

- Uma fonte só de skills e de hook, ligada a Claude Code, Codex, Gemini e Copilot por
  `anvilore instalar` (`FILOSOFIA.md`, seção 5; `hooks/README.md`, tabela "As formas por agente").
- Só a forma do Claude Code foi exercitada de ponta a ponta com um agente de verdade. As outras
  três foram instaladas conforme a documentação de cada uma e não foram executadas
  (`hooks/README.md`, final).

## Governança desta versão: padrões e guardrails

- **Decisão do dono do projeto em 2026-10-23.** Esta versão prioriza padrões e guardrails.
  Vazamento de documentos internos fica para depois, e o projeto não afirma que protege
  contra ele. O `CHANGELOG.md` registra isso em "Não resolvido nesta versão".
- O que está de fato imposto, e o que não está, é o assunto de [governanca.md](governanca.md).

## Esta knowledge base é documentação, não wiki

- **Decisão do dono do projeto em 2026-10-23.** A pasta `docs/knowledge_base/` fica no repositório,
  trata do projeto (nunca das notas de quem usa) e é escrita junto com o código. O contrato do
  agente continua em `AGENTS.md`, e `CLAUDE.md` só aponta para ele.
- A trava que sustenta isso: `bun src/cli.ts checar-docs` (links e menções) e
  `bun src/cli.ts checar-release` (revisão por pessoa antes da release). Código em
  `src/comandos/checar-docs.ts` e `src/comandos/checar-release.ts`.
