# Changelog

Todas as mudanças relevantes do Anvilore ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada mudança acrescenta a sua linha
aqui no momento em que é feita. A release só sai com a seção da versão preenchida (veja
`bun src/cli.ts checar-release <versao>`).

## [Unreleased]

### Added

- Comando `anvilore doctor [pasta]`: mostra, em linguagem simples, quais travas estão ligadas (proteção do `raw/` em
  cada agente, validação no fechamento da wiki, CI ou pré-commit, perfil da empresa) e o comando que liga cada uma que
  falta; confere `bun` e `git` no PATH. Sai 1 se faltar trava ou pré-requisito. Hook antigo conta como desligado.
- Comando `anvilore hook proteger-raw`: o hook que recusa escrita em `raw/` agora é TypeScript no Bun,
  no lugar de `hooks/proteger-raw.sh` (sem `jq` nem Python). Mantém os códigos 0 e 2, a mensagem de
  bloqueio e o rastro `ANVILORE_LOG_HOOK`. Passa a avaliar também o comando de terminal de cada agente
  (`>`/`>>`, `tee`, `mv`, `cp`, `rm`, `sed -i`, `touch`, `git mv`/`rm`…), bloqueia `C:\p\raw\a.md` e payload
  ilegível, e libera leitura. A reinstalação troca a entrada do hook antigo pela nova em Claude,
  Gemini e Copilot. O CI imprime a latência do hook (mediana e p95) em cada sistema.
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

- `SCHEMA.md` descreve o portão humano, o índice, o resultado dos wikilinks e o `anvilore.toml`;
  `AGENTS.md` proíbe o agente de escrever uma verificação humana por conta própria.
- O fechamento da wiki (`scripts/fechar-wiki.sh`) passa a chamar o novo validador e exige o Bun.
- O teste da tabela de vereditos de `sources[].resource` virou `tests/okf-baseline.test.ts`.

### Fixed

- O instalador também segue skills que são links simbólicos para diretórios.
- O instalador ignora arquivos soltos e pastas ocultas em skills, segue para os demais agentes
  após um erro e entrega o resumo com as causas das falhas. A descrição do Gemini vem só do
  frontmatter; os testes de isolamento e paridade voltaram a conferir o que o instalador faz.

### Removed

- `scripts/validar-wiki.sh`, `scripts/validar-okf.py`, `scripts/resource-baseline-check.py` e os
  testes em bash que os cobriam.

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
