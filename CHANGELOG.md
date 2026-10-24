# Changelog

Todas as mudanças relevantes do Anvilore ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada mudança acrescenta a sua linha
aqui no momento em que é feita. A release só sai com a seção da versão preenchida (veja
`bun src/cli.ts checar-release <versao>`).

## [Unreleased]

### Added

- Projeto em TypeScript rodando no Bun, com checagem de tipos e testes que exigem pelo menos
  80% de cobertura.
- Verificação automática (CI) que roda os testes em Linux, Windows e macOS a cada envio de
  código, sempre com a mesma versão do Bun.
- Biblioteca compartilhada para ler e validar páginas da wiki, que funciona igual nos três
  sistemas: aceita arquivos com fim de linha do Windows e com marca de ordem de bytes (BOM), e
  reconhece a pasta `raw` também em caminhos escritos no estilo do Windows.
- Comando `anvilore checar-release <versao>`: impede a release se a seção da versão no
  `CHANGELOG.md` estiver ausente ou vazia, ou se houver página da knowledge base escrita por
  agente que nenhuma pessoa revisou. No CI, roda só quando uma tag de versão é criada.

### Changed

- Nada ainda.

### Fixed

- Nada ainda.

### Não resolvido nesta versão

- O Anvilore **não protege contra vazamento de documentos internos**. Ele organiza e protege os
  arquivos originais contra alteração, mas não impede que o conteúdo de uma wiki seja copiado,
  enviado a um serviço externo ou lido por quem não deveria. Não use o Anvilore, nesta versão,
  como garantia de sigilo.
