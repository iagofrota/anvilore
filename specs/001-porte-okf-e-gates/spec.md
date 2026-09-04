# Feature Specification: Perfil de proveniência OKF e régua de baseline versionado

**Feature Branch**: `aipe/j-20260904-14/alice`

**Created**: 2026-09-04

**Status**: Implemented

**Input**: Task-spec aprovado do coordenador em
`.aipe/journeys/j-20260904-14/task-specs/anvilore.md` — portar do `wiki-wonka`
(privado) para o `anvilore` (público, MIT) o perfil de proveniência opcional e o
harness que impede a checagem de `sources[].resource` de ser afrouxada em silêncio,
**sem trazer nenhum dado do vault pessoal**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Registrar a proveniência de uma página (Priority: P1)

Quem usa o `anvilore` quer poder anotar, no frontmatter, de onde uma página veio
(`sources`), quem a gerou (`generated`), quem a revisou (`verified`) e quando ela
vence (`stale_after`), e ter o validador conferindo a forma desses campos — sem que
o perfil seja obrigatório.

**Why this priority**: é o valor central da unidade; sem ele não há proveniência.

**Independent Test**: criar uma página com o perfil completo e rodar
`scripts/validar-wiki.sh`; depois validar uma página sem nenhum campo do perfil.

**Acceptance Scenarios**:

1. **Given** uma página com `sources`/`generated`/`verified`/`stale_after`
   bem-formados, **When** rodo o validador, **Then** `VALIDACAO: PASS` e exit 0. (A1)
2. **Given** uma página sem nenhum campo do perfil, **When** rodo o validador,
   **Then** `PASS` — a ausência nunca reprova. (A2)
3. **Given** uma página com um dos quatro campos malformado, **When** rodo o
   validador, **Then** exit 1 e a mensagem nomeia o **arquivo** e o **campo**. (A3)
4. **Given** uma página cujo `stale_after` já venceu, **When** rodo o validador,
   **Then** exit 0 e o vencimento reportado como métrica. (A5)

---

### User Story 2 — Classificar `sources[].resource` sem o espaço decidir (Priority: P1)

O validador precisa decidir, para cada `resource`, se há um caminho a checar. A
regra é fechada: esquema de URI → externo; barra ou extensão → caminho local que
tem de existir na raiz; resto → descritor de escopo. **Espaço em branco não entra
na decisão.**

**Why this priority**: é a regra que a régua protege; o espaço já a afrouxou uma vez.

**Independent Test**: exercitar caminho inexistente, descritor de escopo, caminho
com espaço que existe e caminho com espaço que não existe.

**Acceptance Scenarios**:

1. **Given** um `resource` com forma de caminho que não existe, **When** valido,
   **Then** reprova. (A4)
2. **Given** um descritor de escopo, **When** valido, **Then** não é checado. (A4)
3. **Given** um caminho com espaço que **existe** e outro que **não existe**,
   **When** valido, **Then** o espaço não altera a classificação: existe passa,
   inexistente reprova. (A4)

---

### User Story 3 — Régua que não pode virar carimbo (Priority: P1)

A checagem de `resource` não pode ser afrouxada em silêncio. Um baseline de
vereditos **versionado como dado** (não outra revisão do código) confronta o
validador em duas fases: regressão contra a tabela e canário de mutação.

**Why this priority**: é o que impede a regressão já ocorrida de voltar despercebida.

**Independent Test**: rodar o harness; depois quebrar o classificador de propósito
(em cópia, em memória) e conferir que o harness reprova.

**Acceptance Scenarios**:

1. **Given** o baseline versionado, **When** rodo o harness, **Then** a fase de
   regressão bate 100% da tabela e a fase de mutação acusa os canários. (A6)
2. **Given** o classificador quebrado de propósito, **When** rodo o harness,
   **Then** ele reprova nomeando os valores afrouxados. (A6)

---

### Edge Cases

- Caminho absoluto (`/etc/passwd`) ou que sobe acima da raiz (`../README.md`) →
  reprova por estar fora da raiz do repositório.
- URL com espaço (`https://example.com/a b.md`) → continua externa; o espaço saiu
  da regra.
- Typo de prefixo (`rw/`, `raws/`) → reprova, porque a forma do caminho decide e
  não uma lista de prefixos consultada.
- `verified` como mapping único **ou** como lista → ambos válidos.

## Requirements *(mandatory)*

- **FR-001**: O validador MUST reprovar somente campo OKF presente e malformado;
  MUST NOT reprovar por ausência.
- **FR-002**: Mensagens de FAIL MUST nomear o arquivo da página e o campo.
- **FR-003**: `sources[].resource` MUST ser classificado por esquema de URI, forma
  de caminho (barra/extensão) e descritor de escopo, nesta ordem; espaço em branco
  MUST NOT entrar na decisão.
- **FR-004**: Caminho local MUST existir dentro da raiz do repositório; caminho fora
  da raiz MUST reprovar.
- **FR-005**: `stale_after` vencido MUST ser métrica (exit 0), não falha.
- **FR-006**: O harness MUST rodar duas fases — regressão contra a tabela versionada
  (afrouxar **e** apertar reprovam) e canário de mutação que reinjeta o defeito do
  espaço em branco — e MUST reprovar um classificador afrouxado.
- **FR-007**: O port MUST usar identificadores em português, testes em `tests/` e a
  convenção `VALIDACAO: PASS|FAIL`; MUST NOT introduzir lista de áreas.
- **FR-008 (crítico)**: Nenhum dado pessoal do vault (nome próprio, título real de
  página, caminho de máquina, nome de área) MUST aparecer no diff; a tabela usa só
  valores sintéticos.
- **FR-009**: `tests/test-validar-wiki.sh` e `tests/test-lib-anvilore.sh` MUST NOT
  ser alterados.

## Success Criteria *(mandatory)*

- **SC-001**: As quatro suítes shell passam (as duas existentes intocadas).
- **SC-002**: `bash scripts/validar-wiki.sh wiki` → `VALIDACAO: PASS`, exit 0.
- **SC-003**: Harness: Fase 1 45/45; Fase 2 acusa os 4 canários; reprova cópia
  afrouxada.
- **SC-004**: Varredura de vazamento sobre o diff (piso + ampliada) limpa; 45
  valores da tabela lidos valor a valor, todos sintéticos.
