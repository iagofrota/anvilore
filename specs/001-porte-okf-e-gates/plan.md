# Implementation Plan: Perfil de proveniência OKF e régua de baseline versionado

**Branch**: `aipe/j-20260904-14/alice` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-porte-okf-e-gates/spec.md`

## Summary

Portar do `wiki-wonka` (insumo read-only entregue em scratchpad) para o `anvilore`
o perfil de proveniência opcional e o harness de baseline versionado, respeitando o
contrato do destino (identificadores em português, testes em `tests/`, convenção
`VALIDACAO:`, sem áreas) e sem vazar nenhum dado do vault pessoal. Abordagem
test-first (RED → GREEN) sobre a suíte shell existente.

## Technical Context

**Language/Version**: Bash + Python 3.12 (PyYAML 6.0.1 presente no host)

**Primary Dependencies**: `python3` + `yaml` (guardado por `command -v python3`);
`awk`, `find`, `grep`. Sem framework, sem build, sem runtime.

**Storage**: N/A — arquivos markdown em `wiki/`, evidência em `raw/`.

**Testing**: suíte shell em `tests/` (estilo `ok:`/`FALHA:` + `OK: <nome>`).

**Target Platform**: Linux, shell puro.

**Project Type**: CLI/kit de manutenção de wiki (sem frontend/backend).

**Constraints**: repositório **público** sob MIT — vazamento de conteúdo pessoal é
falha crítica acima de qualquer critério funcional. Validador offline (não resolve
rede). O perfil é opcional: ausência nunca reprova.

**Scale/Scope**: 1 validador OKF, 1 harness, 1 tabela (45 valores + 5 fixtures),
2 testes novos, 1 wiring no validador da wiki, 1 seção nova no SCHEMA.

## Constitution Check

- **Fronteira `raw/`↔`wiki/`↔`SCHEMA.md`** preservada: nenhuma página de `wiki/` ou
  `raw/` é alterada; `SCHEMA.md` ganha só a seção do perfil opcional. ✅
- **`.claude/` intocado.** ✅
- **Herança MIT do `wiki-wonka`**: método portado, conteúdo do vault fora — sem
  cópia de dados pessoais. ✅
- **Determinístico vira script**: a régua de classificação vive num só lugar
  (`classificar_recurso`) e é confrontada por dado versionado, não re-derivada. ✅

## Project Structure

### Documentation (this feature)

```text
specs/001-porte-okf-e-gates/
├── spec.md    # o quê e por quê (User Stories A1–A6, requisitos, critérios)
└── plan.md    # este arquivo — como
```

### Source Code (repository root)

```text
scripts/
├── validar-okf.py               # NOVO — validador dos campos OKF
├── validar-wiki.sh              # MOD — chama o validador OKF, mantém VALIDACAO:
├── resource-baseline.tsv        # NOVO — baseline versionado (45 valores sintéticos)
└── resource-baseline-check.py   # NOVO — harness de duas fases
tests/
├── test-validar-okf.sh          # NOVO — A1–A5
├── test-resource-baseline.sh    # NOVO — A6
├── test-validar-wiki.sh         # INTOCADO (A8)
└── test-lib-anvilore.sh         # INTOCADO (A8)
SCHEMA.md                        # MOD — documenta o perfil OKF opcional
```

## Phased approach

### Phase 0 — Estudo do insumo
Ler os sete fontes, o SCHEMA de origem e mapear os três pontos de vazamento medidos
(`resource-baseline.tsv:55`, `lib-wiki.sh:5`, `wiki-gaps.py:15`). Decidir a régua de
tradução (nomes em inglês → português; `WIKI_AREAS` não vai; testes vão para `tests/`).

### Phase 1 — Tests (RED)
Escrever `tests/test-validar-okf.sh` (A1–A5, wiki plana, atores sintéticos) e
`tests/test-resource-baseline.sh` (A6, incluindo quebrar o classificador de propósito
numa cópia em disco). Confirmar que falham.

### Phase 2 — Port (GREEN)
`validar-okf.py` (regra de classificação preservada, identificadores em português),
`resource-baseline.tsv` (linha 55 substituída por valor sintético; cabeçalho apontando
para `validar-okf.py`/`SCHEMA.md`), `resource-baseline-check.py` (atributos casando com
o validador em português), wiring em `validar-wiki.sh`, seção no `SCHEMA.md`.

### Phase 3 — Verificação
Suíte completa; `validar-wiki.sh wiki` (A2); varredura de vazamento (piso + ampliada,
tabela valor a valor); `shellcheck` + `py_compile`. Commit, push, PR.

## Anti-regression

- Defeito do espaço em branco decidindo antes da forma do caminho → canário de mutação
  no harness + casos de caminho com espaço em A4.
- Lista de prefixos como regra consultada → casos de typo de prefixo (`rw/`, `raws/`)
  reprovam por forma, não por lista.

## Risks

- **PyYAML ausente** faria o wiring OKF quebrar suítes existentes — mitigado pelo
  guard `command -v python3` e confirmado presente no host.
- **Vazamento fora do piso de palavras** — mitigado por leitura valor a valor da
  tabela e varredura ampliada (atores, emails, caminhos de máquina).
