# Changelog

Todas as mudanças relevantes do Anvilore ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada mudança acrescenta a sua linha
aqui no momento em que é feita. A release só sai com a seção da versão preenchida (veja
`bun src/cli.ts checar-release <versao>`).

## [Unreleased]

### Added

- Pacotes Linux `anvilore.deb` e `anvilore.rpm`: lançador e entrada no menu para instalações por usuário, com dependências do sistema e remoção que preserva o kit e os dados.
- Setup do Windows `AnviloreSetup.exe` por usuário, com atalhos do Inno Setup e desinstalação que preserva a pasta da wiki.
- A preparação da release confere por download o SHA-256 de cada dependência dos instaladores, incluindo todas as plataformas; arquivo alterado ou indisponível impede prosseguir.
- Novos gates conferem a tag SSH pela confiança da versão anterior e exigem pacotes completos e scripts autenticados antes de gerar os hashes da distribuição.
- O preparo local mostra o que vai gerar antes de escrever e preserva artefatos existentes; o README orienta o download dos pacotes e os avisos do Windows e do Ubuntu.
- O gate da tag exige também as assinaturas públicas dos scripts, feitas offline e versionadas antes da tag; o CI verifica a confiança anterior sem receber chave privada.

### Fixed

- A ingestão só mostra estados já gravados em disco, preservando a parada e a retomada ao recarregar a interface.
- Falhas ao salvar a ingestão aparecem como erro, com orientação para retomar o último estado salvo, em vez de manter a tela em uma leitura que já terminou.
- Build Linux embute e confere manifesto, assinantes, base mínima e URL oficiais antes do nfpm, valida SemVer, exige `ssh-keygen` pelos pacotes da distribuição e só publica o par DEB/RPM após gerar ambos. Falhas de rede, HTTP, hash ou empacotamento encerram com erro.
- Atalhos do setup Windows lembram a pasta realmente escolhida para a wiki e funcionam com `/DIR` personalizado, espaços e apóstrofos, mesmo sem variáveis herdadas do Explorer.
- Reinstalar o setup Windows conserva o destino da wiki salvo no programa quando não há escolha explícita, tanto no modo interativo quanto no silencioso, em vez de criar outro kit na pasta padrão.
- Setup Windows reprova falhas de leitura e sintaxe antes da instalação; mostra o resumo com pausa na janela interativa e não espera Enter no modo silencioso.

## [0.3.0] - 2026-10-30

### Added

- Telas de Biblioteca e Nota na interface web (`anvilore ui`):
  - Biblioteca (`#/biblioteca`): catálogo de páginas da wiki com abas por tipo, contadores, filtros por status (rascunho / aprovada), área e tags, além de busca por texto;
  - Nota (`#/nota/<caminho>`): tela de leitura estrita com propriedades, corpo markdown renderizado, callouts de lacunas com link para o chat de ingestão, proveniência, backlinks e grafo local em SVG;
  - Endpoints de leitura protegidos `GET /api/biblioteca` e `GET /api/nota?caminho=...` com barreira de token, contenção de caminhos e garantia de invariância em `wiki/` e `raw/`.
- Tela Início em `anvilore ui`, agora a tela inicial: atalhos para ingerir e revisar, rascunhos esperando aprovação,
  atividade recente do log, saúde da wiki (o servidor roda `validar`, `auditar` e `listar-lacunas --consultar`; ninguém
  precisa rodar comando) e a lista do que está em `raw/` sem ingestão. Revisão e Chat seguem no menu. O menu e o casco
  comum das telas estão em `ui/web/navegacao.ts` e `ui/web/shell.tsx`; veja `docs/knowledge_base/interface.md`.

### Security

