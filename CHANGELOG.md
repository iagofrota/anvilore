# Changelog

Todas as mudanças relevantes do Anvilore ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada mudança acrescenta a sua linha
aqui no momento em que é feita. A release só sai com a seção da versão preenchida (veja
`bun src/cli.ts checar-release <versao>`).

## [Unreleased]

### Changed

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

## [0.1.0] - 2026-10-24

Primeira versão da base nova do Anvilore, em TypeScript no Bun. Ela ainda não troca os scripts
antigos em bash e Python: eles continuam sendo o que valida a wiki e protege o `raw/`.

### Added

  Mudou de propósito: arquivo de dia que é symlink agora entra no índice (o antigo o ignorava) e link
  quebrado gera um `AVISO:` em vez de sumir em silêncio.
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
