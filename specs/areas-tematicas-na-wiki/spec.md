# Feature Specification: Áreas temáticas na wiki

**Feature Branch**: `areas-tematicas-na-wiki`

**Created**: 2026-09-05

**Status**: Delivered — rodada 3 (rebaseada sobre a main remota; mérito aprovado na rodada 2)

**Input**: Ensinar áreas ao que já existe, sem trocar o runtime de nada. O `SCHEMA.md`
ganha o campo `area`; o validador em bash passa a entender a estrutura de áreas; a
`wiki/` ganha o esqueleto `<área>/{sources,entities,concepts}` mais `_meta/` e `log/`,
com uma única área de exemplo neutra; o `.gitignore` versiona o esqueleto e mantém o
conteúdo do usuário de fora.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — O validador enxerga a área (Priority: P1)

Quem organiza a wiki em áreas guarda cada página dentro de `wiki/<área>/`. Uma página
que caiu na área errada deixa de ser um erro silencioso: o validador compara o campo
`area` do frontmatter com o diretório e reprova a divergência.

**Why this priority**: É o valor central da tarefa — sem ele, o esqueleto é só pastas.
A garantia de integridade é o que o repositório existe para oferecer.

**Independent Test**: Criar uma página em `wiki/<área>/concepts/` com `area:` apontando
para outra área e rodar o validador; exigir reprovação nomeando o arquivo e as duas
áreas. Repetir com `area:` coerente e exigir aprovação.

**Acceptance Scenarios**:

1. **Given** uma página em `wiki/exemplo/concepts/` com `area: financas`, **When** o
   validador roda, **Then** ele reprova (exit ≠ 0) com mensagem que contém o caminho do
   arquivo e as duas áreas em conflito (`exemplo` e `financas`).
2. **Given** a mesma página com `area: exemplo`, **When** o validador roda, **Then**
   aprova com exit 0.
3. **Given** uma wiki plana (páginas soltas na raiz de `wiki/`, sem áreas), **When** o
   validador roda, **Then** aprova com exit 0 — a estrutura de áreas é oferecida, não
   exigida.

### User Story 2 — O esqueleto sobrevive ao clone (Priority: P2)

Quem clona o repositório encontra a forma pronta para organizar em áreas: os diretórios
versionados, sem nenhum assunto herdado. O conteúdo que a pessoa vier a escrever continua
fora do git.

**Why this priority**: A forma precisa chegar ao usuário; sem isso, cada um reinventa a
estrutura. Mas depende da User Story 1 para ter sentido.

**Independent Test**: Num clone raso do branch, verificar que os diretórios do esqueleto
existem; criar uma página de conteúdo dentro de uma área e confirmar que o git a ignora.

**Acceptance Scenarios**:

1. **Given** um clone limpo, **When** olho `wiki/`, **Then** o esqueleto
   `exemplo/{sources,entities,concepts}`, `_meta/` e `log/` está versionado.
2. **Given** um clone limpo, **When** crio `wiki/exemplo/concepts/minha-pagina.md`,
   **Then** o git a considera ignorada; a página de exemplo do esqueleto, não.

### User Story 3 — O contrato documenta o campo (Priority: P3)

Quem lê só o `SCHEMA.md` descobre quando usar `area` e o que acontece se não usar.

**Why this priority**: O contrato vem antes do código; um campo que o validador cobra e
o schema não descreve é defeito. Mas é documentação sobre um comportamento já definido
nas histórias anteriores.

**Independent Test**: Ler `SCHEMA.md` como quem nunca viu o repositório e responder, por
texto: o campo é obrigatório? o que o validador faz se ele faltar? o que faz se divergir
do diretório?

**Acceptance Scenarios**:

1. **Given** o `SCHEMA.md`, **When** procuro pelo campo `area`, **Then** encontro que é
   opcional, que não é cobrado se faltar, e que reprova se divergir do diretório.

### Edge Cases

- Página solta na raiz de `wiki/` **com** campo `area`: não há área de diretório com que
  comparar → não reprova (é o cenário de quem move páginas de volta para a raiz).
- Diretórios reservados `_meta/` e `log/` não são áreas — uma página neles não dispara
  a checagem de divergência.
- Diretório inexistente ou vazio: continua reprovando (comportamento conquistado antes,
  não pode regredir).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O validador MUST reprovar uma página cujo campo `area` do frontmatter
  diverge da área do diretório em que ela está, com exit ≠ 0.