- Estado das chaves fora do GitHub: antes de aceitar uma versão, o atualizador consulta `https://anvilore.iagofrota.com.br/confianca.json` (HTTPS com certificado validado, sem seguir redirecionamento, sem cache, 15 s, 64 KiB) e só aceita chaves que **estão nas âncoras da pasta e na lista do site** (interseção; o site nunca acrescenta chave) e versões iguais ou acima da `versaoMinima`. Retirar uma fingerprint do site revoga a chave mesmo para assinatura válida. O `instalar.sh` e o `instalar.ps1` fazem a mesma consulta (URL embutida na região `URL_CONFIANCA`, `curl --proto =https --max-redirs 0` / `HttpWebRequest` sem redirecionamento, lendo em blocos e abortando acima de 64 KiB): na instalação nova antes de baixar o kit, e na reinstalação depois da base mínima e antes de executar qualquer coisa da pasta; só a interseção das chaves embutidas com a lista segue ao `verify-tag` e ao atualizador, e uma pasta instalada abaixo da `versaoMinima` é recusada sem executar nada dela. O embutir recusa um modelo sem a região. O documento é validado igual nos três: nome de campo repetido (inclusive `chaves`), qualquer barra invertida (incluindo escapes JSON) ou número de versão com mais de nove dígitos é recusado. O prazo de 15 s é total também no PowerShell, contando cabeçalhos e leituras bloqueadas; o `curl --max-time 15` do Linux já aplica o limite total. Falha ao consultar para a atualização e mantém a versão instalada. A URL é constante de build (`src/lib/confianca.ts`, região `URL_CONFIANCA` do `scripts/embutir-instalador.ts`), nunca de variável de ambiente; o embutir recusa URL que não seja https (loopback só com `--aceitar-url-de-teste`).
- Leitura de notas na interface web valida contenção por caminho real prévio, compõe flags de proteção (O_NOFOLLOW e O_NONBLOCK) de forma independente e trata raiz ausente como inexistência, evitando travamento em FIFOs e vazamentos antes da verificação TOCTOU (dev/ino).
- O atualizador exige exclusivamente assinatura SSH na tag candidata (`-----BEGIN SSH SIGNATURE-----`), fixa `gpg.ssh.program=ssh-keygen` e desabilita programas OpenPGP e x509 (`gpg.program`, `gpg.openpgp.program`, `gpg.x509.program` apontados para comando inexistente no `verify-tag`), impedindo que tags com assinaturas OpenPGP, x509 ou verificadores SSH customizados no `.gitconfig` aprovem tags não confiáveis.
- O `fetch` do atualizador (e qualquer `ls-remote`, `clone` ou `pull`) roda com `GIT_ALLOW_PROTOCOL` só do protocolo da origem oficial (https; ssh se o clone foi feito por ssh), `credential.helper` zerado, `GIT_ASKPASS` vazio e `GIT_TERMINAL_PROMPT=0`: um `protocol.ext.allow=always` com `url.<ext::programa>.insteadOf` na configuração global não executa código antes da assinatura. A configuração global continua valendo no resto (proxy, por exemplo).
- O atualizador aceita o arquivo de chaves confiáveis que o instalador entrega pela opção interna `--assinantes-do-instalador <arquivo>` e, com ele, confere a tag **só** contra esse arquivo (não soma com o `seguranca/assinantes` da pasta). Assim uma instalação que ficou para trás na troca de chave recebe a versão nova ao rodar o instalador de novo, sem editar arquivo do kit. Arquivo ausente, vazio ou ilegível recusa a versão com mensagem simples; nunca volta ao arquivo local. O atualizador **não lê nenhuma variável de ambiente** para isso: uma atualização manual ou agendada nunca troca as chaves por herança do ambiente. A opção só vale ao aplicar (junto de `--verificar`, `--voltar` ou `--estado` é uso inválido, código 2). Alcance: a opção não prova que quem chamou é o instalador (um processo local hostil pode passá-la, assim como poderia trocar o `PATH`); o ganho é que a âncora de confiança deixa de ser herdada por acidente.
- `instalar.sh` não grava nenhum arquivo da candidata antes de autenticar a tag: o clone é `--no-checkout`, os hooks ficam
  desligados no staging (`core.hooksPath` vazio) e o checkout do commit verificado só vem depois da assinatura. Assim
  filtros do git (como o do git-lfs) e hooks da configuração global não rodam sobre conteúdo não autenticado.
- `instalar.sh` fixa o verificador SSH (`gpg.ssh.program=ssh-keygen`) no `verify-tag`: um programa aprovador na
  configuração global do git não consegue mais aceitar uma tag assinada por chave fora dos assinantes.
