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
| Validador da wiki (`anvilore validar`) | Reprova página sem frontmatter ou com frontmatter que não lê (YAML inválido nunca é pulado), com `type` inválido, com `slug` diferente do nome do arquivo (comparado em Unicode NFC), com `area` em conflito com o diretório, dois arquivos da mesma pasta que só diferem na caixa, wikilink que não resolve, página fora do index.md aplicável e campo de proveniência malformado. Reprova wiki inexistente e diretório sem nenhum arquivo `.md`; uma wiki só com index.md e log.md passa. Sem o Bun o comando não roda, e nunca imprime PASS. | `src/comandos/validar.ts`, linhas 100 a 244 |
| Portão humano, depois da escrita | Reprova a página com `generated` em mapping e sem uma entrada `verified` com `by: human:<id>` e `at` igual ou posterior a `generated.at`. A mensagem é "página gerada sem aprovação humana". | `src/lib/okf.ts`, linhas 148 a 194 |
| Perfil da empresa | Um anvilore.toml na raiz do projeto restringe áreas, tipos de página e campos obrigatórios; reprova nomeando arquivo e valor. Arquivo ilegível, chave desconhecida ou valor que não é lista de textos também reprova. | `src/lib/perfil.ts`, linhas 28 a 54; `src/comandos/validar.ts`, linhas 189 a 191 e 204 a 212 |
| Tipos e cobertura | `tsc --noEmit` e testes com cobertura mínima de 80% no geral. | `package.json` (script `checar`); `bunfig.toml`, linha 2 |
| Checagem de links | Reprova link e menção a arquivo inexistente nesta pasta. | `src/comandos/checar-docs.ts` |
| Trava de release | Reprova versão sem seção no CHANGELOG, seção vazia, pasta desta KB ausente ou sem página, ou página sem `verified`. | `src/comandos/checar-release.ts` |
| CI (configurado, ainda não executado) | Está configurado para rodar `bun run checar` e `checar-docs` em Linux, Windows e macOS a cada push e pull request, e `checar-release` em tag. A primeira execução ainda não aconteceu: a confirmar. | `.github/workflows/ci.yml` |

O `hooks/proteger-raw.sh` falha fechado: se não consegue ler o caminho no payload, a decisão passa
a ser sobre o texto inteiro, e "não achei caminho" nunca vira "pode passar" (linhas 115 a 127). O
validador também não imprime PASS quando o diretório não existe (`src/comandos/validar.ts`, linhas
104 a 107) nem quando um arquivo, o anvilore.toml ou o YAML do frontmatter não lê: cada um vira um
erro que nomeia o arquivo.

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

### 2. O portão humano só vale para a página que declara `generated`

- O aval **antes** da escrita ("o primeiro subagente lê e não escreve; o segundo só escreve depois
  do aval da pessoa") continua sendo texto, em `skills/ingest/SKILL.md`, linhas 20, 32 a 38 e 79 a
  96. Nenhum script confere que ele aconteceu.
- O aval **depois** da escrita é imposto (tabela acima), mas só para a página que traz o bloco
  `generated`. Uma página sem esse bloco é tratada como escrita à mão e não é barrada. Hoje a skill
  `ingest` ainda não manda gravar o `generated` (a busca por `generated` em `skills/` não retorna
  nada); sem isso, o portão não pega a página que o agente escreve sem declará-lo.
- Nenhum programa prova quem escreveu `verified`. Um agente que grave `verified` com
  `by: human:<id>` por conta própria viola o contrato (`AGENTS.md`, seção "O que você não faz") e o
  validador não o detecta.
- Não confunda os dois formatos: o `verified: AAAA-MM-DD` escalar desta pasta é do projeto e é lido
  por `checar-release`; o `verified` em mapping (`by`, `at`) é o da wiki de quem usa, lido pelo
  validador da wiki. Eles não se unificam.
- A mesma coisa vale para "não resolver contradição por conta própria" no `AGENTS.md`: é contrato
  em prosa.

### 3. A navegação é conferida com limites

- O validador reprova wikilink quebrado e página fora do índice (`src/comandos/validar.ts`, linhas
  220 a 240). A regra foi portada de `scripts/auditar-wiki.py` (linhas 151 a 164), que continua
  existindo como relatório e é chamado pela skill de lint (`skills/lint/SKILL.md`, linhas 27 a 37).
- A página da wiki plana é conferida contra o `wiki/index.md`; a de uma área, contra o
  `wiki/<área>/index.md` se ele existir e, se não, contra o `wiki/index.md`. Wiki sem nenhum
  index.md aplicável passa, mas o validador imprime o aviso "sem index.md: conferência do índice
  não feita".
- O alvo do wikilink é só o slug (`[[slug]]`, `[[slug|rótulo]]`, `[[slug#seção]]`). Link com
  caminho, como [[sources/x]], e embed de imagem, como ![[imagem.png]], reprovam como quebrados,
  mesmo que o arquivo exista (é o que `scripts/auditar-wiki.py` faz). Link markdown e wikilink
  dentro de bloco de código, código em linha ou comentário HTML não são conferidos.
- O index.md, o log.md e os diretórios reservados não são cobrados de `type`, `slug`, área nem
  índice, mas o YAML e a proveniência deles são conferidos (YAML que não lê reprova, nomeando o
  arquivo), como fazia o validador antigo. O portão humano só vale para página de conteúdo.

### 4. O perfil da empresa vale para o estado atual

- Mudar o anvilore.toml reprova as páginas antigas que o novo perfil deixa de aceitar; o
  validador não guarda histórico nem tolera páginas "anteriores ao perfil". Quem muda o perfil
  decide se corrige as páginas ou afrouxa a regra.
- Só o anvilore.toml na pasta que contém a wiki vale. Um arquivo em outro lugar é ignorado.

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