- **FR-002**: A mensagem de reprovação MUST nomear o caminho do arquivo e as duas áreas
  em conflito, de modo que dê para corrigir sem abrir o validador.
- **FR-003**: O campo `area` MUST ser opcional; uma wiki plana continua válida.
- **FR-004**: O validador MUST manter a reprovação de diretório inexistente e de
  diretório sem páginas (anti-regressão).
- **FR-005**: Duas execuções seguidas do validador sobre a mesma wiki MUST produzir
  stdout, stderr e exit idênticos.
- **FR-006**: O esqueleto de áreas MUST ser versionado (sobreviver ao clone); o conteúdo
  novo do usuário dentro de uma área MUST continuar ignorado pelo git.
- **FR-007**: O `SCHEMA.md` MUST documentar o campo `area` — opcional, não cobrado se
  faltar, reprovado se divergir do diretório — antes de o validador o cobrar.
- **FR-008**: O conteúdo versionado MUST NOT conter assunto, área ou caminho pessoal da
  wiki privada de origem, nem identificador de ferramental de trabalho. A única área é a
  de exemplo, com nome neutro.
- **FR-009**: Nada da Fase 1 MUST ser reescrito em outra linguagem — `validar-wiki.sh` e
  `lib-anvilore.sh` continuam em bash.
- **FR-010** *(rodada 2, A9)*: Os diretórios reservados `wiki/_meta/` e `wiki/log/` — que
  o SCHEMA descreve como infra (índices gerados, log fatiado) — MUST aceitar markdown,
  com ou sem frontmatter, sem serem cobrados como página de wiki. O que o schema descreve
  o código não pode proibir.
- **FR-011** *(rodada 2, A10)*: Nenhuma página de wiki versionada MUST ficar fora do
  `wiki/index.md`; caso contrário a skill de consulta declara a wiki vazia enquanto ela
  não está. A página de exemplo é indexada na categoria correta.
- **FR-012** *(rodada 2, A11)*: Nenhuma afirmação do `README.md` sobre a estrutura que vem
  no clone MUST ser falsa. Corrige-se apenas o parágrafo que descrevia o esqueleto como
  plano; a reescrita do README é da Onda 5.

### Key Entities

- **Página**: arquivo markdown em `wiki/` com frontmatter (`type`, `slug`, e opcionalmente
  `area`). Já existia; ganha o campo opcional `area`.
- **Área**: diretório `wiki/<área>/` que agrupa páginas de um assunto, com os três tipos
  (`sources`, `entities`, `concepts`). `_meta/` e `log/` são reservados, não são áreas.
- **Campo `area`**: declara a que área a página pertence; validado contra o diretório.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Num clone limpo em Linux, o validador aprova a wiki que veio no clone,
  informa a dívida de conhecimento e sai com código 0.
- **SC-002**: Uma página em área errada é reprovada com mensagem que identifica o arquivo
  e a divergência, sem consultar o código do validador.
- **SC-003**: Uma wiki sem nenhuma área valida exatamente como antes desta tarefa.
- **SC-004**: Uma varredura do conteúdo versionado por termos pessoais e de ferramental
  volta vazia.

## Assumptions

- Alvo declarado: Linux. Nenhuma promessa de Windows ou macOS entra em código, teste ou
  documento.
- A estrutura de áreas é oferecida, nunca exigida: um repositório que nunca criar uma
  área não deve ver diferença nenhuma.
- Os sete scripts de manutenção, a skill de lint, os hooks, o instalador e a reescrita do
  README ficam fora desta tarefa (ondas seguintes).
- Migrar conteúdo está fora de escopo: o repositório carrega o método; o conteúdo é de
  quem usa e fica fora do git.
- Rebase da rodada 3: a entrega convive com o perfil de proveniência OKF já gateado na
  Fase 1. No `SCHEMA.md`, as seções "Áreas (opcional)" e "Perfil de proveniência
  (opcional)" são independentes e ambas opcionais; no `validar-wiki.sh`, a checagem de
  área (no laço) e a de proveniência (após o laço) não se cruzam. Nenhum requisito
  funcional desta spec muda com o rebase — só passam a ser verificados sobre o repositório
  inteiro, com as suítes `test-validar-okf.sh` e `test-resource-baseline.sh` também verdes.