- `instalar.sh` só deixa o git falar com a rede (`ls-remote` e `clone`) pelo protocolo da origem: `GIT_ALLOW_PROTOCOL` vale mais
  que qualquer `protocol.<nome>.allow` da configuração global, então um `url.<ext::programa>.insteadOf` não executa nada
  antes da assinatura. O `credential.helper` é zerado e não há pergunta de senha nem de terminal nessas chamadas.
- `instalar.ps1`: `ls-remote` e `clone` passam por `AnvExecutarRede`: `GIT_ALLOW_PROTOCOL` só com o protocolo da origem, `credential.helper` e `core.askPass` zerados, `GIT_ASKPASS` apontando para `false` e `GIT_TERMINAL_PROMPT=0`, tudo só durante a chamada (o ambiente volta ao que era). Um `protocol.ext.allow=always` com `url.<ext::programa>.insteadOf` na configuração global não executa nada; o instalador recusa (código 3). Ao reinstalar numa pasta já instalada, entrega ao atualizador as chaves embutidas pela opção `--assinantes-do-instalador <arquivo>` (só nessa chamada; **não** por variável de ambiente, que uma atualização manual ou agendada herdaria sem querer). Alcance: a opção não prova que quem chamou é o instalador (um processo local hostil pode passá-la, assim como poderia trocar o `PATH`); o ganho é que a âncora não é mais herdada por acidente. Se o atualizador da pasta for de uma versão antiga, que não conhece a opção (responde com o uso, código 2), o instalador para com uma mensagem simples ("A pasta tem uma versão antiga do Anvilore que não sabe receber as chaves do instalador; nada foi mudado"), com saída diferente de zero, sem tocar HEAD nem arquivos.
- Rodar o `instalar.sh` numa pasta já instalada passa pelo atualizador do kit, que agora fixa o verificador SSH: um `gpg.ssh.program` aprovador na configuração global não faz a reinstalação aplicar uma tag assinada por chave fora dos assinantes (`tests/instalar-sh-reinstalacao.test.ts`).
- Ao rodar o `instalar.sh` numa pasta já instalada, ele entrega ao atualizador as chaves de assinatura embutidas nele pela opção `--assinantes-do-instalador <arquivo>` (só nessa chamada; **não** por variável de ambiente, que uma atualização manual ou agendada herdaria sem querer): uma instalação que ficou para trás na troca de chave passa a receber a versão nova, sem editar o `seguranca/assinantes` da pasta. Alcance: a opção não prova que quem chamou é o instalador (um processo local hostil pode passá-la, assim como poderia trocar o `PATH`); o ganho é que a âncora não é mais herdada por acidente. Se o atualizador da pasta for de uma versão antiga, que não conhece a opção (responde com o uso, código 2), o instalador para com uma mensagem simples ("A pasta tem uma versão antiga do Anvilore que não sabe receber as chaves do instalador; nada foi mudado"), com saída diferente de zero, sem tocar HEAD nem arquivos.
- Os instaladores (`instalar.sh` e `instalar.ps1`) leem a versão da pasta já instalada **sem executar nada dela** e a comparam com a base mínima embutida (`instalador/base-minima`, hoje provisória `0.3.0`: a primeira versão assinada). Antes, a reinstalação executava o CLI da pasta e só depois tratava o código 2. Agora, versão menor, `package.json` ausente, ilegível ou inválido, pré-release ou com metadado de build: o instalador para com mensagem simples (saída 1), sem rodar o `cli.ts`, o `bunfig.toml` nem hooks da pasta e sem mudar HEAD nem arquivos; igual ou maior segue o fluxo de antes. A leitura é só de texto (no Linux, um trecho do próprio instalador no Bun, com a pasta de trabalho temporária; no Windows, `ConvertFrom-Json`). A mensagem do código 2 deixa de aconselhar "atualize pela pasta" (circular) e passa a indicar a pasta nova. `scripts/embutir-instalador.ts` ganhou a região `BASE_MINIMA` e a opção `--base-minima`: recusa gerar sem um `X.Y.Z` válido e o `--conferir` também confere essa região. A pasta instalada é reconhecida pelo mesmo critério nos dois sistemas (estrutura do kit: `.git`, `AGENTS.md`, `src/cli.ts`, `skills/`), sem exigir o estado da atualização. Limites: a versão lida identifica compatibilidade, não autentica um computador local comprometido; não há migração automática para a pasta nova (só texto e guia; ferramenta no backlog).

