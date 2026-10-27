# Changelog

Todas as mudanças relevantes do Anvilore ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada mudança acrescenta a sua linha
aqui no momento em que é feita. A release só sai com a seção da versão preenchida (veja
`bun src/cli.ts checar-release <versao>`).

## [Unreleased]

### Added

- Índice de busca FTS5 local e MCP opcional para consulta confinada à wiki, com `buscar`, `ler`,
  métricas locais agregadas e registro de usuário para Claude Code, Codex, Gemini CLI e Copilot CLI.
- Comandos `anvilore mcp ligar|desligar|estado` e `anvilore indexar [--completo]`.
- Timeout de cinco segundos por agente ao consultar registros MCP no `doctor` e em `mcp estado`.
- `anvilore metricas` usa o diretório local da raiz do clone, respeitando `ANVILORE_DIR`.
- MCP tenta sincronizar o índice novamente a cada chamada de busca após falha de inicialização.
- A abertura concorrente de um índice SQLite novo repete operações bloqueadas antes de falhar.

- O instalador e o `doctor` avisam quando falta `rg`, usado pela skill `query`, e mostram como
  obtê-lo em Windows, macOS e Linux. O aviso não reprova nem instala nada automaticamente.
- O ensaio da busca compara duas formas de procurar callouts em cada shell e no bash com
  histórico ligado, mede acentos sob codepage 850 e confere a busca por radicais sem acento.
- A busca de callouts da skill `query` usa a forma hexadecimal de `!`, provada em cmd,
  PowerShell e bash com histórico ligado. O CI reprova regressões nos comandos obrigatórios;
  limites de NFC/NFD e codepage ficam explícitos na skill e na documentação de plataformas.
- Os testes da guarda isolam suas falhas simuladas para não poluir o resumo real do CI.

- Diagnóstico da busca da skill `query` no CI de Windows, Linux e macOS: executa os comandos
  literais nos shells reais, registra a origem do `rg`, acentos NFC/NFD, páginas ignoradas e
  abertura dos caminhos citados. Divergências ficam explícitas no quadro, sem mudar a busca.
  Registra primeiro o PATH original; se faltar `rg`, usa uma versão fixa conferida por SHA-256
  apenas no diretório temporário do ensaio e a remove ao terminar.

## [0.2.0] - 2026-10-25

Tudo o que entrou na `main` depois da 0.1.0: validação, manutenção da wiki, instalador e hook em TypeScript no Bun,
rodando em Linux, Windows e macOS (CI verde nos três). Os scripts de bash e Python foram portados, menos `scripts/lib-anvilore.sh`.

### Added

- Correções do ensaio dos dez minutos. A skill `ingest` passa a gravar `generated` (`by`, `at`) em toda página que escreve,
  então logo depois do ingest o `validar` reprova com "página gerada sem aprovação humana" até a pessoa acrescentar
  `verified` com `by: human:<id>`; o README mostra esse passo. A skill também grava o log em `wiki/log/log-AAAA-MM-DD.md`
  (o `wiki/log.md` é gerado e não se edita; `query` e `lint` seguem o mesmo caminho), usa a área do `init` (ou o layout plano),
  dispensa subagentes para fonte pequena, não grava URL em `raw/` e termina rodando `bun src/cli.ts fechar wiki`.
- `anvilore init` lê o `anvilore.toml`: área fora de `areas` é recusada nomeando a área e a lista, sem criar nada, e avisa quando
  `wiki/exemplo/` ficaria fora da lista.
- `anvilore instalar` termina com "Próximo passo: reabra o agente neste clone ... e rode `bun src/cli.ts init`" na instalação
  real; a simulação diz "Nada foi alterado" e "seriam instalados".
- `init` e `validar` comparam a área com o `anvilore.toml` pela mesma política exata (sem caixa nem normalização): `areas = ["Pessoal"]`
  recusa `pessoal` já no `init`. O `doctor` só reprova a versão antiga do Claude Code quando o Claude está configurado no clone (`.claude/`).
  O README manda apagar, junto com `wiki/exemplo/`, a seção `## Área: exemplo` do `wiki/index.md`.
