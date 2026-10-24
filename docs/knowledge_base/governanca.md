---
generated: 2026-10-24
---

# Governança: padrões, guardrails e o que ainda não é imposto

Esta página separa três coisas: o que o código **impõe** (reprova ou bloqueia), o que está
**só escrito** (texto de contrato ou de skill, que depende de o agente cumprir) e o que o Anvilore
**não resolve**. As linhas citadas valem para o estado do repositório na data de `generated`; se o
arquivo mudar, confira a linha de novo.

Decisão do dono do projeto em 2026-10-23: esta versão prioriza padrões e guardrails. Vazamento
fica para depois (veja a última seção).

## O que o código impõe hoje

| Trava | O que faz | Onde |
|---|---|---|
| Hook `proteger-raw` | Bloqueia (saída 2) a escrita em `raw/` feita pelas ferramentas de edição de arquivo. Sem caminho isolável no payload, bloqueia se o texto citar `raw/`. | `hooks/proteger-raw.sh`, linhas 27 a 32 e 115 a 127; `hooks/hooks.json`, linha 6 |
| Validador da wiki | Reprova página sem frontmatter, com `type` inválido, com `slug` diferente do nome do arquivo ou com `area` em conflito com o diretório. Reprova wiki inexistente e diretório sem nenhum arquivo `.md`; uma wiki só com index.md e log.md passa. | `scripts/validar-wiki.sh`, linhas 14 a 18, 33 a 55 e 63 a 67 |
| Tipos e cobertura | `tsc --noEmit` e testes com cobertura mínima de 80% no geral. | `package.json` (script `checar`); `bunfig.toml`, linha 2 |
| Checagem de links | Reprova link e menção a arquivo inexistente nesta pasta. | `src/comandos/checar-docs.ts` |
| Trava de release | Reprova versão sem seção no CHANGELOG, seção vazia, pasta desta KB ausente ou sem página, ou página sem `verified`. | `src/comandos/checar-release.ts` |
| CI (configurado, ainda não executado) | Está configurado para rodar `bun run checar` e `checar-docs` em Linux, Windows e macOS a cada push e pull request, e `checar-release` em tag. A primeira execução ainda não aconteceu: a confirmar. | `.github/workflows/ci.yml` |

O `hooks/proteger-raw.sh` falha fechado: se não consegue ler o caminho no payload, a decisão passa
a ser sobre o texto inteiro, e "não achei caminho" nunca vira "pode passar" (linhas 115 a 127). O
validador também não imprime PASS quando o diretório não existe (linhas 14 a 18).

## O que hoje não é imposto

Cada item abaixo foi conferido no código. Onde a conferência foi uma busca que não achou nada, isso
está dito.

### 1. O hook cobre só as ferramentas de edição

- O Claude Code liga o hook só para `Write|Edit|NotebookEdit` (`hooks/hooks.json`, linha 6). Escrita
  feita por **comando de terminal** não passa pelo hook e não é barrada.
- Os outros agentes seguem o mesmo desenho: o Codex usa o matcher `apply_patch|Edit|Write` e o
  Gemini usa `write_file|replace` (`hooks/README.md`, linhas 81 a 84; `instalar.sh`, linhas 374 e
  418). Nenhum matcher cita ferramenta de terminal.
- O evento do Copilot não tem `matcher` e roda em toda chamada de ferramenta (`hooks/README.md`,
  trecho "Este evento não tem `matcher`"; `instalar.sh`, linha 453). Pelo código, um comando de
  terminal que chegue ao hook cairia na checagem do texto inteiro (`hooks/proteger-raw.sh`, linhas
  124 a 126). Isso é leitura do código: o Copilot nunca foi executado (`hooks/README.md`, final).
- A comparação de caminho do hook é sensível à caixa (`hooks/proteger-raw.sh`, linha 29), e o
  próprio script declara que o alvo é Linux (linha 19).