### Fixed

- `instalar.ps1` não apaga mais uma pasta `Anvilore.novo` que a pessoa tinha: o download vai para uma pasta de passagem nova e única ao lado do destino, e só ela é limpa, no sucesso e na falha. O `instalar.sh` também não apaga mais nada antes do clone.
- No Linux, o `instalar.sh` deixa `~/.local/bin` (e `~/.bun/bin`, se o Bun é o gerenciado) no PATH de um terminal novo, com um bloco marcado em `~/.profile` (e em `~/.bashrc`, `~/.zshrc`, `~/.bash_profile` e `~/.bash_login` se já existem). Antes, os hooks dos agentes podiam não achar o `bun` depois que o instalador terminava.
- `instalar.ps1` não religa mais o commit automático ao reinstalar: só a instalação nova o liga, e a reinstalação respeita a escolha gravada.
- Os dois instaladores só mantêm o commit automático ligado quando `atualizacao.json` é JSON válido e `autoCommit` é booleano `true`; estado inválido ou valor de outro tipo fica desligado.
- O bloco de PATH do Linux é gravado por substituição atômica e preserva as permissões. Com um único par de marcadores, conteúdo alterado é reparado; marcador sem par ou duplicado deixa o arquivo intacto e gera aviso. Arquivos de shell que são symlinks também ficam intactos e recebem aviso.
- Os testes do atualizador não escrevem mais no `~/.gitconfig` de quem os roda: usam um arquivo temporário escolhido por `GIT_CONFIG_GLOBAL`.
- O Início continua carregando quando `wiki/` não existe: mostra o diagnóstico de saúde, os atalhos e os arquivos de `raw/` sem ingestão.
- Wikilinks e a lista de Relacionados da Nota resolvem o slug para o caminho real; destinos ausentes ou ambíguos aparecem sem navegação.
- O atalho de lacuna abre o Chat com o texto da dúvida preenchido e aguarda a confirmação antes de enviar.
- Ao abrir outra Nota após um erro, a tela limpa a mensagem antiga e mostra o resultado do novo carregamento.
- Ao recriar o índice estrutural sem exemplos, `init` e `instalar` não incluem a área nem a página de exemplo. O manifesto da atualização declara os arquivos e esqueletos pessoais que deixam o rastreio na transição N→N+1.

### Atenção

- **Antes de atualizar um clone antigo, peça ao agente para rodar `bun src/cli.ts migrar-rastreio --puxar`.** Esta
  versão deixa de rastrear `SCHEMA.md`, `wiki/` e `raw/`, que são seus. O comando copia e confere cada arquivo, tira
  do índice do kit sem apagar e atualiza o clone devolvendo tudo no lugar. Um `git pull` direto recusa quando você
  editou um desses arquivos (nada se perde) e apaga os que não foram editados; nesse caso, `bun src/cli.ts instalar`
  ou `init` os recria a partir de `modelos/`.

- **Pasta anterior à primeira versão assinada não é atualizada no lugar pelo instalador.** Ele recusa antes de executar qualquer coisa dela e orienta: instale numa pasta nova e peça ao seu agente para trazer a wiki de forma conferida, com cópia de segurança antes. A migração acompanhada ainda não existe como ferramenta.

### Changed

- `SCHEMA.md`, `wiki/` e `raw/` saíram do rastreio do kit (`.gitignore`); os originais ficam em `modelos/`. Os testes
  montam o esqueleto a partir de `modelos/`, e o `checar-docs` confere as menções a esses caminhos pelo original.
- O gate do log no `fechar` não cobra entrada por arquivo da wiki igual, byte a byte, ao original em `modelos/`: o
  esqueleto que o `instalar` copiou hoje não é edição. `tests/test-esqueleto.sh` passa a conferir o esqueleto em
  `modelos/` e que o kit ignora `wiki/`, `raw/` e `SCHEMA.md`.

### Added

