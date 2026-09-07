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
já vivem, sem introduzir novas camadas. As funções novas moram na lib porque são
determinísticas e testáveis isoladamente — o determinístico vira função testada, não
inferência repetida no validador. Além de `area_do_diretorio`, a rodada 2 acrescentou
`em_dir_reservado` e a rodada 3 extraiu `nome_reservado`, o **dono único** da lista de
diretórios reservados (`_meta`, `log`): o literal `_meta|log` mora só nela, e
`area_do_diretorio`, `em_dir_reservado` e o teste de esqueleto delegam a essa função em
vez de repetir a lista.

### Build order (test-first)

1. **RED** — testes de `area_do_diretorio` (lib), dos casos de área/determinismo/wiki do
   repo (validador) e do esqueleto/`.gitignore` (novo). Rodar e confirmar que falham.
2. **GREEN** — `area_do_diretorio` na lib; checagem de divergência no validador; seção de
   áreas no `SCHEMA.md`; diretórios do esqueleto + `.gitkeep` + página de exemplo;
   `.gitignore` com a fronteira "esqueleto entra, conteúdo do usuário fica fora".
3. **Verify** — suíte verde; validador exercitado à mão para cada critério de aceite
   (A1–A14); clone raso para a fronteira do git; `shellcheck`; varredura dos blobs por
   conteúdo pessoal e ferramental, incluindo os metadados de identidade dos commits.

## Rodada 2 — correções após o primeiro gate

O gate independente aprovou os oito critérios originais, a varredura de conteúdo pessoal
e a autoria, e reprovou por seis achados. O PE emendou o task-spec (à época, onze
critérios). As correções, cada uma com o teste que a defende:

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

## Rodada 3 — rebase sobre a main remota

Na rodada 2 o gate confirmou os onze critérios e as seis correções (com prova de
mutação): o mérito ficou aprovado. A reprovação foi de integração, não de conteúdo. A
branch nasceu de uma cópia local da main que estava cinco commits atrás da remota, e a
remota já entregava o porte OKF da Fase 1 (perfil de proveniência e a régua de baseline
versionado). A entrega precisava, então, ser rebaseada e reconfirmada sobre o repositório
inteiro — não sobre o menor que a branch enxergava.

O que a rodada 3 fez, sem refazer o mérito:

1. **Rebase sobre `origin/main`.** Quatro arquivos eram tocados pelos dois lados;
   `.gitignore`, `README.md` e `validar-wiki.sh` auto-mesclaram (regiões distintas). Só o
   `SCHEMA.md` conflitou, e a resolução **mantém os dois lados**: a seção "Perfil de
   proveniência (opcional)" da Fase 1 (que sustenta a régua OKF e não pode sumir) e a
   seção "Áreas (opcional)" desta tarefa (que sustenta A8). Tomar um lado só apagaria uma
   entrega gateada.
2. **Suíte reconfirmada sobre a árvore rebaseada.** As cinco suítes — as três desta
   tarefa mais `test-validar-okf.sh` e `test-resource-baseline.sh`, que a branch não tinha
   — passam verdes. No validador rebaseado, as checagens de área desta tarefa (dentro do
   laço) convivem com o bloco de proveniência OKF (após o laço), e A9 continua valendo: um
   markdown comum em `_meta/` e `log/` aprova mesmo com o validador OKF encadeado.
3. **A11 reconferido sobre o README novo.** A main acrescentou uma nota sobre PyYAML no
   começo rápido; ela e o parágrafo de níveis corrigido na rodada 2 convivem em regiões
   distintas do arquivo, e nenhuma afirmação sobre o clone ficou falsa. O limite se
   mantém: só aquele parágrafo; a reescrita é da Onda 5.
4. **Dois achados menores do gate.** (a) A lista de diretórios reservados aparecia como
   literal em três pontos (`area_do_diretorio`, `em_dir_reservado`, o teste de esqueleto);
   virou o dono único `nome_reservado`, com teste próprio. (b) O passo Verify citava uma
   faixa de critérios menor (parava em A8) do que a lista que o próprio documento descrevia
   logo abaixo (ia até A11) — corrigido, e a spec e o plano atualizados para a rodada 3.

O merge em si não é desta entrega: a autoridade é do PE, e o nome da branch exige
mensagem de merge escrita à mão.

## Rodada 4 — correções após o terceiro gate

O terceiro gate passou doze dos catorze critérios (o task-spec cresceu para A1–A14) e
reprovou por dois achados importantes e três menores. Cada correção com o teste que a
defende:

1. **A3 (layout das skills) — o validador reprovava a wiki plana que as próprias skills
   criam.** `area_do_diretorio` tomava o primeiro segmento do caminho como área; no layout
   `wiki/sources/`, `wiki/concepts/`, `wiki/entities/` (o que `ingest` e `query` produzem)
   esse segmento é um **tipo**, não uma área, e uma página com `area` preenchido reprovava
   nomeando uma área inexistente. Novo dono único `nome_tipo_diretorio` na lib (irmão de
   `nome_reservado`); `area_do_diretorio` delega a ele e devolve vazio nesse layout. O
   `SCHEMA.md` passa a descrever o layout de tipos como a forma plana — antes dizia só
   "páginas soltas em `wiki/`". Teste: layout das skills valida com e sem `area`, exit 0.
2. **A7 (visibilidade) — o ripgrep escondia o esqueleto que o git rastreia.** Uma regra
   `wiki/*` na raiz fazia o `ignore` crate do ripgrep parar de descer nos diretórios-neto
   da wiki, e `rg --files wiki/` não listava a página de exemplo versionada (git a
   rastreava). A fronteira migrou para um `wiki/.gitignore` ancorado, com `*` e reinclusões
   relativas, respeitado igual por git e por ripgrep. Teste: `rg --files wiki/` sem
   `--no-ignore` lista `wiki/exemplo/concepts/area-tematica.md`.
3. **A14 — o passo Verify citava uma faixa menor do que o task-spec, que hoje vai a A14.**
   O passo Verify passa a cobrir toda a faixa (A1–A14); as menções históricas às faixas
   anteriores foram reescritas em palavras para não se confundirem com a faixa corrente.
4. **Identidade dos commits (author E committer o PE).** Os quatro commits da branch tinham
   author = PE mas committer = identificador de ferramental. A rodada reescreve os commits
   localmente para que author e committer sejam ambos o PE. O **push forçado é do PE** — o
   classificador o bloqueia nesta sessão, e é assim que deve ser; a especialista entrega a
   história reescrita localmente.
5. **Nome da branch remota.** Carrega o identificador de jornada, que a mensagem de merge
   padrão carimbaria na `main`. É mitigação do PE no merge (mensagem escrita à mão); a
   especialista apenas registra.

## Complexity Tracking

Sem violações a justificar. A tarefa não adiciona projeto, dependência nem abstração —
cresce bash em bash e markdown em markdown.