- Três textos dizem "recusa qualquer escrita em `raw/`": o `README.md` (seção "Os quatro níveis"),
  o cabeçalho de `hooks/proteger-raw.sh` (linha 2) e a descrição em `hooks/hooks.json` (linha 5).
  Leia como "qualquer escrita por ferramenta de edição". O `CHANGELOG.md` (seção "Não resolvido
  nesta versão") já diz o alcance certo.

### 2. O portão humano da ingestão é só texto

- A regra "o primeiro subagente lê e não escreve; o segundo só escreve depois do aval da pessoa"
  está em `skills/ingest/SKILL.md`, linhas 20, 32 a 38 e 79 a 96.
- Nenhum script, hook ou teste confere que o aval aconteceu. A busca por "aval" e "portão" em
  `scripts/`, `hooks/` e `src/` não retorna nada. Quem cumpre a regra é o agente.
- A mesma coisa vale para "não resolver contradição por conta própria" no `AGENTS.md`: é contrato
  em prosa.

### 3. O validador não olha a navegação

- `scripts/validar-wiki.sh` confere frontmatter, `type`, `slug` e `area` (linhas 33 a 55) e conta
  `gap` e `contradiction` como dívida, sem reprovar (linhas 57, 58 e 69).
- Ele **não reprova wikilink quebrado nem página fora do índice**. A busca por `[[` e por índice em
  `scripts/validar-wiki.sh` e `scripts/validar-okf.py` não retorna nada além do nome index.md, que é
  pulado (linha 25).
- Quem sinaliza isso é outro script, `scripts/auditar-wiki.py` (páginas fora do índice e wikilinks
  quebrados, linhas 151 a 164). Ele é chamado pela skill de lint (`skills/lint/SKILL.md`, linhas
  27 a 37), não pelo validador, e nada o roda automaticamente.

### 4. O perfil de proveniência pode ser pulado

- Se `python3` não existe, o validador não checa o perfil e não avisa (`scripts/validar-wiki.sh`,
  linhas 72 a 78). Se existe `python3` mas não PyYAML, o validador OKF emite uma linha `SKIP:` e
  sai com 0 (`scripts/validar-okf.py`, linhas 244 a 247), e o validador da wiki repete a linha na
  saída e segue (`scripts/validar-wiki.sh`, linha 84).
- O porte para TypeScript existe para acabar com esse pulo: o Bun lê YAML sozinho. Enquanto o
  validador novo não substitui o antigo, a limitação vale.

### 5. A regra "afirmar só o que dá para apontar" é prosa

- Está no `AGENTS.md`. Esta pasta a aplica com `checar-docs`, que confere que o arquivo citado
  existe, mas não confere que ele diz o que a página afirma. Isso é trabalho da revisão por pessoa
  (`verified`).

### 6. Cobertura de 95% em lógica crítica ainda não é imposta

- O limite que roda é de 80% no geral (`bunfig.toml`, linha 2). A meta de 95% para validação e
  proteção de `raw/` é uma meta declarada (decisão do dono do projeto em 2026-10-23) para esta
  versão; nenhum arquivo do repositório a registra e não há mecanismo por arquivo que a imponha
  hoje.

## O que o Anvilore não resolve: vazamento

**O Anvilore não protege contra vazamento de documentos internos.** O `CHANGELOG.md` diz o mesmo
na seção "Não resolvido nesta versão".

- Nada no repositório impede que o agente copie o conteúdo de `raw/` ou de `wiki/` para um serviço
  externo, para outra ferramenta ou para uma resposta. A busca por termos como segredo, sigilo,
  confidencial e sanitização em `scripts/`, `hooks/`, `src/`, `skills/` e `instalar.sh` não
  retorna nada.
- Nada varre o conteúdo à procura de dados sensíveis antes ou depois da ingestão.
- O que existe é higiene, e não proteção: o `.gitignore` deixa as fontes de `raw/` fora do git por
  padrão (`.gitignore`, linhas 1 a 6), e as páginas de quem usa ficam de fora pelo `wiki/.gitignore`,
  que ignora tudo e reabre só o esqueleto versionado. O `README.md` diz que o conteúdo não sai da
  máquina a menos que a pessoa publique. Isso não impede o agente de enviar o conteúdo a outro
  lugar.
- Não use o Anvilore, nesta versão, como garantia de sigilo. Para uso em empresa, a decisão sobre
  o que pode ser ingerido continua sendo da pessoa e da política da empresa.

## Se alguém perguntar "o raw está protegido?"

Resposta honesta: contra edição pelas ferramentas de edição do agente, sim, no Linux, para o
Claude Code testado de ponta a ponta. Contra escrita por terminal, não. Contra cópia ou vazamento
do conteúdo, não.