- `anvilore-abrir` (Linux) e `abrir.ps1` (Windows) abrem a interface instalada, iniciam a instalação quando há um instalador ao lado e mostram erros antes de fechar. O instalador cria o atalho Anvilore no menu do Linux e no Menu Iniciar e na Área de Trabalho do Windows.
- `instalador/instalar.sh`: instalador do Linux (x64 e arm64), base do macOS. Instala o que falta (git, Bun e rg, com
  SHA-256 conferido contra `instalador/dependencias.json`), baixa a última release, **só aceita a tag se a assinatura
  SSH bater com a chave embutida no próprio script**, liga os agentes que a pessoa tem, grava o estado da atualização
  e roda o `doctor`. Responde por /dev/tty (`curl | bash`), aceita `ANVILORE_SEM_PERGUNTAS=1` e `ANVILORE_ORIGEM`, termina
  "parcial" sem agente e continua sem rg. Rodar de novo numa pasta instalada só confere e atualiza. O atalho do menu é
  da próxima fatia (`criar_atalho` ainda não faz nada).
- `instalador/dependencias.json`: manifesto de Bun, rg e PortableGit por plataforma (URL oficial e SHA-256 conferidos).
- `scripts/embutir-instalador.ts`: gera o `instalar.sh` da release com o manifesto e a chave pública embutidos e, com
  `--conferir`, prova que a cópia embutida é igual aos arquivos. Sem chave válida não gera.
- Job `instalar-linux` (`.github/workflows/instalar-linux.yml`) e `scripts/provar-instalar-linux.sh`: instalação do zero
  e reexecução num HOME vazio, em Linux x64 e arm64, com o manifesto real.
- Procedimento de release na knowledge base (`docs/knowledge_base/release.md`): preparar a versão, assinar a tag com SSH, o que o kit instalado exige para aceitá-la, release ruim e rotação da chave, mais o texto da skill `/release` (`docs/release/SKILL.md`), que para antes de cada ação pública e pede o "sim" do dono.
- `anvilore atualizar [--verificar | --voltar | --estado]`: verifica releases publicadas, compara SemVer/canal,
  confere a assinatura SSH com a confiança local — e que o nome assinado da tag é a versão anunciada, sem
  tag leve nem aninhada — e aplica com estado retomável. Antes do checkout, recusa a versão
  que deixaria de rastrear arquivos da pessoa sem declarar a migração e a que pede Bun mais novo sem um jeito
  seguro de atualizá-lo. Guarda com SHA-256 os arquivos editados, apagados e não rastreados da pessoa e tudo o
  que o `instalar` escreve nas configurações dos agentes; depois do checkout devolve o que é da pessoa e roda
  `instalar`, `doctor` e o hook da versão ativa em subprocesso. Se `raw/` ou a wiki mudarem, o hook não
  bloquear ou o `doctor` piorar, desfaz etapa a etapa (R1–R5) e diz o que conferiu, sem prometer o que não
  mediu. `--voltar` volta para a versão anterior à última atualização bem-sucedida. SessionStart agenda
  checagem diária em segundo plano e retoma operação interrompida; a interface mostra resumo da versão,
  permite verificar, atualizar e voltar, e oferece recuperação. A operação real fica recusada até
  `seguranca/assinantes` conter a chave pública confiável do dono, sempre ancorada no kit já instalado.
- Primeira automação E2E com Playwright e Chromium: um vault, um servidor e um Claude falso isolados por teste; o fluxo de ingestão, escrita, Revisão e aprovação humana confere também os arquivos gravados.
- `anvilore versao` mostra a versão do kit e, num clone, a tag e o commit.
- `anvilore migrar-rastreio` prepara o clone para a próxima versão, que deixa de rastrear os arquivos da pessoa
  (`SCHEMA.md`, índice e log da wiki, esqueleto e exemplo de `wiki/` e `raw/`): copia cada um com SHA-256 para
  `.anvilore/migracao/`, cria o repositório próprio da wiki se faltar, tira do índice do kit sem apagar do disco e
  confere. Se parar no meio, não apaga nada e retoma na próxima vez. Com `--puxar`, atualiza o clone com `git pull`
  tirando os arquivos do caminho e devolvendo-os conferidos. O `doctor` avisa "clone a migrar" e reprova enquanto
  uma migração estiver incompleta. Manifesto de migração ilegível, fora da forma ou ausente com arquivo estacionado
  bloqueia o comando e o `doctor`, apontando a cópia, em vez de ser ignorado. Nenhum arquivo volta ao lugar sem
  conferir o SHA-256: o que não confere fica guardado ao lado como `<nome>.divergente-<id>`, e sem cópia que confira
  a migração para e aponta os caminhos.
