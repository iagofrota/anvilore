# Changelog

Todas as mudanças relevantes do Anvilore ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada mudança acrescenta a sua linha
aqui no momento em que é feita. A release só sai com a seção da versão preenchida (veja
`bun src/cli.ts checar-release <versao>`).

## [Unreleased]

### Added

- Projeto em TypeScript rodando no Bun, com verificação de tipos e testes que exigem pelo menos
  80% de cobertura.
- Verificação automática (CI) que roda os testes em Linux, Windows e macOS a cada envio de
  código, sempre com a mesma versão do Bun.
- Biblioteca compartilhada para ler e validar páginas da wiki, que funciona igual em Windows,
  macOS e Linux, inclusive para arquivos salvos no Windows e para caminhos escritos no estilo
  do Windows.
- Comando `anvilore checar-release <versao>`: impede a release se a seção da versão no
  `CHANGELOG.md` estiver ausente ou sem nenhum item entregue, ou se alguma página de
  `docs/knowledge_base/` não tiver a data em que uma pessoa a revisou (`verified`). No CI, roda
  só quando uma tag de versão é criada.

### Não resolvido nesta versão

- O Anvilore **não protege contra vazamento de documentos internos**. Ele impede que o agente
  altere os arquivos originais em `raw/` pelas ferramentas de edição; escrita feita por comando
  de terminal ainda não é barrada. Nada impede que o conteúdo de uma wiki seja copiado, enviado
  a um serviço externo ou lido por quem não deveria. Não use o Anvilore, nesta versão, como
  garantia de sigilo.