- `anvilore doctor` só cobra o agente que o clone configurou (pasta de configuração no destino); agente que só tem a CLI no PATH
  aparece como "encontrado, sem trava neste clone (opcional)". Sai 1 se nenhum agente do clone tem a trava.
- Comando `anvilore doctor [pasta]`: mostra, em linguagem simples, quais travas estão ligadas (proteção do `raw/` em
  cada agente, validação no fechamento da wiki, CI ou pré-commit, perfil da empresa) e o comando que liga cada uma que
  falta; confere `bun` e `git` no PATH. Sai 1 se faltar trava ou pré-requisito. Hook antigo conta como desligado.
- Comando `anvilore hook proteger-raw`: o hook que recusa escrita em `raw/` agora é TypeScript no Bun,
  no lugar de `hooks/proteger-raw.sh` (sem `jq` nem Python). Mantém os códigos 0 e 2, a mensagem de
  bloqueio e o rastro `ANVILORE_LOG_HOOK`. Passa a avaliar também o comando de terminal de cada agente
  (`>`/`>>`, `tee`, `mv`, `cp`, `rm`, `sed -i`, `touch`, `git mv`/`rm`…), bloqueia `C:\p\raw\a.md` e payload
  ilegível, e libera leitura. A reinstalação troca a entrada do hook antigo pela nova em Claude,
  Gemini e Copilot. O CI imprime a latência do hook (mediana e p95) em cada sistema.
  A rodada de correção da revisão fechou furos do terminal (pipe para `xargs`, git por lista de leitura, `cd` com
  opção, `git clean -x` e apagar ancestral de `raw/`) e a forma instalada passa a fechar no Windows (Claude
  `onFailure: "block"`, Copilot com `powershell`); o CI prova a forma gravada em cada shell.
  A rodada 2 amplia a regra do terminal (verbo de escrita em qualquer segmento de um comando que cita `raw/`), abre cada
  envolvedor com as próprias opções, resolve o ancestral de `raw/` contra o `cwd`, dá ao Codex um `command_windows`
  em PowerShell e faz o `doctor` avisar Claude Code anterior à 2.1.295.