- Os originais desses arquivos ficam em `modelos/`; `instalar` e `init` copiam de lá só o que falta, sem sobrescrever
  e sem depender do git, e o exemplo apagado pela pessoa não volta.
- Esquema único do relatório do leitor da ingestão (`skills/ingest/relatorio-leitor.schema.json`): 3 a 5
  takeaways com trecho literal e seção, páginas a criar ou atualizar, lacunas e contradições. O código
  confere o esquema, que cada trecho existe na fonte e que a ação de cada página casa com a wiki.
- `anvilore conferir-leitura <arquivo>`: a ferramenta confere o relatório do leitor antes da parada humana
  (esquema, trecho literal na fonte, páginas a criar ou atualizar na wiki, inclusive com `ANVILORE_WIKI`).
- Prompts do leitor e do escritor em `skills/ingest/leitor.md` e `skills/ingest/escritor.md`: a mesma fonte
  para a skill no terminal e para a interface. `anvilore instalar --alvo claude` gera deles os agentes
  `anvilore-leitor` (só lê) e `anvilore-escritor` (edita a wiki, sem comandos), mais as versões `-grande`;
  o `doctor` acusa agente ausente ou desatualizado.
- `anvilore rota-ingestao <fonte>`: pelo tamanho da fonte, diz se a ingestão usa a janela padrão, a grande
  (acima de 400 000 bytes) ou se é preciso dividir (acima de 1 150 000 bytes).
- Índice de busca FTS5 local e MCP opcional para consulta confinada à wiki, com `buscar`, `ler`,
  métricas locais agregadas e registro de usuário para Claude Code, Codex, Gemini CLI e Copilot CLI.
- Comandos `anvilore mcp ligar|desligar|estado` e `anvilore indexar [--completo]`.
- Timeout de cinco segundos por agente ao consultar registros MCP no `doctor` e em `mcp estado`.
- `anvilore metricas` usa o diretório local da raiz do clone, respeitando `ANVILORE_DIR`.
- MCP tenta sincronizar o índice novamente a cada chamada de busca após falha de inicialização.
- A abertura concorrente de um índice SQLite novo repete operações bloqueadas antes de falhar.
- Registros MCP com símbolos/ANSI são reconhecidos; remoção falha por agente e continua para os seguintes.
- Symlinks internos são indexados uma vez pelo caminho canônico; consultas livres preservam termos como `caminho` e `title`.
- Chat de ingestão na interface (`anvilore ui`): solte um arquivo ou cole um texto, escolha a área e aperte
  Ingerir. A fonte vai para `raw/<área>/` (nome repetido ganha sufixo, nada é sobrescrito); o leitor do Claude
  Code lê com a conta em que a pessoa já entrou, sem chave de API; a ingestão para uma vez nos takeaways e na
  lista de páginas; o escritor escreve só o que foi marcado; a própria interface roda `fechar` e mostra a
  saída real, com "N rascunhos esperam você" e o atalho para a Revisão. Um painel mostra os 7 passos, o
  Cancelar interrompe o agente, e a conversa fica gravada em `.anvilore/ui/conversas/`: fechar o navegador
  na parada e voltar continua do mesmo ponto.
- O envio de fonte pela interface recusa `raw/` ou `raw/<área>` que, por link simbólico, apontem para fora do
  vault ou de `raw/`, e o leitor manda ao Claude Code o esquema sem `$schema` e `$id`, que o `--json-schema` recusava.
- `anvilore ui` abre uma Revisão local de rascunhos com aprovação pela lógica existente, navegação por teclado e validação real da wiki. A interface usa React+TypeScript e pode desligar o autocommit durante a escrita com `ANVILORE_SEM_AUTOCOMMIT=1`.
- A Revisão alinha a aprovação à proveniência humana, preserva CRLF, mostra a URL com token, protege POST por Origin e Referrer-Policy, indexa cópias sem bloquear o event loop e deixa avisos globais sem bloquear a aprovação. O CI confere que os assets compilados estão versionados e atualizados.
- Hooks nos quatro agentes para commit opcional de páginas em `wiki/`, backup opcional no GitHub ao fim da sessão e
  sugestão de lint após cinco ingestões. Claude Code observa `raw/` com SessionStart `watchPaths` + FileChanged e
  restaura o contexto após compactação; Codex restaura o contexto após compactação. O doctor informa eventos
  indisponíveis, inclusive W14 no Copilot. Commit e backup ficam desligados até a pessoa pedir no `anvilore instalar`.
