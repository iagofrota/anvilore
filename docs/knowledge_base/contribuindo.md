---
generated: 2026-10-27
---

# Contribuindo

Como rodar, testar e entregar uma mudança no Anvilore. Quem só **mantém uma wiki** não precisa
desta página.

## Rodar e testar

```bash
bun install
bun run build:ui
bun run checar
```

- `bun install` instala dependências de desenvolvimento e a dependência de produção do servidor
  MCP (@modelcontextprotocol/sdk, declarado em package.json). O `bun.lock` é versionado, e o CI usa
  `bun install --frozen-lockfile`.
- `bun run build:ui` gera os assets de React+TS em `src/ui/public/` com o Bun. O script `checar`
  executa esse build antes de `tsc --noEmit` e `bun test --coverage`;
  `src/ui/public/` é o artefato usado por `anvilore ui`.
- `bun run checar` roda o build, `tsc --noEmit` e `bun test --coverage` (script `checar` em
  `package.json`). A cobertura mínima é 80% no geral (`bunfig.toml`). A meta de 95% em validação e
  proteção de `raw/`, declarada pelo dono do projeto, ainda não tem trava por arquivo (veja
  [governanca.md](governanca.md)).
- O Bun usado no CI vem do campo `packageManager` de `package.json`.
- Para conferir esta pasta: `bun src/cli.ts checar-docs`. Para simular a trava de release:
  `bun src/cli.ts checar-release 0.1.0`.
- Para consultar a dívida declarada sem escrever em `wiki/_meta/`:
  `bun src/cli.ts listar-lacunas wiki --consultar` (`src/comandos/listar-lacunas.ts`). Sem
  `--consultar`, o comando gera o índice de lacunas nessa pasta.
- Os testes antigos em bash continuam em `tests/test-*.sh`, para o código que ainda é bash. Rode
  cada um com `bash tests/test-porte-onda-2.sh`, por exemplo. O alvo desses testes antigos é Linux.
  O instalador já é coberto por `tests/instalar.test.ts`, `tests/fundir-json.test.ts`,
  `tests/fundir-bloco.test.ts` e `tests/juncoes.test.ts`, em Bun. Toda instalação de teste usa
  destino temporário; nunca instale na configuração real de um agente para verificar uma mudança.
  O ensaio com agente real em `tests/test-instalar-agente-real.sh` é separado e só roda quando
  explicitamente pedido; não faz parte da suíte automática.
- A suíte do instalador captura e confere os diagnósticos de casos esperados, sem despejar logs
  de instalação na saída dos testes. A etapa de medição do CI executa `scripts/medir-ligacoes.ts`
  para imprimir os resultados de diretório e arquivo; não repete a suíte de junções.