- Comando `anvilore init`: o onboarding de áreas. Pergunta no terminal (aceitar as áreas padrão,
  tirar algumas, adicionar outras) ou recebe `--areas a,b,c`, cria `wiki/<área>/{sources,entities,concepts}`
  e termina com a mensagem de sucesso e o próximo passo. Recusa nome reservado, nome com `..`, `/`,
  `\` ou `:`, nomes proibidos no Windows (`nul`, `con`, `a<b`), nomes ocultos e nomes que só diferem
  na caixa; raiz inexistente reprova antes de escrever; repetir não altera nada. Sem terminal e sem `--areas`,
  reprova em vez de esperar.
- Comando `anvilore instalar`: configura Claude Code, Codex, Gemini e Copilot usando Bun.
  Preserva preferências, recusa conflitos, simula sem escrever e não altera arquivos ao repetir.
  As skills continuam ligadas à fonte; no Windows, diretórios usam junções. Falhas de ligação
  são explícitas, sem copiar em silêncio. O CI passa a imprimir o resultado dessas ligações.

- Comando `anvilore validar [pasta]`: o validador da wiki agora é TypeScript no Bun, no lugar dos
  scripts em bash e Python. Mantém as mesmas regras e as mesmas saídas (`VALIDACAO: PASS` ou
  `VALIDACAO: FAIL`, códigos 0 e 1) e acrescenta o que faltava: o YAML do frontmatter é lido pelo
  próprio Bun, então a checagem de proveniência nunca mais é pulada, e uma página com YAML
  ilegível reprova nomeando o arquivo.
- O validador reprova wikilink que não aponta para nenhuma página e página que não aparece no
  `index.md` (o da área, quando a área tem um; senão o da raiz). Wiki sem nenhum `index.md` passa
  com um aviso de que o índice não foi conferido. Wiki existente com link quebrado ou página fora
  do índice passa a reprovar.
- Portão humano depois da escrita: página com `generated` precisa de uma verificação humana
  (`verified` com `by: human:<id>`) igual ou posterior à geração, senão reprova como "página gerada
  sem aprovação humana". Nenhum programa prova quem escreveu a verificação.
- Perfil da empresa em `anvilore.toml` (áreas, tipos de página e campos obrigatórios permitidos).
  Página fora do perfil reprova nomeando o arquivo e o valor; arquivo inválido ou com chave
  desconhecida também reprova. Sem o arquivo, vale o `SCHEMA.md`.
- Dois arquivos da mesma pasta que só diferem na caixa (`Pagina.md` e `pagina.md`) reprovam; o slug
  é comparado com o nome do arquivo em Unicode NFC, então nome decomposto do macOS passa.

### Changed

- Integração das duas ondas de TypeScript: o fechamento e as skills usam os comandos Bun de validação e manutenção, com proteção de fontes e aprovação humana preservadas.

- O fatiamento do `wiki/log.md` em um arquivo por dia agora é o comando `bun src/cli.ts fatiar-log [WIKI]`
  (antes, `scripts/fatiar-log.py`). Mesmo comportamento: migração única que recusa rodar se algum arquivo
  de destino já existir e relata em voz alta o preâmbulo que não vai para nenhum arquivo de dia.
- A contagem dos índices de área agora é sincronizada pelo comando TypeScript
  `anvilore sincronizar-indice`, com modo `--checar` que não escreve.
- A migração de páginas para as áreas da wiki agora é o comando `bun src/cli.ts migrar-areas [WIKI] [--simular]`
  (antes, `scripts/migrar-areas.sh`). Mesmo mapa de roteamento e mesmas mensagens; usa `git mv` quando a página é
  versionada e `rename` quando não é. O que mudou: se a página existir na origem e no destino, ela não é mais
  sobrescrita (o comando relata o conflito e sai com 1); área do mapa que escapa da wiki (`..`, caminho absoluto, `\`,
  `:` ou link para fora) reprova antes de mover qualquer coisa; mapa sem marcadores e link quebrado avisam em stderr;
  falha no meio da migração é relatada com o que já foi movido, sem stack trace; `--help` mostra o uso e sai 2.
  Também mudou de propósito: página (ou mapa) que não é UTF-8 válido, como um arquivo em Latin-1 com `café`, faz o comando
  reprovar com `FAIL`, nomeando o arquivo e saindo 1, antes de mover ou reescrever qualquer página, inclusive em `--simular`; o
  script em bash preservava os bytes, e o TypeScript gravaria U+FFFD no lugar e relataria sucesso.
  A mesma regra vale para `sincronizar-indice` (índice de área que não é UTF-8 reprova antes de reescrever qualquer área, sem
  escrever nada), `indexar-log` (dia de log que não é UTF-8) e `listar-lacunas` (página que não é UTF-8): `FAIL` nomeando o
  arquivo, saída 1 e nada gravado. `fatiar-log` e `rejuntar-linhas` já eram estritos; `auditar` e as checagens de docs só leem.
- O índice do log da wiki é regenerado por `bun src/cli.ts indexar-log`, com a opção
  `--stdout` para consultar sem gravar e preservação do log do clone quando não há dias fatiados.
  O antigo `scripts/indexar-log.sh` foi removido; a linha "Gerado por" no índice regenerado agora
  aponta para o comando Bun. Arquivos de dia com CRLF mantêm a contagem correta por tipo.
  Mudou de propósito: arquivo de dia que é symlink agora entra no índice (o antigo o ignorava) e link
  quebrado gera um `AVISO:` em vez de sumir em silêncio.
- `listar-lacunas` agora roda em TypeScript no Bun; a consulta de callouts continua sem escrever
  `_meta/`, e a geração atualiza o índice de lacunas.
- `rejuntar-linhas` passou de Python para TypeScript: `bun src/cli.ts rejuntar-linhas <arquivo-ou-diretório> [--simular] [--diff]`.
  O `scripts/rejuntar-linhas.py` foi removido. Mudanças que aparecem no disco: arquivo CRLF ou com CR
  solto sem nada a rejuntar não é regravado, e o que muda mantém o fim de linha que já tinha (CRLF
  continua CRLF); arquivo com BOM mantém o frontmatter e o título intactos; extensão `.MD` em
  maiúsculas também entra na varredura de uma pasta; link simbólico quebrado dá `AVISO:` em vez de
  erro; arquivo que não é UTF-8 reprova a rodada inteira antes de escrever qualquer coisa; o
  `--diff` usa memória linear e a mensagem de opção inválida vem em português.
- A auditoria estrutural da wiki agora é `bun src/cli.ts auditar [WIKI]` (antes, `scripts/auditar-wiki.py`). Mesmas
  cinco seções, mesmas mensagens e mesmos códigos de saída (0 sem achado, 1 com achado, 2 wiki inexistente); continua
  sem escrever. Mudou de propósito: página que é symlink entra pelo caminho do link, link quebrado, symlink de
  diretório e diretório com nome de página (`x.md`) geram um `AVISO:` em vez de sumir em silêncio, e erro de leitura sai 2 com mensagem em vez de traceback;
  `--help` mostra o uso e sai 2.

- `SCHEMA.md` descreve o portão humano, o índice, o resultado dos wikilinks e o `anvilore.toml`;
  `AGENTS.md` proíbe o agente de escrever uma verificação humana por conta própria.
- O ritual de fechamento agora é o comando `bun src/cli.ts fechar [WIKI]` (antes, `scripts/fechar-wiki.sh`). Mesmos
  quatro passos, mesma ordem e mesmos tokens (`FECHAMENTO: OK`, `FECHAMENTO: FAIL no passo ...`), e para no primeiro
  que falha; chama o novo validador e as funções dos outros passos direto, sem subprocesso. O gate do log do dia
  compara a data de modificação com a meia-noite local, segue arquivo `.md` que é symlink e avisa em stderr de link
  quebrado ou de diretório symlink não seguido; erro ao varrer reprova o gate em vez de passar calado.
  `ANVILORE_PULAR_GATE_LOG=1` continua pulando só o gate. `--help` mostra o uso e sai 2.
- O teste da tabela de vereditos de `sources[].resource` virou `tests/okf-baseline.test.ts`.
- A conferência da tabela de vereditos de `sources[].resource` agora é o comando `bun src/cli.ts baseline [TSV]`
  (`src/comandos/baseline.ts`), extraído de `tests/okf-baseline.test.ts`: sai 0 sem divergência e 1 com divergência,
  nomeia a linha do TSV, mantém a fase de canário de mutação e reprova TSV ausente, vazio ou com coluna faltando;
  `--help` mostra o uso e sai 2.

### Fixed

- As verificações de porte preservam a atribuição e a detecção de conteúdo privado também depois da remoção do último script legado.

- O fechamento não cobra log por páginas rastreadas que continuam iguais ao `HEAD` depois de um clone; páginas novas, ignoradas ou editadas hoje continuam sujeitas ao gate.

- `fechar --help` e `fechar -h` mostram o uso e saem com código 0, sem tentar abrir uma wiki.

- O `doctor` confere a chamada ao validador no fechamento TypeScript; documentação e skills usam `anvilore fechar` no lugar do script removido.

- O aviso de preâmbulo do `fatiar-log` aponta para `anvilore indexar-log <wiki>`, em vez de um script removido.

- O validador ignora wikilinks dentro de código em linha que atravessa linhas, tanto nas páginas quanto no índice, sem esconder links após uma crase sem fecho.

- O hook reconhece parâmetros comuns do PowerShell e seus apelidos, como `-ErrorAction Stop` e `-ea`, e confere todos os possíveis destinos após a origem para impedir que um valor extra esconda escrita em `raw/`.

- O hook reconhece opções longas abreviadas do GNU, como `cp --target-dir=raw`, e abre corretamente envolvedores com opções abreviadas antes de julgar a escrita.

- O hook protege também cópias e movimentos para `raw/` com destino omitido no PowerShell e no cmd: o destino padrão é o diretório atual.

- O validador preserva toda a fração de segundo da proveniência: uma aprovação anterior à geração reprova mesmo dentro do mesmo milissegundo; as métricas usam a mesma precisão.

- O hook identifica o destino de `cp` pelo último operando, mesmo com opções depois dos caminhos, e continua permitindo copiar fontes de `raw/` para a wiki.

- O instalador também segue skills que são links simbólicos para diretórios.
- O instalador ignora arquivos soltos e pastas ocultas em skills, segue para os demais agentes
  após um erro e entrega o resumo com as causas das falhas. A descrição do Gemini vem só do
  frontmatter; os testes de isolamento e paridade voltaram a conferir o que o instalador faz.
- Links e imagens por referência agora têm seus destinos conferidos, inclusive quando a
  definição aparece depois do uso ou não é usada na página.
- As definições de referência são reconhecidas antes do código em linha, e o título delas é literal: crases em
  títulos de definições separadas (`[a]: x.md "Use `code"` ... `[c]: y.md "code`"`) não escondem mais a definição do meio,
  e um destino ausente nela volta a reprovar.
- A checagem de links entende destinos com parênteses balanceados, espaços entre ângulos,
  títulos entre parênteses e texto com colchetes internos, sem cortar o nome do arquivo.
- A checagem de documentação mantém links visíveis depois de crases escapadas, comentários
  sem fecho no meio da linha e comentários dentro de código em linha que atravessa linhas.
  Remover um comentário não cria uma abertura de bloco de código cercado.

### Removed

- `scripts/validar-wiki.sh`, `scripts/validar-okf.py`, `scripts/resource-baseline-check.py` e os
  testes em bash que os cobriam.

### Não resolvido nesta versão

- O Anvilore **não protege contra vazamento de documentos internos**. Ele impede que o agente grave em `raw/`, mas nada
  impede que o conteúdo de uma wiki seja copiado, enviado a um serviço externo ou lido por quem não deveria. Não use o
  Anvilore, nesta versão, como garantia de sigilo.
- A regra de que a pessoa dá o aval antes de uma ingestão gravar na wiki existe só como instrução escrita na skill.
  Nenhum script ou teste confere se o aval aconteceu; o portão humano do `validar` confere a aprovação depois da escrita,
  mas nenhum programa prova quem escreveu o `verified`.
- O hook que protege o `raw/` lê o comando de terminal como texto: comando com codificação ou ofuscação do destino
  (por exemplo `echo ... | base64 -d | sh`) passa de propósito. As classes de limite estão em
  `docs/knowledge_base/governanca.md`.
- A meta de 95% de cobertura para validação e proteção do `raw/` ainda não é imposta: o que roda é o mínimo de 80% no geral.
- `scripts/lib-anvilore.sh` ainda existe (só os testes em bash `tests/test-lib-anvilore.sh` e `tests/test-esqueleto.sh` o
  usam), e a knowledge base ainda não tem
  `arquitetura.md` nem `comandos.md`: ficam para uma próxima versão.

## [0.1.0] - 2026-10-24

Primeira versão da base nova do Anvilore, em TypeScript no Bun. Ela ainda não troca os scripts
antigos em bash e Python: eles continuam sendo o que valida a wiki e protege o `raw/`.

### Added

- Projeto em TypeScript rodando no Bun, com verificação de tipos e testes que exigem pelo menos
  80% de cobertura.
- Verificação automática (CI) configurada para rodar os testes em Linux, Windows e macOS a cada
  envio de código, sempre com a mesma versão do Bun. Ela ainda não rodou: o arquivo foi escrito,
  mas não foi enviado ao GitHub. O resultado nos três sistemas está por confirmar na primeira
  execução. As ações de terceiros do CI estão fixadas por commit, com a versão em comentário.
- Biblioteca compartilhada para ler e validar páginas da wiki. Foi escrita para funcionar igual em
  Windows, macOS e Linux, inclusive com arquivos salvos no Windows e caminhos escritos no estilo do
  Windows, e tem testes para isso. Por enquanto só rodou no Linux; a confirmação nos outros dois
  depende da primeira execução do CI.
- Comando `anvilore checar-release <versao>`. Ele reprova (sai com 1) se a seção da versão neste
  arquivo estiver ausente ou sem item entregue. Também reprova se `docs/knowledge_base/` não
  existir ou não tiver nenhuma página, ou se alguma página não tiver a data em que uma pessoa a
  revisou (`verified`), que precisa ser uma data de calendário real. A versão pedida segue a
  gramática do SemVer 2.0.0. No CI, roda em qualquer tag (o `v` da frente é opcional). Como roda depois
  que a tag existe, ele avisa, mas não impede: rode-o na sua máquina antes de criar a tag e só
  crie a tag com o CI verde nos três sistemas.
- Documentação do próprio Anvilore em `docs/knowledge_base/`, escrita para agentes que desenvolvem
  o projeto ou respondem dúvidas sobre ele, e uma seção no `AGENTS.md` que aponta para ela. As
  páginas ainda esperam a revisão de uma pessoa.
- Comando `anvilore checar-docs`. Ele reprova link quebrado e menção a arquivo inexistente nas
  páginas de `docs/knowledge_base/`, inclusive o link cujo texto passa para a linha seguinte e o
  que aponta para fora do repositório. Recusa argumento extra. Está configurado para rodar no CI em
  Linux, Windows e macOS a cada envio de código (ainda não executado).

### Fixed

- `checar-docs` respeita escapes nos links: colchete escapado é texto literal, e links reais
  com `\]` no texto ou `\)` no destino continuam sendo conferidos.
- `checar-docs` e `checar-release` não perdem mais o resto da página quando ela cita `<!--` entre
  crases (código em linha): antes, esse trecho era lido como início de comentário HTML e escondia
  as linhas seguintes, e um link quebrado depois dele passava sem aviso.
- O mesmo vale para `<!--` no texto de informação da linha que abre um bloco de código cercado
  (por exemplo ```` ```js <!-- ````): ele deixava um comentário aberto depois do bloco e um link
  quebrado posterior passava sem aviso.