- `anvilore hooks-wiki` centraliza a lógica em TypeScript e Bun. O commit agrupa página, índice da área e log do dia;
  o backup exige upstream já configurado, não cria branches e não força atualizações remotas. O hook SessionEnd
  do Claude Code tem timeout de 15 segundos; doctor avisa se o backup estiver ligado sem upstream. No Codex e Gemini,
  o backup é melhor esforço e pode não completar. W12 no Claude Code segue a documentação, mas ainda não foi observado em execução.

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
- `instalador/instalar.ps1`: instalador do Windows 10/11 x64, sem administrador. Usa o Git da pessoa ou baixa o
  PortableGit, instala Bun e rg com SHA-256 conferido contra `instalador/dependencias.json`, baixa a última release,
  **só aceita a tag se a assinatura SSH bater com a chave embutida no próprio script**, liga os agentes, grava o estado
  da atualização, roda o `doctor` e deixa o resultado em `$LASTEXITCODE` (0 completo, 10 sem agente, 1 falhou, 2, 3 e 4
  para sistema, assinatura e download). Não pede administrador, não chama `exit`, grava o `PATH` do usuário sem expandir
  `%VARIÁVEL%` (com `reg.exe` em Constrained Language Mode), clona com `core.autocrlf=false` e escreve UTF-8. O atalho do
  Menu Iniciar é da próxima fatia (`AnvCriarAtalho` ainda não faz nada).
- `instalar.ps1`: a candidata é clonada sem checkout e sem hooks, e seus arquivos só são gravados depois de a assinatura SSH passar; o `verify-tag` fixa `gpg.ssh.program=ssh-keygen` e desliga gpg/x509 (filtros, hooks e verificadores da configuração global do git da pessoa não ajudam uma tag falsa).
- `scripts/embutir-instalador.ts` também embute o manifesto e a chave no `instalar.ps1` (`--modelo instalador/instalar.ps1`).
- Job `instalar-ps1` no CI (`windows-latest`): testes Pester das funções e prova de ponta a ponta num perfil vazio.

### Changed

- O README avisa que, no Windows, só o CI testa o kit por enquanto: ainda não houve teste numa máquina Windows de
  verdade.
- A skill `ingest` separa sempre os papéis: o leitor lê e devolve o relatório, a pessoa aprova takeaways e
  páginas numa parada só, e só então o escritor escreve. Antes, os subagentes só entravam acima de
  400 000 bytes. No Claude Code a skill despacha os agentes gerados; nos outros agentes a própria sessão faz
  os dois papéis, guiada pelos mesmos arquivos. A pessoa nunca roda comando: quem confere, aprova e fecha é
  a ferramenta.

### Fixed

- Os testes do `doctor` isolam agentes, Git, `PATH` e `HOME`; o teste do SDK MCP inicia o Bun atual sem procurar no `PATH`.
- Texto colado no Chat grava quebras de linha LF mesmo quando o navegador as envia como CRLF.
- A fronteira de `raw/` vale pelo caminho real, não só pelo texto: o hook bloqueia a escrita que, por um link na
  wiki, cairia em `raw/`, e o `conferir-leitura` recusa fonte que sai de `raw/` por link e página que sai da wiki.
  O caminho é resolvido na ordem do disco (`link/../x` no Linux e no macOS sobe a partir do alvo do link), e destino
  que não se resolve bloqueia.
- `conferir-leitura` não trava mais a ingestão de PDF e imagem: sem extrair texto, confere o resto do relatório e avisa
  que as citações não foram conferidas; a skill mostra o aviso na parada. Texto continua com a conferência estrita.
  PDF e imagem são reconhecidos também pela assinatura dos primeiros bytes, mesmo com extensão de texto.
- A Revisão só aprova se a página ainda tiver o mesmo conteúdo exibido quando a fila foi carregada; se mudou, informa e recarrega para nova revisão. Timestamps com offset só de horas aceitos pelo esquema também são reconhecidos na fila.

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
