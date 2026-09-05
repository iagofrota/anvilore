# Implementation Plan: Áreas temáticas na wiki

**Branch**: `areas-tematicas-na-wiki` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/areas-tematicas-na-wiki/spec.md`

## Summary

Ensinar áreas temáticas ao validador, ao schema e ao esqueleto da wiki, sem trocar o
runtime de nada. A derivação da área a partir do diretório vira uma função determinística
e testada na lib; o validador cobra a coerência entre `area` do frontmatter e o diretório;
o `.gitignore` versiona o esqueleto e mantém o conteúdo do usuário de fora. Test-first,
tudo em bash.

## Technical Context

**Language/Version**: Bash (POSIX + extensões bash já usadas na Fase 1). Nada de Python
nesta tarefa — a Fase 1 não muda de runtime.

**Primary Dependencies**: coreutils (`find`, `grep`, `awk`, `sort`, `head`, `basename`),
`git` (para a fronteira do `.gitignore`).

**Storage**: arquivos markdown em `wiki/`; sem banco.

**Testing**: scripts de teste em shell (`tests/*.sh`), no mesmo padrão da Fase 1
(`test-lib-anvilore.sh`, `test-validar-wiki.sh`). Novo `test-esqueleto.sh` para a
fronteira do git. `shellcheck` nos scripts.

**Target Platform**: Linux.

**Project Type**: kit de linha de comando (shell + markdown), sem build, sem runtime,
sem framework.

**Performance Goals**: N/A — validação de dezenas a centenas de páginas markdown.

**Constraints**: saída determinística (byte-idêntica entre execuções); a wiki plana
continua válida; anti-regressão de diretório inexistente/vazio; nenhum conteúdo pessoal
ou identificador de ferramental no versionado.

**Scale/Scope**: uma wiki pessoal por repositório; uma área de exemplo neutra no kit.

## Constitution Check

Não há `constitution.md` neste repositório. Os princípios que valem como gate vêm do
`AGENTS.md` (fronteira `raw/`↔`wiki/`↔`SCHEMA.md`) e das restrições da spec:

- Não escrever em `raw/`. → Esta tarefa não toca `raw/`. ✅
- Contrato antes do código: campo cobrado pelo validador precisa estar no `SCHEMA.md`. →
  `SCHEMA.md` documenta `area` (FR-007). ✅
- Não regredir o conquistado. → Testes de diretório inexistente/vazio preservados (FR-004),
  e a fronteira do `.gitignore` conferida por teste (FR-006). ✅
- Sem troca de runtime na Fase 1. → Tudo bash (FR-009). ✅

## Project Structure

### Documentation (this feature)

```text
specs/areas-tematicas-na-wiki/
├── plan.md              # Este arquivo
└── spec.md              # Especificação da feature
```

### Source Code (repository root)

```text
scripts/
├── lib-anvilore.sh      # + area_do_diretorio (derivação determinística da área)
└── validar-wiki.sh      # + checagem de divergência area(frontmatter) × diretório

tests/
├── test-lib-anvilore.sh # + casos de area_do_diretorio
├── test-validar-wiki.sh # + área coerente, divergência, wiki plana, determinismo, wiki do repo
└── test-esqueleto.sh    # NOVO: esqueleto versionado + conteúdo do usuário ignorado

wiki/
├── index.md, log.md     # já existiam
├── _meta/.gitkeep       # reservado (índices gerados) — não é área
├── log/.gitkeep         # reservado (log fatiado) — não é área
└── exemplo/             # única área de exemplo, nome neutro
    ├── sources/.gitkeep
    ├── entities/.gitkeep
    └── concepts/
        ├── .gitkeep
        └── area-tematica.md   # página de exemplo (area: exemplo)

SCHEMA.md                # + seção "Áreas (opcional)"
.gitignore               # versiona o esqueleto; ignora conteúdo novo do usuário
```

**Structure Decision**: A tarefa cresce as peças existentes da Fase 1 no lugar em que
já vivem, sem introduzir novas camadas. A única função nova (`area_do_diretorio`) mora
na lib porque é determinística e testável isoladamente — o determinístico vira função
testada, não inferência repetida no validador.

### Build order (test-first)

1. **RED** — testes de `area_do_diretorio` (lib), dos casos de área/determinismo/wiki do
   repo (validador) e do esqueleto/`.gitignore` (novo). Rodar e confirmar que falham.
2. **GREEN** — `area_do_diretorio` na lib; checagem de divergência no validador; seção de
   áreas no `SCHEMA.md`; diretórios do esqueleto + `.gitkeep` + página de exemplo;
   `.gitignore` com a fronteira "esqueleto entra, conteúdo do usuário fica fora".
3. **Verify** — suíte verde; validador exercitado à mão para cada critério de aceite
   (A1–A8); clone raso para a fronteira do git; `shellcheck`; varredura dos blobs por
   conteúdo pessoal e ferramental.

## Rodada 2 — correções após o primeiro gate

O gate independente aprovou os oito critérios originais, a varredura de conteúdo pessoal
e a autoria, e reprovou por seis achados. O PE emendou o task-spec (agora A1–A11). As
correções, cada uma com o teste que a defende:

1. **A9 — reservados isentos das checagens de página.** `em_dir_reservado` na lib
   (determinística, testada); o validador pula `_meta/` e `log/` antes de cobrar
   frontmatter/type/slug. Antes, um markdown nesses diretórios reprovava — o código
   proibia a estrutura que o SCHEMA descreve, e era armadilha para a Onda 2.
2. **A10 — página versionada dentro do índice.** A página de exemplo entrou no
   `wiki/index.md`, na categoria correta. Teste: toda página de wiki versionada (fora
   index/log e dos reservados) aparece no índice.
3. **A11 — README honesto.** Corrigido só o parágrafo que descrevia o clone como plano;
   a tabela dos níveis e o resto do README ficam para a Onda 5. Teste: o README não
   afirma clone plano e menciona o esqueleto de áreas.
4. **Comentário enganoso** em `lib-anvilore.sh` (ramo `*/*)` do case) corrigido.
5. **Asserção que não podia falhar:** `git check-ignore` nunca reporta arquivo rastreado
   como ignorado. Trocado por `git ls-files --error-unmatch` na página de exemplo — o
   mesmo instrumento já usado para os `.gitkeep`.
6. **Nome do diretório e cabeçalhos diziam "python"** num repositório público enquanto o
   plano afirma o contrário. Diretório renomeado para `areas-tematicas-na-wiki` e
   cabeçalhos corrigidos. O identificador no ledger permanece (é a chave do pareamento
   com o veredito do gate).

## Complexity Tracking

Sem violações a justificar. A tarefa não adiciona projeto, dependência nem abstração —
cresce bash em bash e markdown em markdown.