- O reconhecimento de código em linha agora é um só, usado pela leitura das páginas e pelo
  `checar-docs`: crases de comprimentos diferentes (``` ``a `[x](y.md)` b`` ```) formam um único
  trecho de código, em vez de acusar um link quebrado que não existe. Também passam a valer a crase
  escapada, o comentário `<!-->`/`<!--->` e o comentário que fecha na mesma linha em que abre um
  bloco de código cercado.

### Não resolvido nesta versão

- O Anvilore **não protege contra vazamento de documentos internos**. Ele impede que o agente
  altere os arquivos originais em `raw/` pelas ferramentas de edição (o item seguinte diz o que
  fica de fora). Nada impede que o conteúdo de uma wiki seja copiado, enviado
  a um serviço externo ou lido por quem não deveria. Não use o Anvilore, nesta versão, como
  garantia de sigilo.
- O hook que protege o `raw/` só vigia as ferramentas de edição de arquivo (`Write`, `Edit` e
  `NotebookEdit`, no Claude Code). Escrita por comando de terminal não é barrada. A frase "recusa qualquer
  escrita" em alguns textos do projeto vale só para essas ferramentas.
- A regra de que a pessoa dá o aval antes de uma ingestão gravar na wiki existe só como
  instrução escrita na skill. Nenhum script ou teste confere se o aval aconteceu.
- O validador da wiki não reprova link `[[...]]` quebrado nem página que ficou fora do índice.
  Isso só aparece na auditoria da skill de lint, que não roda sozinha (nem no CI nem por hook).
- A checagem de proveniência é pulada sem nenhum aviso se o `python3` não estiver instalado. Se
  faltar só o PyYAML, ela avisa, mas não reprova.
- Os scripts que de fato validam a wiki e protegem o `raw/` ainda são bash e Python, e têm
  Linux como único alvo declarado. A meta de 95% de cobertura para validação e proteção do `raw/` ainda não é
  imposta: o que roda é o mínimo de 80% no geral.
