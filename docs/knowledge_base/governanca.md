---
generated: 2026-10-27
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
| Hook `proteger-raw` | Bloqueia (saída 2) a escrita em `raw/` feita pelas ferramentas de edição de arquivo e por comando de terminal (limites na seção abaixo). Sem caminho isolável no payload, bloqueia se o texto citar `raw/`; JSON ilegível bloqueia sempre. | `src/comandos/hook-proteger-raw.ts`, funções `decidir` e `executarProtecao`; `hooks/hooks.json`, linha 6 |
| Validador da wiki (`anvilore validar`) | Reprova página sem frontmatter ou com frontmatter que não lê (YAML inválido nunca é pulado), com `type` inválido, com `slug` diferente do nome do arquivo (comparado em Unicode NFC), com `area` em conflito com o diretório, dois arquivos da mesma pasta que só diferem na caixa, wikilink que não resolve, página fora do index.md aplicável e campo de proveniência malformado. Reprova wiki inexistente e diretório sem nenhum arquivo `.md`; uma wiki só com index.md e log.md passa. Sem o Bun o comando não roda, e nunca imprime PASS. | `src/comandos/validar.ts`, linhas 100 a 244 |
| Portão humano, depois da escrita | Reprova a página com `generated` em mapping e sem uma entrada `verified` com `by: human:<id>` e `at` igual ou posterior a `generated.at`. Compara o instante com offset e todos os dígitos da fração de segundo. A mensagem é "página gerada sem aprovação humana". | `src/lib/okf.ts`, funções `validarProveniencia` e `compararInstantes` |
| Perfil da empresa | Um anvilore.toml na raiz do projeto restringe áreas, tipos de página e campos obrigatórios; reprova nomeando arquivo e valor. Arquivo ilegível, chave desconhecida ou valor que não é lista de textos também reprova. | `src/lib/perfil.ts`, linhas 28 a 54; `src/comandos/validar.ts`, linhas 189 a 191 e 204 a 212 |
| Relatório das travas (`anvilore doctor`) | Lê os arquivos do clone e diz, em linguagem simples, se a proteção do `raw/` está ligada em cada agente configurado no clone (pasta de configuração no destino; agente que só tem a CLI no PATH aparece como "encontrado, sem trava neste clone" e agente ausente como "não instalado", ambos opcionais), e sai 1 se nenhum agente do clone tem a trava (a mesma configuração que o instalador escreve; hook antigo conta como desligado), se o fechamento chama o validador e se há CI ou pré-commit com a checagem; comentário e etapa com `if: false` não contam como chamada ativa. **Limite:** o texto `checar-docs` dentro de uma string de `echo` (ou de outro comando) ainda conta como etapa ligada; o `doctor` lê arquivos, não executa o CI. Pré-requisitos `bun` e `git` no PATH. Sai 1 se faltar trava ou pré-requisito; perfil ausente é opcional. Não conta quantas vezes algo foi barrado e não executa agente. | `src/comandos/doctor.ts` |
| Instalador | Funde JSON sem trocar escalares divergentes e mantém um bloco delimitado no TOML. Conflito ou JSON inválido nomeia o arquivo, preserva seus bytes e sai com 4 ao fim, depois de processar os demais agentes; uso ou destino inválido sai com 1. Simulação não escreve, e reinstalação sem mudanças devolve INALTERADO. O relatório inclui instalados, ausentes, avisos e causas das falhas de link; agente com link que falhou não é contado como instalado. Nunca copia uma skill como alternativa ao link. Arquivos soltos e pastas ocultas em skills são ignorados. | `src/comandos/instalar.ts`, `src/lib/fundir-json.ts`, `src/lib/fundir-bloco.ts`; cenários em `tests/instalar.test.ts` |
| Tipos e cobertura | `tsc --noEmit` e testes com cobertura mínima de 80% no geral. | `package.json` (script `checar`); `bunfig.toml`, linha 2 |
| Checagem de links | Reprova link e menção a arquivo inexistente nesta pasta. | `src/comandos/checar-docs.ts` |
| Trava de release | Reprova versão sem seção no CHANGELOG, seção vazia, pasta desta KB ausente ou sem página, ou página sem `verified`. | `src/comandos/checar-release.ts` |
| CI (executado em Linux, Windows e macOS) | Roda `bun run checar` e `checar-docs` em Linux, Windows e macOS a cada push e pull request, e `checar-release` em tag. Os PRs da Onda 1 (#13, run 40150863576) e da Onda 2 (#11, run 40191764239) passaram nos três sistemas (`gh pr checks`). Nenhuma tag foi criada, então o passo `checar-release` nunca rodou no CI. | `.github/workflows/ci.yml` |

O hook falha fechado: se não consegue ler o caminho no payload, a decisão passa
a ser sobre o texto inteiro, e "não achei caminho" nunca vira "pode passar"
(`src/comandos/hook-proteger-raw.ts`, função `decidir`). O
validador também não imprime PASS quando o diretório não existe (`src/comandos/validar.ts`, função
`validarWiki`) nem quando um arquivo, o anvilore.toml ou o YAML do frontmatter não lê: cada um vira um
erro que nomeia o arquivo.

## O que hoje não é imposto

Cada item abaixo foi conferido no código. Onde a conferência foi uma busca que não achou nada, isso
está dito.

### 1. O hook cobre o terminal só pelo texto do comando

- O hook é o subcomando `anvilore hook proteger-raw` (`src/comandos/hook-proteger-raw.ts`). O Claude
  Code o liga para `Write|Edit|NotebookEdit|Bash` (`hooks/hooks.json`, linha 6); o Codex usa
  `apply_patch|Edit|Write|Bash` e o Gemini `write_file|replace|run_shell_command`
  (`src/comandos/instalar.ts`, função `configuracaoDoHook`). O evento do Copilot não tem
  `matcher` e roda em toda chamada de ferramenta.
- **O que a forma instalada garante em cada agente** (detalhe e prova do CI em [plataformas.md](plataformas.md)):
  Claude Code leva `|| exit 2`, `shell: "bash"` e `onFailure: "block"` (esta chave pede a 2.1.295; o `doctor` avisa
  se o `claude --version` for anterior); Copilot leva `bash` com `|| exit 2` e `powershell` com
  `if ($LASTEXITCODE -ne 0) { exit 2 }`; Codex leva `command` com `; exit $LASTEXITCODE` e `command_windows` com a
  forma PowerShell, que fecha até sem o `bun`; Gemini leva só `command` com `; exit $LASTEXITCODE`. **Limite
  declarado:** com o `bun` ausente, Codex (fora do Windows) e Gemini ficam sem o hook (o shell devolve 127 ou 0, nunca
  2); a mitigação real é o `anvilore doctor`, que trata o `bun` como pré-requisito e sai 1 se faltar. O hook não
  detecta sozinho que o `bun` sumiu.
- **Como o terminal é julgado** (`src/comandos/hook-proteger-raw.ts`, `segmentoEscreve`, `escritaDeShell` e
  `terminalEscreve`):
  - o alvo de redirecionamento, de `tee`, de `cp`/`mv`/`ln`, de `sed -i` e de `git` que não seja de leitura é julgado
    pelo caminho, e `cd raw` (com ou sem opção, `cd -`, `popd`) torna relativos os caminhos seguintes;
  - cópia e movimento no PowerShell (`Copy-Item`/`Move-Item` e aliases) e no cmd (`copy`/`move`) com destino omitido
    usam o diretório atual; o hook considera esse destino implícito depois de `cd` ou `Set-Location`;
    parâmetros comuns com valor (`-ErrorAction`, `-OutVariable` e seus apelidos, entre outros) são consumidos pelo parser.
    Cópia/movimento julgam todos os posicionais após a origem, além do destino nomeado, para falhar fechado;
  - opções longas GNU que determinam destino ou escrita aceitam prefixos inequívocos, como `cp --target-dir=raw`
    e `rm --rec .`; o helper `opcaoLongaGnu` também é usado ao abrir envolvedores e reconhecer listagens recursivas;
  - **regra ampla (R66):** se o comando cita `raw/` em qualquer posição (inclusive como leitura) e algum segmento
    (pipe, `;`, `&&`, laço `while`/`for`/`do`, `xargs`, `find -exec`, `sh -c`) tem um verbo de escrita ou remoção
    (`rm`, `rmdir`, `mv`, `ln`, `touch`, `truncate`, `dd`, `install`, `rsync`, `chmod`, `chown`, `shred`, `perl`,
    `sed -i` (inclusive `-Ei`), `python -c`, `node -e` e os cmdlets do PowerShell `Remove-Item`, `Move-Item`,
    `Rename-Item`, `Set-ItemProperty` e seus apelidos), bloqueia, também dentro de blocos `{ ... }` de `ForEach-Object`/`%`
    e do script de `sh -c`. `cp`, `tee` e, no PowerShell/cmd, `Copy-Item`, `copy`, `Out-File`, `Set-Content`, `Add-Content`,
    `New-Item` e `Clear-Content` ficam de fora dessa regra e são julgados pelo destino (parâmetros abreviados e `-Path:valor`
    inclusos), porque copiar de `raw/` para a wiki é o uso normal da ingestão; sem destino explícito, os que leem o caminho dos
    itens da pipeline (`gci raw | Clear-Content`) bloqueiam, e dentro de um bloco alimentado por `raw/` um destino montado
    com variável (`Set-Content $_.FullName`) também. Redirecionamento continua julgado pelo alvo (`rg x raw/ > /tmp/out` passa);
  - `env`, `sudo`, `nice`, `timeout`, `time`, `xargs`, `busybox`... são abertos com as opções de cada um para ver o
    comando de dentro; `git` só passa pela lista de leitura (`log`, `show`, `diff`, `status`, `blame`, `grep`,
    `ls-files`, `ls-tree`, `rev-parse`, `cat-file`, `describe`, `shortlog`, `reflog`, `rev-list`, `add`, `commit`,
    `branch`, `tag`), e `-c`, `--exec-path`, `GIT_*`, `--output` e `grep -O` bloqueiam;
  - **R64/R66:** também sem citar `raw/`, bloqueia `git clean -x`/`-X` e `rm -r`, `rmdir`, `find ... -delete`/
    `-exec <verbo de escrita>` e uma listagem recursiva (`Get-ChildItem -Recurse`, `ls -R`, `find`, `grep -r`) que alimenta
    uma escrita (`| xargs rm`, `| ForEach-Object { Remove-Item }`, `| while read f; do rm "$f"; done`) cujo alvo é a raiz do
    projeto (o `cwd` do payload), um ancestral dela (inclusive `/` e `C:\`), `.`, `..` ou `*`; caminho relativo é resolvido
    contra o `cwd`.
    **Custo:** limpeza ampla legítima na raiz é bloqueada; quem faz é a pessoa, à mão.
- **Custos (falso positivo), escolhidos de propósito:** comando de verbo desconhecido que cita `raw/`
  (`python ler.py raw/a.md`), `perl` de leitura, `sort raw/a.md`, `rm wiki/x.md; cat raw/y.md` e
  `cp raw/a wiki/a && touch wiki/index.md` (a regra ampla não separa leitura de escrita no mesmo comando), o `apply_patch` do Codex e o heredoc numa página da wiki cujo texto
  cita `raw/` (`+original_file: raw/a.pdf`): o texto vira comando e bloqueia.
  Em cópia/movimento, um valor de parâmetro desconhecido que cite `raw/` depois da origem também bloqueia,
  mesmo quando o destino informado fica na wiki: o parser o considera um possível destino adicional.
- **Regra de parada (R66).** Depois da rodada 2, a revisão só trata como bloqueante um **falso liberar** que (a) um
  agente plausivelmente emitiria para escrever em `raw/` e (b) não pertença a uma das classes abaixo, que o hook
  declara não cobrir. O hook cobre o erro do agente, não um agente hostil.
- **Classes de limite (cada uma passa, de propósito):**
  1. *Variável e expansão:* `d=r; rm ${d}aw/a`, `rm -rf "$PWD"`, `rm $(printf r%s aw)/a`, `rm r*/a`, `rm ra[w]/a` (com `raw` escrito por extenso o
     hook vê o texto e bloqueia: `d=raw; rm $d/a` não é exemplo de limite),
     `export PAGER=rm; git log raw/`.
  2. *Script externo:* `bash limpa.sh`, `make clean`, `npm run limpa`, hook de commit do git.
  3. *Alias, função e configuração:* `alias rm=...`, `git config`/`git -c alias...` numa chamada que não cita `raw/`.
  4. *Codificação e ofuscação:* `> r\aw/a`, `> $'raw/a'`, os escapes do `env -S` fora do `\_` (`env -S 'rm\tx'`; sem promessa de cobertura), `echo cm0gcmF3L2E= | base64 -d | sh` (o `sh` lendo o pipe só é visto
     quando um segmento anterior cita `raw/`).
  5. *Interpretador com código vindo de arquivo ou de stdin:* `python apaga.py`, `node limpa.js`, `sed -f script`,
     `bash < comandos.txt`, `xargs rm < lista` com a lista fora de `raw/`.
  6. *Destino em chave de payload desconhecida:* uma ferramenta de MCP com `path` em `wiki/` e o destino em
     `chave_estranha: raw/a` (as chaves `destination`, `dest`, `new_path`, `target_path`, `output_path` e parentes
     estão cobertas).
  7. *Escopo do R64:* só `.`, `..`, `*`, a raiz do projeto e seus ancestrais; `mv * ../outro/` e
     `rsync --delete vazio/ ./` passam; sem `cwd` no payload, `cd .. && rm -rf <repo>` passa.
  8. *Valor colado à opção curta de ferramenta externa:* `7z x f.7z -oraw`, `tar -xf a.tar -Craw`, `wget -Praw url`,
     `curl -sLoraw/a.pdf url` (o `raw` fica dentro da opção e o hook não o separa).
- **Mitigação real além do hook: nenhuma no código.** `raw/` não é protegido pelo git: `.gitignore` tem `raw/*`, então o git
  não rastreia as fontes (não acusa mudança nem restaura arquivo apagado); `anvilore validar` e `anvilore fechar` não
  olham `raw/`. O que sobra é o `AGENTS.md` (proíbe em prosa), este hook e o que a pessoa fizer fora do kit:
  permissão de somente leitura no sistema de arquivos para o usuário do agente e cópia de segurança das fontes.
- Pelo código (`src/comandos/hook-proteger-raw.ts`, função `decidir`), ferramentas de leitura passam mesmo
  apontando para `raw/`; o caminho vem dos campos de caminho (inclusive os de `toolArgs` do Copilot, decodificados)
  e, se algum cai em `raw/`, bloqueia mesmo que a ferramenta também tenha um comando. Payload sem caminho isolável
  bloqueia se citar `raw/` (na mesma função). Só a forma do Claude Code foi exercitada de ponta a ponta com agente
  real; o terminal em Codex, Gemini e Copilot segue a documentação de cada um e nunca foi executado
  (`hooks/README.md`, final).
- A comparação de caminho ignora a caixa (`estaEmRaw`, `src/lib/caminhos.ts`): Raw/a.md é bloqueado, e no Linux uma
  pasta legítima chamada Raw também seria.
- Três textos dizem "recusa qualquer escrita em `raw/`": o `README.md` (seção "Os quatro níveis"), a descrição em
  `hooks/hooks.json` (linha 5) e este arquivo. Leia como "escrita por ferramenta de edição ou por comando de
  terminal que o hook consiga ler", nos limites acima.

### 2. O portão humano só vale para a página que declara `generated`

- O aval **antes** da escrita (a pessoa aprova os takeaways e a lista de páginas; no caso de fonte grande, "o primeiro
  subagente lê e não escreve; o segundo só escreve depois do aval") continua sendo texto, em
  `skills/ingest/SKILL.md`, linhas 1 a 12, 36 a 55 e 73 a 92. Nenhum script confere que ele aconteceu.
- O aval **depois** da escrita é imposto (tabela acima), mas só para a página que traz o bloco
  `generated`. A skill `ingest` manda gravar esse bloco em toda página que escreve (`skills/ingest/SKILL.md`, Passo 3, linhas 94
  a 130, e Passo 5), e `tests/skill-ingest.test.ts` prova que os modelos dela fazem o validador reprovar até haver `verified`
  humano. O limite real que fica: uma página **sem** `generated` (escrita à mão, ou por um agente que não seguiu a skill) é
  tratada como escrita à mão e não aciona o portão.
- Nenhum programa prova quem escreveu `verified`. Um agente que grave `verified` com
  `by: human:<id>` por conta própria viola o contrato (`AGENTS.md`, seção "O que você não faz") e o
  validador não o detecta.
- Não confunda os dois formatos: o `verified: AAAA-MM-DD` escalar desta pasta é do projeto e é lido
  por `checar-release`; o `verified` em mapping (`by`, `at`) é o da wiki de quem usa, lido pelo
  validador da wiki. Eles não se unificam.
- A mesma coisa vale para "não resolver contradição por conta própria" no `AGENTS.md`: é contrato
  em prosa.

### 3. A navegação é conferida com limites

- O validador reprova wikilink quebrado e página fora do índice (`src/comandos/validar.ts`, função
  `validarWiki`). A auditoria estrutural também relata esses problemas (`src/comandos/auditar.ts`, função
  `auditarWiki`), chamada pela skill de lint (`skills/lint/SKILL.md`, Passo 1).
- A página da wiki plana é conferida contra o `wiki/index.md`; a de uma área, contra o
  `wiki/<área>/index.md` se ele existir e, se não, contra o `wiki/index.md`. Wiki sem nenhum
  index.md aplicável passa, mas o validador imprime o aviso "sem index.md: conferência do índice
  não feita".
- O alvo do wikilink é só o slug (`[[slug]]`, `[[slug|rótulo]]`, `[[slug#seção]]`). Link com
  caminho, como [[sources/x]], e embed de imagem, como ![[imagem.png]], reprovam como quebrados,
  mesmo que o arquivo exista (o auditor em `src/comandos/auditar.ts` também usa slugs). Link markdown e wikilink
  dentro de bloco de código, código em linha ou comentário HTML não são conferidos.
  Nos wikilinks, a máscara de código em linha é aplicada ao texto visível inteiro, inclusive quando o código atravessa linhas;
  isso vale também para as entradas do índice. Crase sem fecho não esconde o texto seguinte
  (`src/comandos/validar.ts`, função `alvosDe`; `src/lib/markdown.ts`, função `mascararCodigoEmLinha`).
- O index.md, o log.md e os diretórios reservados não são cobrados de `type`, `slug`, área nem
  índice, mas o YAML e a proveniência deles são conferidos (YAML que não lê reprova, nomeando o
  arquivo), como fazia o validador antigo. O portão humano só vale para página de conteúdo.

O fechamento (`src/comandos/fechar.ts`) chama sincronização de índices, reconstrução de log, validação e gate do log do dia,
nessa ordem, e para no primeiro erro. O gate cobra páginas com mtime posterior à meia-noite local, com exceção dos
arquivos regulares rastreados sem alteração em relação ao `HEAD` (incluindo o índice do Git). Isso evita cobrar o esqueleto
só por causa do checkout. Páginas ignoradas pelo Git e symlinks continuam pelo mtime; sem Git ou sem `HEAD`, nenhuma página
é dispensada por esse critério. `ANVILORE_PULAR_GATE_LOG=1` pula apenas o gate, e não a validação.

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

## Ganchos da wiki e opções Git

- `anvilore hooks-wiki` concentra os comandos dos eventos: commit da página após escrita, backup da branch,
  aviso para novo arquivo em `raw/`, restauração do índice e dos últimos logs diários após compactação e
  sugestão de lint após cinco ingestões desde o último lint (`src/comandos/hooks-wiki.ts`). Os logs diários ficam em
  `wiki/log/`, com nomes log-AAAA-MM-DD.md; o índice gerado `wiki/log.md` nunca é editado por essa lógica.
  O commit agrupa a página, o índice da área correspondente e o log do dia.
- W11 (autocommit) usa `PostToolUse` no Claude/Codex, `AfterTool` no Gemini e `postToolUse` no Copilot CLI.
  W13 (restaurar contexto na compactação) usa `SessionStart` com `compact` no Claude e no Codex.
  W14 (sugerir lint) usa `Stop` no Claude/Codex e `AfterAgent` no Gemini; Copilot não tem saída de mensagem
  de terminal em `agentStop`, então o doctor informa W14 indisponível ali.
- W12 usa `SessionStart` para retornar `hookSpecificOutput.watchPaths` com o caminho absoluto de `raw/` e um
  grupo `FileChanged` sem matcher. A documentação oficial do Claude Code descreve `event: "add"` para arquivo
  criado em caminho observado. A tentativa de verificação runtime com Claude Code 2.1.311 parou na tela de
  autenticação inicial, sem login e sem chamada ao modelo; os testes verificam a forma e o tratamento do payload,
  não a emissão real do evento.
- W17 roda no fim da sessão (`SessionEnd`) no Claude Code, Codex, Gemini CLI e Copilot CLI. O Codex limita
  esse hook a 3 segundos; o Gemini informa que SessionEnd é best-effort e não aguarda o comando terminar.
  O backup exige upstream já configurado. Sem upstream, não faz push nem cria branch remota e escreve o aviso
  em stderr com saída 2 (o evento de SessionEnd do Copilot não processa JSON de saída).
- Os formatos e a superfície de cada evento foram conferidos nas documentações oficiais de
  [Claude Code](https://code.claude.com/docs/en/hooks), [Codex](https://learn.chatgpt.com/docs/hooks),
  [Gemini CLI](https://geminicli.com/docs/hooks/reference/) e
  [GitHub Copilot](https://docs.github.com/en/copilot/reference/hooks-reference). Os testes em
  `tests/hooks-wiki.test.ts` e `tests/instalar.test.ts` verificam lógica e arquivos gerados, não simulam
  os ciclos de vida reais dos agentes.
- Commit automático e backup no GitHub exigem opt-in explícito na configuração anvilore.toml, feito por
  `anvilore instalar --auto-commit` e `anvilore instalar --github-backup`. Sem esses campos, os dois ficam desligados.
  O commit adiciona somente a página em `wiki/`, índices de navegação relacionados e o log do dia; não adiciona
  `raw/`. O backup envia commits existentes da branch atual, somente quando há upstream e commits locais, sem
  criar commits nem reescrever histórico.

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

Resposta honesta: contra edição pelas ferramentas de edição do agente e contra a maior parte dos comandos de terminal que o
hook consegue ler, sim, dentro das classes de limite da seção 1 e do `bun` presente; só o Claude Code foi testado de ponta a
ponta com agente real. Contra um agente que monte o comando de forma que o hook não lê, contra apagar a pasta por fora do kit e
contra cópia ou vazamento do conteúdo, não. O git não é uma segunda trava: as fontes estão ignoradas por ele.
