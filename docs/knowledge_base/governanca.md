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
| Hook `proteger-raw` | Bloqueia (saída 2) a escrita em `raw/` feita pelas ferramentas de edição de arquivo e por comando de terminal (limites na seção abaixo). Sem caminho isolável no payload, bloqueia se o texto citar `raw/`; JSON ilegível bloqueia sempre. | `src/comandos/hook-proteger-raw.ts`, linhas 285 a 308; `hooks/hooks.json`, linha 6 |
| Validador da wiki (`anvilore validar`) | Reprova página sem frontmatter ou com frontmatter que não lê (YAML inválido nunca é pulado), com `type` inválido, com `slug` diferente do nome do arquivo (comparado em Unicode NFC), com `area` em conflito com o diretório, dois arquivos da mesma pasta que só diferem na caixa, wikilink que não resolve, página fora do index.md aplicável e campo de proveniência malformado. Reprova wiki inexistente e diretório sem nenhum arquivo `.md`; uma wiki só com index.md e log.md passa. Sem o Bun o comando não roda, e nunca imprime PASS. | `src/comandos/validar.ts`, linhas 100 a 244 |
| Portão humano, depois da escrita | Reprova a página com `generated` em mapping e sem uma entrada `verified` com `by: human:<id>` e `at` igual ou posterior a `generated.at`. A mensagem é "página gerada sem aprovação humana". | `src/lib/okf.ts`, linhas 148 a 194 |
| Perfil da empresa | Um anvilore.toml na raiz do projeto restringe áreas, tipos de página e campos obrigatórios; reprova nomeando arquivo e valor. Arquivo ilegível, chave desconhecida ou valor que não é lista de textos também reprova. | `src/lib/perfil.ts`, linhas 28 a 54; `src/comandos/validar.ts`, linhas 189 a 191 e 204 a 212 |
| Relatório das travas (`anvilore doctor`) | Lê os arquivos do clone e diz, em linguagem simples, se a proteção do `raw/` está ligada em cada agente presente (CLI no PATH ou pasta de configuração no clone; agente ausente é opcional) (a mesma configuração que o instalador escreve; hook antigo conta como desligado), se o fechamento chama o validador e se há CI ou pré-commit com a checagem. Pré-requisitos `bun` e `git` no PATH. Sai 1 se faltar trava ou pré-requisito; perfil ausente é opcional. Não conta quantas vezes algo foi barrado e não executa agente. | `src/comandos/doctor.ts` |
| Instalador | Funde JSON sem trocar escalares divergentes e mantém um bloco delimitado no TOML. Conflito ou JSON inválido nomeia o arquivo, preserva seus bytes e sai com 4 ao fim, depois de processar os demais agentes; uso ou destino inválido sai com 1. Simulação não escreve, e reinstalação sem mudanças devolve INALTERADO. O relatório inclui instalados, ausentes, avisos e causas das falhas de link; agente com link que falhou não é contado como instalado. Nunca copia uma skill como alternativa ao link. Arquivos soltos e pastas ocultas em skills são ignorados. | `src/comandos/instalar.ts`, `src/lib/fundir-json.ts`, `src/lib/fundir-bloco.ts`; cenários em `tests/instalar.test.ts` |
| Tipos e cobertura | `tsc --noEmit` e testes com cobertura mínima de 80% no geral. | `package.json` (script `checar`); `bunfig.toml`, linha 2 |
| Checagem de links | Reprova link e menção a arquivo inexistente nesta pasta. | `src/comandos/checar-docs.ts` |
| Trava de release | Reprova versão sem seção no CHANGELOG, seção vazia, pasta desta KB ausente ou sem página, ou página sem `verified`. | `src/comandos/checar-release.ts` |
| CI (configurado, ainda não executado) | Está configurado para rodar `bun run checar` e `checar-docs` em Linux, Windows e macOS a cada push e pull request, e `checar-release` em tag. A primeira execução ainda não aconteceu: a confirmar. | `.github/workflows/ci.yml` |

O hook falha fechado: se não consegue ler o caminho no payload, a decisão passa
a ser sobre o texto inteiro, e "não achei caminho" nunca vira "pode passar"
(`src/comandos/hook-proteger-raw.ts`, linhas 302 a 304). O
validador também não imprime PASS quando o diretório não existe (`src/comandos/validar.ts`, linhas
104 a 107) nem quando um arquivo, o anvilore.toml ou o YAML do frontmatter não lê: cada um vira um
erro que nomeia o arquivo.

## O que hoje não é imposto

Cada item abaixo foi conferido no código. Onde a conferência foi uma busca que não achou nada, isso
está dito.

### 1. O hook cobre o terminal só pelo texto do comando

- O hook é o subcomando `anvilore hook proteger-raw` (`src/comandos/hook-proteger-raw.ts`). O Claude
  Code o liga para `Write|Edit|NotebookEdit|Bash` (`hooks/hooks.json`, linha 6); o Codex usa
  `apply_patch|Edit|Write|Bash` e o Gemini `write_file|replace|run_shell_command`
  (`src/comandos/instalar.ts`, função `configuracaoDoHook`, linha 108). O evento do Copilot não tem
  `matcher` e roda em toda chamada de ferramenta. A forma instalada fecha quando o comando falha
  (`src/comandos/instalar.ts`, linhas 99 a 104): `|| exit 2` no Claude, Codex, Gemini e no campo `bash` do Copilot;
  campo `powershell` no Copilot; `shell: "bash"` e `onFailure: "block"` no Claude. O que isso garante em cada
  sistema, e o que o CI prova, está em [plataformas.md](plataformas.md).