O CI roda `bun run checar` e `checar-docs` em Ubuntu, Windows e macOS a cada push e pull request
(`.github/workflows/ci.yml`). Os PRs das Ondas 1 (#13, run 40150863576) e 2 (#11, run 40191764239)
passaram nos três. Uma mudança que passa só no seu sistema não está pronta.

Os hooks da wiki ficam em `src/comandos/hooks-wiki.ts` e são exercitados por
`tests/hooks-wiki.test.ts`. Commit e backup são opt-in: `anvilore instalar --auto-commit` e
`anvilore instalar --github-backup`; `anvilore doctor` valida o repositório da wiki, o ignore de páginas
novas e o upstream. A instalação inicializa `wiki/` como repositório Git próprio quando necessário.
Durante a escrita da ingestão pela interface, `ANVILORE_SEM_AUTOCOMMIT=1` desliga o hook de autocommit;
a aprovação posterior continua disponível na Revisão.
A ponte da interface com o Claude Code (`src/lib/ponte-claude-code.ts`) é testada com um `claude` falso,
`tests/apoio/claude-falso.ts`, que emite o stream JSON visto na prova da ponte e registra argumentos,
ambiente e stdin; a orquestração usa a ponte em memória de `tests/apoio/ponte-falsa.ts`. Nenhum teste
chama o Claude Code real.
A matriz configurada é:
Claude Code: W11/W12/W13/W14/W17; Codex: W11/W13/W14/W17; Gemini: W11/W14/W17; Copilot CLI:
W11/W17. W12 usa FileChanged com `SessionStart.watchPaths` só no Claude; W13 usa SessionStart=compact
no Claude e Codex; W14 não está disponível no Copilot porque `agentStop` não fornece uma mensagem
visível sem bloquear a próxima rodada. W17 usa SessionEnd nos quatro. Claude Code define timeout de
15 segundos para o hook. No Codex, cujo limite é 3 segundos, e no Gemini, onde SessionEnd é
best-effort e não aguarda o comando terminar, o backup é melhor esforço e pode não completar. Claude
Code usa `permissions.ask` e um hook que só permite aprovar em modo `default`; os outros agentes ainda
não têm mecanismo de aprovação com um clique. Os testes verificam lógica e configurações geradas, não
executam ciclos de vida reais dos agentes.

## Testes de navegador

O Playwright cobre os fluxos que precisam provar a interface React no Chromium junto com a API local e os arquivos de um vault temporário. O runner usa Node; Bun continua compilando a interface e executando o servidor e o Claude falso. Cada teste cria seu próprio vault, porta efêmera, token e processo falso. Nenhum teste chama um Claude Code real.

```bash
node node_modules/@playwright/test/cli.js install chromium
bun run e2e
bun run e2e:ui
bun run e2e:types
```

`bun run e2e` compila a interface, confere os tipos em `e2e/` e roda os arquivos `*.e2e.ts`; eles não entram em `bun test` nem no `bun run checar`. A suíte usa Chromium, locale `pt-BR`, fuso de São Paulo, viewport padrão 1280×800 e zero retries. Para escolher o cache de navegador, defina `PLAYWRIGHT_BROWSERS_PATH`; no runner descartável `agentop run --rm`, use `e2e/.cache/ms-playwright` para manter o browser visível fora do HOME temporário.

Relatórios, traces de falha, screenshots, logs e a guarda de hashes ficam em `e2e/resultados/`, ignorado pelo Git. Um vault com falha é preservado e seu caminho aparece na saída; `E2E_MANTER=1` preserva também os vaults aprovados. A guarda global compara os hashes de `raw/` e `wiki/` reais antes e depois da suíte. C08, C14, C25 e a barreira de `Host` do C02 continuam cobertos por `bun:test`; C19 verifica o argv do Claude falso e a exibição da recusa, não o comportamento de permissões de um Claude Code real. A política CSP aceita a origem atual e os dois aliases de loopback na mesma porta efêmera; o servidor ainda valida `Origin` para mutações. Texto colado normaliza CRLF para LF; o envio de arquivo conserva os bytes recebidos. A inspeção visual feita pela automação se limita aos viewports exercitados nos testes.

## Testes primeiro, com cenários em gherkin

- Escreva o teste antes do código e veja-o falhar.
- O nome do teste é o cenário: `Dado ... Quando ... Então ...`. Não há cucumber nem biblioteca de
  gherkin. Exemplo real: `tests/checar-docs.test.ts`.
- Todo módulo de `src/` é importado por `tests/cobertura.test.ts` para entrar na cobertura. Por
  isso importar um módulo não pode ter efeito colateral: o `import.meta.main` em `src/cli.ts` é o
  modelo.
- Uma peça portada de bash ou Python não pode se comportar diferente da original: mesmos códigos
  de saída e mesmas mensagens que os testes antigos conferem.
- Nunca pule uma checagem em silêncio. Dependência ausente, YAML inválido ou diretório
  inexistente reprova ou avisa; não vira "PASS".

## Adicionar um subcomando

1. Escreva o teste em `tests/`.
2. Crie o módulo em `src/comandos/`, exportando a função do comando.
3. Registre-o na tabela de `src/cli.ts`.
4. Se ele deve rodar no CI, acrescente a etapa em `.github/workflows/ci.yml`.

## CHANGELOG a cada mudança

Toda mudança acrescenta uma linha em `[Unreleased]` do `CHANGELOG.md`, no momento em que é feita, em
linguagem simples (quem lê é o gestor, não só o programador; decisão do dono do projeto em
2026-10-23). O formato é o Keep a Changelog, com
Versionamento Semântico.

## Knowledge base junto com o código

- Mudou um comportamento: atualize a página correspondente no mesmo momento.
- Cada página cita os arquivos que sustentam o que diz. Para apontar uma linha, escreva "linha N"
  no texto, fora das crases, porque o `checar-docs` confere que o arquivo existe, e um arquivo com
  o número da linha colado ao nome não existe.
- Prefira a âncora estável a "linha N": o nome da função, o título da seção, a chave do campo.
  Linha envelhece a cada edição do arquivo citado, e o `CHANGELOG.md` muda a cada tarefa; cite-o
  pelo título da seção. Quem muda um arquivo que alguma página cita por linha reconfere a citação
  (`sed -n` na linha) no mesmo commit.
- Link relativo (`[texto](pagina.md)`) resolve a partir da página. Menção entre crases resolve a
  partir da raiz do repositório e só conta quando parece caminho: sem espaço, sem `*`, `<` ou `>`,
  que não seja URL, e que contenha `/` ou termine em extensão de arquivo conhecida. A âncora
  (`#...`) é descartada, e blocos de código cercados são ignorados. Link e menção que resolvem
  para fora da raiz do repositório reprovam, mesmo que o arquivo exista na máquina. O texto de um
  link pode atravessar linhas; o problema aponta a linha onde o link começa. Veja o código em
  `src/comandos/checar-docs.ts`.
- Comentários HTML sem fecho só escondem o restante da página quando abrem no início da linha
  (até três espaços antes). No meio da linha são texto. Comentários dentro de código em linha
  são literais, inclusive quando o código atravessa linhas; remover um comentário não cria
  uma cerca de código (`src/lib/markdown.ts`).
- Escapes por barra invertida seguem a pontuação ASCII do CommonMark: colchete de abertura
  escapado é texto, enquanto duas barras antes do colchete permitem um link real. Colchete
  escapado dentro do rótulo e parêntese escapado no destino não encerram o link. A pontuação é
  lida pelo reconhecedor de links, preservando posições e linhas; o destino recupera seus caracteres
  literais antes da conferência (`src/lib/markdown.ts`; `tests/checar-docs.test.ts`).
- Links inline e imagens aceitam parênteses balanceados no destino, destino entre ângulos
  (inclusive com espaços), colchetes balanceados no texto e título entre aspas duplas, simples
  ou parênteses. Uma linha em branco encerra o link (`src/lib/markdown.ts`).
- Links e imagens por referência aceitam as formas cheia, colapsada e curta. As definições
  da página são reunidas antes dos usos; caixa e espaços do rótulo são normalizados, e a
  primeira definição vence. Todo destino de definição é conferido, mesmo sem uso e mesmo
  em uma definição repetida. O diagnóstico aponta a primeira ocorrência do alvo na página
  (`src/lib/markdown.ts`; `src/comandos/checar-docs.ts`).
- **Nome hipotético ou relativo a outra pasta, entre crases, reprova como falso positivo.** Se a
  menção parece caminho e não existe a partir da raiz, o `checar-docs` não sabe que era um
  exemplo ou que o arquivo mora em outra pasta. Há duas saídas: escrever o caminho a partir da raiz
  (com a pasta, em vez do nome solto do arquivo, como `docs/knowledge_base/decisoes.md`) ou escrever o nome sem crases.
- **O que o `checar-docs` não confere** (não é suportado hoje; não conte com ele): autolinks,
  links em HTML cru e menção a dotfile ou a nome sem extensão e sem barra
  (`.gitignore`, `LICENSE`). Para esses, a conferência é da revisão por pessoa. Uma extensão fora da
  lista fechada de `src/comandos/checar-docs.ts` também não conta. O leitor não é um parser completo:
  não interpreta listas, citações em bloco e código indentado, nem decodifica entidades HTML nos
  destinos. Definições por referência dentro desses contêineres não têm suporte; prefira
  definições no início de um parágrafo comum.
- **Limites conhecidos do leitor de links** (a bateria contra o commonmark.js os achou; não conte com a
  conferência nestes casos): destino ou título na linha seguinte dentro de uma citação (`> [x](` e
  `> quebrado.md)`); comentário `<!--` sem fecho dentro de item de lista continuado; HTML cru no
  texto do link (`[a <span title="]">b</span>](x.md)`); bloco HTML com link dentro (`<details>`) e
  texto na mesma linha do fecho `-->`, que podem reprovar sem necessidade; cerca com quatro ou mais
  espaços, que é tratada como cerca (vale para as que moram em itens de lista) e não como código
  indentado. Crase sem par e `<!--` sem fecho terminam no fim do parágrafo, e o parágrafo termina
  em linha em branco, cerca, item de lista (o numerado só se começar em 1 ou for irmão de outro
  numerado), início de citação (a continuação com `>` não corta), título ou régua: um código em linha que de
  verdade atravessa esses blocos não é reconhecido como código, e um link dentro dele pode reprovar
  sem necessidade. Em sentido contrário, dois limites deixam passar um link quebrado: um bloco
  dentro de uma citação (item, título, régua) não encerra o parágrafo, então uma crase sem par
  na linha de cima pode parear com uma crase da linha de baixo e esconder o link entre elas
  (uma linha de texto com crase sem par seguida de `> - [q](quebrado.md)` e de outra crase); e
  um item numerado logo depois de um item com marcador não abre lista nova, então no par de linhas
  `- a` e `2. [q](quebrado.md)` a mesma crase sem par atravessa os dois itens.
- **A caixa do nome só é conferida no Linux.** No macOS e no Windows o disco não diferencia
  maiúsculas de minúsculas: `[x](Decisoes.md)` para o arquivo decisoes.md passa lá e reprova no
  Linux. Quem pega é o job Ubuntu do CI.
- Um agente pode redigir a página, com `generated: AAAA-MM-DD` no cabeçalho. **Só uma pessoa
  acrescenta `verified: AAAA-MM-DD`**, depois de ler a página e conferir os arquivos citados.
  Agente nenhum deve pôr esse campo.
- Páginas sobre código que ainda vai ser substituído não se escrevem. Elas nascem quando o código
  novo é integrado.

## Como a release é travada

1. A seção `## [x.y.z]` do `CHANGELOG.md` precisa existir e ter pelo menos um item entregue.
2. Toda página de `docs/knowledge_base/` precisa de `verified: AAAA-MM-DD`, uma data de calendário
   real (`2026-02-29` e `2026-13-01` reprovam).
3. `bun src/cli.ts checar-release x.y.z` confere os dois pontos
   (`src/comandos/checar-release.ts`). Ele reprova também a pasta `docs/knowledge_base/` ausente,
   que seja arquivo ou sem nenhuma página `.md`: KB vazia não conta como revisada. O CI o roda em
   qualquer tag (`.github/workflows/ci.yml`, última etapa).

A tag é `vX.Y.Z` ou `X.Y.Z`: o CI tira o `v` da frente e o resto precisa ser SemVer 2.0.0 (sem zero
à esquerda em `1.02.3` ou `1.2.3-01`; pré-release `-rc.1` e metadados `+build.7` aceitos). Qualquer
outra forma (`release-1`, `v1.0`) faz a etapa reprovar.

A trava roda depois que a tag existe, então ela sinaliza mas não impede. Por isso o procedimento
tem esta ordem:

1. Passe o conteúdo de `[Unreleased]` para a seção `## [x.y.z] - AAAA-MM-DD` do `CHANGELOG.md`, com
   o que foi entregue e o que não foi resolvido, e deixe `[Unreleased]` vazio acima dela.
2. Rode `bun run checar` e `bun src/cli.ts checar-docs`. Os dois devem sair com 0.
3. Rode `bun src/cli.ts checar-release x.y.z` **na sua máquina, antes de criar a tag**. Ele deve
   sair com 0. Se reprovar, corrija antes de seguir; não crie a tag para ver o que o CI diz.
4. Confirme que o CI está **verde em Ubuntu, Windows e macOS no commit que vai receber a tag**. É
   a única prova de que a base roda nos três sistemas; antes disso, é só hipótese. Faça isso antes
   da tag, nunca depois.
5. Só então peça a aprovação do dono do projeto. A tag e a release saem apenas com o "sim"
   explícito dele.

A seção `[0.1.0]` já está preenchida. Enquanto nenhuma página desta pasta tiver sido revisada por
pessoa, `checar-release 0.1.0` reprova, e o motivo é só a falta de `verified`. Isso é o
comportamento esperado, e não deve ser contornado acrescentando `verified` sem revisão.

**Publicar exige aprovação explícita do dono do projeto, a cada vez** (decisão do dono do projeto
em 2026-10-23): criar tag, publicar pacote, abrir release no GitHub e enviar mudança de workflow.
Preparar a release é trabalho do contribuidor; publicá-la, não.