- Para o terminal, o hook lê o comando (`src/comandos/hook-proteger-raw.ts`, `segmentoEscreve` e
  `terminalEscreve`, linhas 171 a 268). Bloqueia redirecionamento `>`/`>>`, `tee`, `mv`, `cp` com destino em
  `raw/`, `rm`, `rmdir`, `sed -i` (e `sed` com comando `w`/`e`), `perl` com qualquer script, `truncate`,
  `touch`, `ln`, `chmod`, `find -delete`/`-exec`, `git` com qualquer subcomando que não seja de leitura
  (`log`, `show`, `diff`, `status`, `blame`, `grep`, `ls-files`, `ls-tree`, `rev-parse`, `cat-file`, `describe`,
  `shortlog`, `reflog`, `rev-list`, `add`, `commit`, `branch`, `tag`) e os equivalentes de PowerShell. Leitura
  (`cat`, `rg`, `ls`, `head`, `wc`, `Get-Content`) passa. Verbo desconhecido que cita `raw/` é bloqueado. `cd raw`
  (com ou sem opção, `cd -` e `popd`) torna relativos os caminhos seguintes. Um segmento de pipe que age sobre o
  que o anterior listou de `raw/` (`find raw | xargs rm`, `ls raw | parallel rm`, `| sh`) bloqueia. `env`, `sudo`,
  `nice`, `time`, `xargs` e semelhantes são abertos para ver o comando de dentro.
- **Escopo ampliado (R64):** também sem citar `raw/`, bloqueia `git clean` com `-x`/`-X`, e `rm -r`,
  `rmdir` e `find ... -delete`/`-exec rm` cujo alvo é `.`, `..`, `*`, `./*`, a pasta de trabalho ou um caminho
  absoluto ancestral dela. **Custo:** limpeza ampla legítima (`rm -rf *` na raiz) é bloqueada; quem faz é a pessoa,
  à mão. Depois de `cd wiki`, `.` e `*` valem para `wiki` e passam.
- **Custo (falso positivo):** comando de verbo desconhecido que cite `raw/` (`python ler.py raw/a.md`), `perl` de
  leitura, `sort raw/a.md`, `git clone` para fora de `raw/` citando-o, e o `apply_patch` do Codex numa página da
  wiki cujo patch cita `raw/` (`+original_file: raw/a.pdf`): o patch vira texto de comando e bloqueia. O dono
  escolheu esse lado de propósito.
- **Limites reais que sobram (cada um passa):**
  - variável: `d=raw; rm $d/a`;
  - subshell ou expansão que monta o nome: `rm $(printf r%s aw)/a`;
  - glob que monta o nome: `rm r*/a`, `rm ra[w]/a`;
  - script externo: `bash limpa.sh`, `python apaga.py`;
  - ofuscação: `> r\aw/a`, `> $'raw/a'`;
  - `sed -f script` e `sed` com a flag `w` sob delimitador que não seja `/`; `cp -- -t` com arquivo chamado `-t`;
  - git que roda programa por configuração ou ambiente: `git config`, `git -c alias...` num comando que não cita
    `raw/`; variável exportada antes (`export PAGER=...; git log raw/`);
  - destino em chave de payload desconhecida: uma ferramenta de MCP com `path` em `wiki/` e o destino em
    `chave_estranha: raw/a` (as chaves `destination`, `dest`, `new_path`, `target_path`, `output_path` e parentes
    estão cobertas);
  - R64 só cobre `.`, `..`, `*`, a pasta de trabalho e seus ancestrais: `rm -rf wi*/..` passa; `grep -rl x . | xargs sed
    -i` (sem citar `raw/`) passa;
  - `xargs rm < lista` com a lista fora de `raw/` e os caminhos de `raw/` dentro dela.
  Comando ilegível (aspas abertas, `$(...)`, crase) bloqueia só se citar `raw/`; bloquear todos tornaria o terminal
  inutilizável. O hook cobre o erro do agente, não um agente hostil; garantia contra isso exige permissão de
  sistema de arquivos.
- Pelo código (`src/comandos/hook-proteger-raw.ts`, linhas 285 a 308), ferramentas de leitura passam mesmo
  apontando para `raw/`; o caminho vem dos campos de caminho (inclusive os de `toolArgs` do Copilot, decodificados)
  e, se algum cai em `raw/`, bloqueia mesmo que a ferramenta também tenha um comando. Payload sem caminho isolável
  bloqueia se citar `raw/` (linhas 302 a 304). Só a forma do Claude Code foi exercitada de ponta a ponta com agente
  real; o terminal em Codex, Gemini e Copilot segue a documentação de cada um e nunca foi executado
  (`hooks/README.md`, final).
- A comparação de caminho ignora a caixa (`estaEmRaw`, `src/lib/caminhos.ts`): Raw/a.md é bloqueado, e no Linux uma
  pasta legítima chamada Raw também seria.
- Três textos dizem "recusa qualquer escrita em `raw/`": o `README.md` (seção "Os quatro níveis"), a descrição em
  `hooks/hooks.json` (linha 5) e este arquivo. Leia como "escrita por ferramenta de edição ou por comando de
  terminal que o hook consiga ler", nos limites acima.

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
  confidencial e sanitização em `scripts/`, `hooks/`, `src/` e `skills/` não
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
