---
generated: 2026-10-31
---

# Como publicar uma release

O procedimento completo para publicar uma versão do Anvilore. É o complemento de
[contribuindo.md](contribuindo.md) (seção "Como a release é travada"), que fala da trava do CHANGELOG
e da KB; esta página acrescenta **o que o kit já instalado nas máquinas das pessoas exige** para
aceitar a versão, e a ordem segura para entregá-la.

## Resumo

1. **A chave pública de assinatura entra numa versão antes** da primeira versão que se espera ver aceita
   pelo atualizador. Sem ela, todo kit instalado recusa tudo.
2. Prepara-se a versão: CHANGELOG, `package.json`, migração, Bun, `checar`, `checar-docs`,
   `checar-release`, CI verde nos três sistemas, checklist de segurança da cadeia de confiança e
   conferência e assinatura dos instaladores.
3. A tag é **anotada e assinada com SSH**, no commit que passou no CI, e conferida com o arquivo de
   assinantes da versão **anterior** antes de sair da máquina.
4. Os instaladores gerados têm o manifesto e a chave pública embutidos e conferidos; os instaladores,
   seus hashes SHA-256 e suas assinaturas SSH (`ssh-keygen -Y sign -n file`) são publicados como assets da release.
5. Com a autorização do dono, cria-se e envia-se a tag; o workflow só cria um rascunho depois dos
   gates. A publicação do rascunho é feita pela pessoa.
6. Release ruim nunca se corrige mexendo na tag: publica-se a próxima versão de correção.

## O que o kit instalado exige de uma release

Os gates de preparação da U5 ficam em `scripts/verificar-tag-release.ts`,
`scripts/verificar-dependencias-release.ts` e `scripts/montar-assets-release.ts`.
O primeiro exige identidade e assinatura SSH da tag, HEAD correspondente, versão do pacote igual à tag
e assinantes da versão anterior filtrados pela lista atual do site. Também regenera os dois scripts de
produção e exige suas assinaturas públicas offline em `instalador/assinaturas/`, lendo fontes e
assinaturas do commit autenticado da tag (arquivo só no disco não conta). Não usa a chave da candidata como
âncora. O segundo baixa cada entrada do manifesto e calcula seu SHA-256, inclusive plataformas que o
runner não executa. O terceiro exige os cinco arquivos de distribuição, confere os scripts inteiros
contra o embutimento de produção e verifica suas assinaturas SSH no namespace file antes de escrever
SHA256SUMS e os hashes individuais. Os pacotes são autenticados pelo fluxo de distribuição; este gate
não verifica assinatura de código do exe nem assinatura de deb/rpm. Os cenários estão em
`tests/release-tag.test.ts`, `tests/release-dependencias.test.ts` e `tests/release-assets.test.ts`.
O workflow `.github/workflows/release.yml` encadeia a autenticação, os oito downloads do manifesto,
o CI completo reutilizado de `.github/workflows/ci.yml`, a instalação/reinstalação Linux x64/arm64
reutilizada de `.github/workflows/instalar-linux.yml` e os cenários de atualização em Ubuntu e Windows.
O primeiro checkout usa o commit fixo da âncora 0.3.0. O shell confere os pins do objeto e commit,
verifica a assinatura e só então faz checkout da candidata e executa seu código. CI e instalação
Linux recebem pushes de branches e PRs; numa tag só são chamados depois desse gate.

O CI também chama `.github/workflows/builds-release.yml`, nas branches e na tag autenticada. Esse
workflow prepara scripts determinísticos sem chave privada, compila DEB/RPM com versão explícita e
instalar.sh de produção, extrai os dois pacotes e compara o script empacotado byte a byte. No Windows,
confere o instalar.ps1 inteiro antes de passá-lo por caminho absoluto ao ISCC, com versão e saída
explícitas, e exige o exe gerado com a versão esperada. As provas de instalação e remoção pertencem
aos jobs Linux/Windows do CI; seus pacotes com origem local e chave descartável nunca entram nos
artefatos de produção. O exe e os pacotes não têm assinatura de código nesta versão.

O gate de atualização executa `tests/atualizar.test.ts`, `tests/atualizar-isolamento-git.test.ts` e
`tests/migrar-rastreio.test.ts`, incluindo preservação, migração, R1–R5 e retomada. Usa Git e SSH reais
descartáveis; o CLI das versões da fixture é mínimo. Isso não prova uma atualização entre dois
pacotes publicados. A instalação Linux e as provas Windows continuam no CI reutilizado, sem
substituir os jobs Playwright ou as verificações de cobertura nos três sistemas.

Só depois de todos esses gates o job assets reúne os três pacotes e os scripts do mesmo run, confere
as assinaturas offline contra a âncora anterior filtrada pelo site e gera SHA256SUMS. O único job com
permissão de escrita é rascunho: confere novamente os hashes do transporte e chama
`scripts/criar-rascunho-release.ts` com a opção explícita de criação. Esse comando exige tag remota
já existente, versão igual ao pacote, notas e o conjunto fechado dos dez assets; usa somente
`gh release create --draft --verify-tag`. Não edita release existente, não cria tag, e marca sufixos
SemVer como pré-release. A pessoa lê o rascunho e clica Publicar.

Os testes em `tests/release-workflow.test.ts` e `tests/release-montagem-workflow.test.ts` conferem
apenas grafo e configuração. `tests/release-autenticacao-workflow.test.ts` executa o shell exato de
autenticação com Git e chaves descartáveis. `tests/release-script.test.ts` cobre a comparação integral
de produção e `tests/release-rascunho.test.ts` cobre as recusas e os argumentos da criação com executor
falso. Testes de YAML e de argumentos não provam Actions, ISCC, SmartScreen ou instalação de pacotes;
essas execuções precisam de evidências próprias. Nenhuma tag de release foi executada na preparação U5.

`scripts/lancar.ts` prepara somente os scripts de produção e NOTAS.md extraído da seção datada da
versão no CHANGELOG. Sem flags ele simula, sem escrever nem fazer rede. Com `--preparar` e
`--saida` grava numa pasta de preparo, recusando sobrescrever arquivos existentes. A versão precisa
corresponder ao package.json; base mínima e chave pública são lidas sem alterá-las. Não chama Git,
GitHub nem ssh-keygen, não assina e não publica. As conferências da KB e a autorização de publicação
continuam etapas separadas. Os cenários ficam em `tests/release-preparar.test.ts`.

| Exigência | Onde está no código |
|---|---|
| A release está no GitHub, não é rascunho, e o nome da tag é `vX.Y.Z` (o `v` é opcional) com X.Y.Z em SemVer 2.0.0 estrito | `selecionarRelease`, `parsearSemVer` em `src/lib/atualizacao.ts` |
| Canal **estável** (o padrão): lê só releases/latest do repositório iagofrota/anvilore e ignora release marcada como pré-release **ou** com sufixo (`-rc.1`) | `releasesGitHub` e `selecionarRelease` em `src/lib/atualizacao.ts` |
| Canal **teste**: lê as 100 releases mais recentes. Uma versão com sufixo só vale se a release está marcada como pré-release; com sufixo e **sem** a marca, nenhum canal a enxerga | `selecionarRelease` |
| Só é candidata uma versão **mais nova** que a instalada | `selecionarRelease` e o início de `atualizar` |
| Política: na mesma versão maior e menor (correção, `0.3.0` → `0.3.1`) o kit aplica sozinho; menor ou maior pergunta; pré-release só no canal teste | `decidirPolitica` |
| A tag é **anotada** (tag leve não passa), o nome gravado dentro dela é igual ao da release, o alvo é um commit (sem tag aninhada) e a ref resolve para esse commit | `identidadeDaTag` |
| A tag é **assinada com SSH** e `git verify-tag` a aceita com o arquivo seguranca/assinantes **que já está no kit instalado** (não o da tag nova) | `verificarAssinaturaTag` |
| A versão que **deixa de rastrear** `raw/`, `wiki/`, `SCHEMA.md`, anvilore.toml ou item da lista do rastreio precisa declarar o caminho em `atualizacao/migracoes.json` (chave `deixa_de_rastrear`), lido do commit da tag; senão o kit recusa e a versão entra em `recusadas` | `lerMigracoes`, `dadosQueOCheckoutApagaria`, `src/lib/modelos.ts` (`LISTA_DO_RASTREIO`) |
| O `packageManager` do `package.json` do commit da tag não pode pedir Bun mais novo que o da pessoa: se pedir, o kit recusa (Bun da pessoa: manda rodar `bun upgrade`; Bun instalado pelo Anvilore: recusa porque a atualização do Bun ainda não existe no kit) | `bunExigido` |
| `bun.lock` ou `bun.lockb` diferente entre a versão instalada e a nova: o kit roda `bun install --frozen-lockfile` | `aplicar` |
| A versão do `package.json` do commit tem de ser igual à da tag. Quando o estado do kit não grava a versão instalada, o atualizador usa a do `package.json` e recusa o clone se ela diferir da tag em que o `HEAD` está | `atualizar` (conferência de `describe --tags --exact-match`), `src/comandos/versao.ts` |

Duas consequências práticas:

- **Uma correção (patch) é aplicada sozinha** na próxima abertura de sessão de quem usa o kit (o
  SessionStart de Claude e Codex consulta uma vez a cada 24 horas: `hooks/hooks.json`,
  `src/comandos/hooks-wiki.ts`). Trate toda release de correção como algo que vai rodar na máquina de
  todo mundo sem pedir.
- **Uma versão que deixaria de rastrear arquivos da pessoa sem declarar a migração**, ou **uma
  aplicação que falhou e foi revertida**, fica em `recusadas` naquela máquina e **nunca mais é
  reconsiderada** ("já foi recusada; aguardando outra release"). Só uma versão nova a destrava
  (`src/lib/atualizacao.ts`: recusa da migração em `aplicar`, reversão em `concluirReversao`).
- **Bun desatualizado não é recusa permanente**: `bunExigido` para a atualização sem tocar em
  `recusadas`, e o diagnóstico pede para atualizar o Bun e tentar de novo. Depois de atualizar o Bun, a
  **mesma** versão é aplicada; não é preciso publicar outra.
- Recusa por assinatura ou identidade **não** entra em `recusadas` (o objeto não foi confirmado como
  da release), mas o estado fica `recusada` até a próxima checagem, que espera 24 horas.

## Pré-requisitos (uma vez)

Os valores entre `<...>` são marcadores. **Escolher a chave e o e-mail de assinatura é decisão do
dono**; a chave **privada** nunca sai da máquina, não entra no repositório e nunca fica escrita em arquivo versionado nem nesta página; já a chave **pública** é versionada em seguranca/assinantes para que o kit instalado possa verificar as tags.

### 1. Chave SSH de assinatura

Na máquina de quem assina (o dono):

```bash
ssh-keygen -t ed25519 -C "<EMAIL-DE-ASSINATURA>" -f <CAMINHO-DA-CHAVE-PRIVADA>
```

Use senha na chave. A privada nunca sai da máquina, não entra no repositório e não se imprime. O
atualizador **não usa a privada**: só a pública, no kit (`docs/knowledge_base/decisoes.md`,
"Atualização automática do kit").

### 2. Chave pública em seguranca/assinantes

O arquivo usa o formato OpenSSH `allowed_signers`: `<principal> namespaces="git,file" <tipo> <chave-pública>`.
Na raiz do kit:

```bash
mkdir -p seguranca
printf '%s namespaces="git,file" %s\n' "<EMAIL-DE-ASSINATURA>" "$(cut -d' ' -f1,2 <CAMINHO-DA-CHAVE-PRIVADA>.pub)" >> seguranca/assinantes
```

O formato aceita os namespaces `git` (para tags do Git) e `file` (para assinatura dos arquivos dos instaladores), separados por vírgula. A decisão do projeto é que o principal seja **igual ao e-mail de assinatura do Git**. No ensaio (Git
2.43, OpenSSH 9.6) o `verify-tag` aceitou também uma tag cujo e-mail de tagger difere do principal;
isso é comportamento daquela versão do Git, não uma garantia: mantenha os dois iguais.

Esse arquivo é versionado no kit e **vai para as máquinas junto com a versão em que entra**. É isso
que o atualizador consulta, no kit que já está instalado.

### 3. Configuração de assinatura do clone de quem publica

No clone onde a tag será criada:

```bash
git config user.email "<EMAIL-DE-ASSINATURA>"
git config gpg.format ssh
git config user.signingkey <CAMINHO-DA-CHAVE-PRIVADA>
```

(Com a chave em um `ssh-agent`, o Git aceita o caminho da `.pub` em `user.signingkey`; o ensaio usou o
caminho da privada.)

### 4. A ordem que faz a confiança fechar

A versão `0.2.0` não tem atualizador nem seguranca/assinantes (conferido na tag: nenhum dos dois
existe nela). Portanto:

1. A primeira versão que traz o atualizador **e** a chave pública é a **base mínima**: o número dela
   vai para `instalador/base-minima` no preparo da release (o valor de hoje, `0.3.0`, é provisório) e
   os instaladores o embutem. **Não há release de transição**: uma pasta anterior (a `0.2.0` ou um
   clone intermediário) não é atualizada no lugar e o CLI antigo dela nunca é executado para descobrir
   se serve. Os instaladores leem a versão do `package.json` da pasta como texto e, se for menor que a
   base (ou ausente, ilegível, inválida, pré-release), recusam antes de tocar em qualquer coisa. Quem
   tem uma pasta anterior instala numa pasta nova e pede ao agente para trazer a wiki de forma
   conferida, com cópia de segurança antes; essa migração assistida ainda não é uma ferramenta
   (backlog). Assine a tag da base mínima também, para que se possa conferir.
2. **Só depois** dela, as versões seguintes (assinadas pela chave que já está nas máquinas) são
   verificadas e aplicadas pelo atualizador.
3. Se uma versão for assinada por uma chave que **não** está no arquivo do kit instalado, ela é
   recusada, mesmo que a chave nova venha dentro dela. Isso é proposital: a chave da candidata não é
   confiável (`verificarAssinaturaTag`; cenário em `tests/atualizar.test.ts`).

Sem seguranca/assinantes (ausente, vazio ou ilegível), o kit recusa toda candidata e diz o motivo.

**Segurança no bootstrap do instalador:** conferir apenas a tag Git não autentica o instalador
executado por quem instala pela primeira vez. Para fechar a cadeia de confiança antes da primeira execução:
1. A chave pública e a base mínima embutidas no instalador gerado precisam ser idênticas a seguranca/assinantes e a instalador/base-minima (conferidas por `bun scripts/embutir-instalador.ts --conferir <script>`).
2. Cada instalador gerado (dist/instalar.sh e dist/instalar.ps1) deve ter seu SHA-256 e sua assinatura SSH (`ssh-keygen -Y sign -n file`) publicados junto da release.
3. Quem baixa o instalador confere o hash e a assinatura (`ssh-keygen -Y verify`) contra a chave pública obtida por canal independente **fora do repositório e fora do GitHub** (o README do próprio repositório não é canal independente; a âncora deve residir fora desse domínio, como site pessoal do mantenedor ou registro público verificado ; o canal é o site do Anvilore, https://anvilore.iagofrota.com.br, que mostra a impressão digital e serve o arquivo `assinantes` (decisão do dono, 2026-10-30)).

## Passo a passo de cada release

`vANTERIOR` é a última release publicada e `X.Y.Z` a nova. Os passos de "Preparar" (1 a 8) só mudam
arquivos e conferem; as três ações de "Publicar" tornam algo público e exigem o "sim" do dono, **uma
por vez**.

### Preparar

1. **Versão.** Escolha a próxima SemVer. Sufixo (`-rc.1`) significa pré-release (Ação 3).
2. **CHANGELOG.** Passe `[Unreleased]` para `## [X.Y.Z] - AAAA-MM-DD`, com o que foi entregue e o que
   não foi resolvido, e deixe `[Unreleased]` vazio acima. Linguagem simples (quem lê é o gestor).
3. **`package.json`.** O campo `version` é `X.Y.Z`, igual à tag (veja a tabela acima).
4. **Migração.** Liste o que esta versão remove do rastreio dos dados da pessoa:

   ```bash
   git diff --name-only --diff-filter=D --no-renames vANTERIOR HEAD -- raw wiki SCHEMA.md anvilore.toml
   ```

   Saída vazia: nada a declarar. Saída com caminhos: cada um precisa estar coberto por
   `deixa_de_rastrear` em `atualizacao/migracoes.json` **no commit da tag**; sem isso o kit recusa a
   versão e ela fica em `recusadas`. O arquivo atual lista a transição que deixou `SCHEMA.md`, `wiki/` e
   `raw/` fora do rastreio; entrada que o kit já não rastreia é inofensiva (a migração só age no que ainda
   está rastreado: `migrarRastreio`, "Nada a migrar", em `src/lib/migracao.ts`).
5. **Bun mínimo.**

   ```bash
   git diff vANTERIOR HEAD -- package.json | rg "^[+-].*packageManager"
   ```

   Sem saída: o Bun exigido não mudou. Se subiu, quem tem Bun mais antigo é recusado: evite subir o Bun
   numa correção, e registre no CHANGELOG, em "Atenção", que é preciso rodar `bun upgrade`.
6. **Conferências locais**, as três com saída 0:

   ```bash
   bun run checar
   bun src/cli.ts checar-docs
   bun src/cli.ts checar-release X.Y.Z
   ```

   `checar-release` reprova enquanto houver página da KB sem `verified: AAAA-MM-DD`. **Só uma pessoa
   põe esse campo, depois de ler a página** (`docs/knowledge_base/contribuindo.md`); agente nenhum o
   escreve, e a reprovação não se contorna. Esta própria página nasce sem `verified`.
7. **Checklist de bloqueio da cadeia de confiança.** Não publicar enquanto houver achado de
   segurança ALTO ou MÉDIO aberto nos instaladores ou no atualizador, com revisão de outro modelo
   registrada. Não publique se houver vulnerabilidades em aberto na cadeia (como execução de
   filtros antes da verificação da tag ou configuração global interferindo no verificador).
8. **Gerar e conferir os instaladores.**
   Gere os scripts com manifesto, assinantes e base mínima (`instalador/base-minima`, um `X.Y.Z`; sem valor válido o comando recusa gerar) embutidos:

   ```bash
   bun scripts/embutir-instalador.ts --modelo instalador/instalar.sh --assinantes seguranca/assinantes --saida dist/instalar.sh
   bun scripts/embutir-instalador.ts --conferir dist/instalar.sh --assinantes seguranca/assinantes
   bun scripts/embutir-instalador.ts --modelo instalador/instalar.ps1 --assinantes seguranca/assinantes --saida dist/instalar.ps1
   bun scripts/embutir-instalador.ts --conferir dist/instalar.ps1 --assinantes seguranca/assinantes
   ```

   O `--conferir` confirma que a chave, o manifesto, a base mínima e a URL da lista de chaves embutidos batem exatamente com seguranca/assinantes, instalador/dependencias.json, instalador/base-minima e a constante de src/lib/confianca.ts (sempre https; o modelo sem a região URL_CONFIANCA é recusado).
9. **Assinar e gerar hashes dos instaladores.**
   Gere o hash SHA-256 (executado dentro de `dist` para que o checksum registre apenas o nome do arquivo, permitindo conferência na pasta de download) e a assinatura SSH (`ssh-keygen -Y sign -n file`) de cada instalador gerado:

   ```bash
   (cd dist && sha256sum instalar.sh > instalar.sh.sha256)
   ssh-keygen -Y sign -f <CAMINHO-DA-CHAVE-PRIVADA> -n file dist/instalar.sh
   (cd dist && sha256sum instalar.ps1 > instalar.ps1.sha256)
   ssh-keygen -Y sign -f <CAMINHO-DA-CHAVE-PRIVADA> -n file dist/instalar.ps1
   ```

   As assinaturas SSH **públicas** ficam em `instalador/assinaturas/`, com os nomes
   instalar.sh.sig e instalar.ps1.sig. Copie-as depois de assinar os scripts finais:

   ```bash
   mkdir -p instalador/assinaturas
   cp dist/instalar.sh.sig instalador/assinaturas/instalar.sh.sig
   cp dist/instalar.ps1.sig instalador/assinaturas/instalar.ps1.sig
   git add -- instalador/assinaturas/instalar.sh.sig instalador/assinaturas/instalar.ps1.sig
   ```

   Elas precisam estar no commit antes da tag. A geração real ocorre numa etapa de release separada,
   depois de fontes e versão finais; não faz parte do build nem da execução comum do CI. O CI recebe
   somente as assinaturas públicas, sem chave privada. Não há ciclo: `scripts/embutir-instalador.ts`
   e `scripts/lancar.ts` não leem essa pasta para calcular os scripts. Alterar uma entrada do build
   depois de assinar exige regenerar a assinatura. O contrato está em `instalador/assinaturas/README.md`.
   Para 0.3.1, a âncora aprovada é o arquivo de assinantes da **0.3.0**; a base mínima e a versaoMinima
   do site continuam em 0.3.0. `scripts/verificar-tag-release.ts` confere tag e ambas as assinaturas
   contra essa confiança anterior, filtrada pelo site. Ausência, divergência ou assinatura não
   confiável impede prosseguir até o rascunho. Uma branch comum prova esses casos com chaves
   descartáveis (`tests/release-tag.test.ts`), sem exigir as assinaturas reais antecipadamente.

   Para conferir diretamente a assinatura de arquivo, use uma cópia temporária dos assinantes
   confiáveis, com o namespace `file` (o arquivo do kit limita tags ao namespace `git`):

   ```bash
   git show vANTERIOR:seguranca/assinantes > <ASSINANTES-ANTERIORES>
   sed 's/namespaces="git"/namespaces="file"/' <ASSINANTES-ANTERIORES> > <ASSINANTES-DE-ARQUIVO>
   ssh-keygen -Y verify -f <ASSINANTES-DE-ARQUIVO> -I "<EMAIL-DE-ASSINATURA>" -n file -s dist/instalar.sh.sig < dist/instalar.sh
   ssh-keygen -Y verify -f <ASSINANTES-DE-ARQUIVO> -I "<EMAIL-DE-ASSINATURA>" -n file -s dist/instalar.ps1.sig < dist/instalar.ps1
   ```

   Ambos devem retornar `Good "file" signature` e sair com 0. Essa conferência direta não consulta
   revogações; o gate da tag consulta a lista atual do site, além de verificar as assinaturas.
10. **CI verde nos três sistemas, no commit que vai receber a tag** (o commit já deve estar na `main`):

   ```bash
   gh run list --commit <COMMIT> --workflow ci --json databaseId,status,conclusion
   gh run view <ID-DA-EXECUCAO> --json jobs --jq '.jobs[] | [.name, .status, .conclusion] | @tsv'
   ```

   Os jobs `testes (ubuntu-latest)`, `testes (windows-latest)` e `testes (macos-latest)` precisam estar
   `completed` com `success` (`.github/workflows/ci.yml`); confira também os cinco jobs "Playwright Chromium (1/5)" a "(5/5)" (job `e2e-chromium` do workflow).
   Pendente, ausente ou vermelho: pare.
11. **Máquina de quem assina.** Confira antes de pedir o "sim":

   ```bash
   git config --get gpg.format
   git config --get user.signingkey
   ssh-keygen -l -f <CAMINHO-DA-CHAVE-PRIVADA>.pub
   git show vANTERIOR:seguranca/assinantes | rg -F "$(cut -d' ' -f1,2 <CAMINHO-DA-CHAVE-PRIVADA>.pub)"
   ```

   `gpg.format` tem de ser `ssh` e `user.signingkey` tem de apontar para a chave. A impressão digital
   é da pública (nunca se imprime a privada). O último comando tem de imprimir a linha do dono e sair com
   0: prova que a chave **já está** em `vANTERIOR` (veja "A ordem que faz a confiança fechar").

   **Exceção: a primeira release assinada (bootstrap).** Se `vANTERIOR` é a `0.2.0`, ou outra versão
   sem seguranca/assinantes, o último comando falha porque o arquivo não existe nela, e não por chave
   errada. Só nesse caso, e com um "sim" do dono **específico para o bootstrap**, confira contra o
   arquivo que a própria release traz:

   ```bash
   git show vANTERIOR:seguranca/assinantes   # tem de falhar: o arquivo não existe na anterior
   git show <COMMIT>:seguranca/assinantes | rg -F "$(cut -d' ' -f1,2 <CAMINHO-DA-CHAVE-PRIVADA>.pub)"
   ```

   O primeiro comando tem de falhar; se ele imprimir um arquivo, não há bootstrap e vale a regra de
   cima. O segundo tem de imprimir a linha do dono. Mostre ao dono a impressão digital
   (`ssh-keygen -l`) para ele comparar com a chave que publicou no canal fora do GitHub. Essa release
   é aplicada à mão, não pelo atualizador (item 1 de "A ordem que faz a confiança fechar"). Da release
   seguinte em diante, a conferência volta a ser sempre contra `vANTERIOR`.

Antes de passar ao publicar, o resumo ao dono diz: versão, commit, o que mudou, resultado das
conferências, checklist de segurança, conferência dos instaladores e assinaturas, os três jobs do CI e a impressão digital da chave.

### Publicar (cada ação com o "sim" do dono)

**Ação 1 — criar a tag assinada** (local, ainda não pública):

```bash
git tag -s vX.Y.Z -m "Anvilore X.Y.Z" <COMMIT>
git cat-file -t vX.Y.Z
git cat-file tag vX.Y.Z | sed -n 1,4p
```

O tipo tem de ser `tag` (anotada), o cabeçalho tem de trazer `type commit` e `tag vX.Y.Z`. `-s` já a
torna anotada. Confira a assinatura com o arquivo da **versão anterior**, que é o que as máquinas têm:

```bash
git show vANTERIOR:seguranca/assinantes > <ARQUIVO-TEMPORARIO-DE-ASSINANTES>
git -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile=<ARQUIVO-TEMPORARIO-DE-ASSINANTES> verify-tag vX.Y.Z
```

Tem de imprimir `Good "git" signature` e sair com 0. Se falhar, **não envie**: apague a tag *local*
(`git tag -d vX.Y.Z`, só enquanto ela não saiu da sua máquina) e descubra a causa (chave, e-mail,
arquivo da versão anterior).

Na primeira release assinada (bootstrap aprovado pelo dono no item 11), `vANTERIOR` não tem o
arquivo. Confira com o da própria release; as demais regras ficam iguais:

```bash
git show <COMMIT>:seguranca/assinantes > <ARQUIVO-TEMPORARIO-DE-ASSINANTES>
git -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile=<ARQUIVO-TEMPORARIO-DE-ASSINANTES> verify-tag vX.Y.Z
```

**Ação 2 — enviar a tag.** Sem `--force`, sem `+`, só esta tag:

```bash
git push origin refs/tags/vX.Y.Z
git ls-remote origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
```

O `ls-remote` mostra dois ids: o da tag e, com `^{}`, o do commit da release. Os dois têm de ser
diferentes (tag anotada) e o segundo tem de ser `<COMMIT>`. O CI roda `checar-release` na tag
(`.github/workflows/ci.yml`, última etapa do job `testes`).

**Ação 3 — conferir o rascunho automático e publicar pela pessoa.**

Depois do envio da tag, o workflow de release executa todos os gates e cria somente um rascunho.
As notas vêm da seção datada do CHANGELOG, e os assets são AnviloreSetup.exe, anvilore.deb,
anvilore.rpm, instalar.sh, instalar.ps1, os dois hashes individuais, as duas assinaturas SSH públicas e
SHA256SUMS. O arquivo NOTAS.md é usado como corpo da release, não como asset público.

```bash
gh run list --repo iagofrota/anvilore --workflow release --json databaseId,headSha,status,conclusion
gh release view vX.Y.Z --repo iagofrota/anvilore --json tagName,isDraft,isPrerelease,url
```

Exija CI e release completos com sucesso no commit da tag, todos os dez assets presentes,
`isDraft: true` e o canal correto. Qualquer falha deixa a distribuição sem rascunho; não a contorne
criando release manualmente. O comando de criação recusa transporte incompleto ou divergente, usa
`--verify-tag` e não aceita substituir uma release existente. Uma tag publicada permanece imutável.
Versão com sufixo recebe `--prerelease`; a estável fica sem essa marca.

O dono lê as notas e clica **Publicar**. Só então as instalações podem enxergar a nova versão.

### Conferir o instalador antes de executar

Quem faz o primeiro download obtém a chave pública por canal independente **fora do GitHub e fora do repositório** (o README do repositório não é canal independente, pois um atacante que comprometesse o repositório alteraria o instalador e o README juntos; a âncora deve ser externa, como site do mantenedor ou registro público verificado ; o canal é o site do Anvilore, https://anvilore.iagofrota.com.br, que mostra a impressão digital e serve o arquivo `assinantes` (decisão do dono, 2026-10-30)). A pessoa grava essa chave em um arquivo local `assinantes` (ex.: `echo "<EMAIL-DO-MANTENEDOR> namespaces=\"file\" <CHAVE-PUBLICA>" > assinantes` ou sem a opção de namespace).
A pessoa confere o hash SHA-256 e a assinatura SSH antes de rodar:

No Linux:
```bash
sha256sum -c instalar.sh.sha256
ssh-keygen -Y verify -f assinantes -I "<EMAIL-DO-MANTENEDOR>" -n file -s instalar.sh.sig < instalar.sh
```

No Windows (PowerShell):
```powershell
$hashEsperado = (Get-Content .\instalar.ps1.sha256).Trim().Split()[0]
$hashCalculado = (Get-FileHash .\instalar.ps1 -Algorithm SHA256).Hash
if ($hashCalculado.ToLower() -ne $hashEsperado.ToLower()) {
    throw "Hash SHA-256 não confere: esperado $hashEsperado, obtido $hashCalculado"
}
cmd /c "ssh-keygen -Y verify -f assinantes -I <EMAIL-DO-MANTENEDOR> -n file -s instalar.ps1.sig < instalar.ps1"
if ($LASTEXITCODE -ne 0) { throw "Assinatura SSH do instalador inválida!" }
```

(O redirecionamento nativo via `cmd /c` é necessário porque o pipe do PowerShell acrescenta quebras de linha e converte o stdin para ASCII no Windows PowerShell 5.1, corrompendo a validação da assinatura).

A saída `Good "file" signature` e a ausência de exceções confirmam que o instalador está autêntico e íntegro.

### Depois de publicar

Para uma release estável:

```bash
gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url
gh api repos/iagofrota/anvilore/releases/latest | bun -e 'import { selecionarRelease } from "./src/lib/atualizacao"; const r = JSON.parse(await Bun.stdin.text()); console.log(JSON.stringify(selecionarRelease("<VERSAO-ANTERIOR>", [r], "estavel")))'
```

Para uma pré-release (ex.: `vX.Y.Z-rc.1`):

```bash
gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url
gh api "repos/iagofrota/anvilore/releases?per_page=100" | bun -e 'import { selecionarRelease } from "./src/lib/atualizacao"; const r = JSON.parse(await Bun.stdin.text()); console.log(JSON.stringify(selecionarRelease("<VERSAO-ANTERIOR>", r, "teste")))'
```

A primeira consulta confere o estado no GitHub (`isDraft` falso, e `isPrerelease` falso na estável ou verdadeiro na RC).
A segunda roda o **mesmo `selecionarRelease` do kit** sobre a resposta real da API:
- Para versão estável, consulta a rota releases/latest (ou via `gh api repos/iagofrota/anvilore/releases/latest`) e o canal `"estavel"`;
- Para pré-release (RC), consulta a lista de releases (/releases com `per_page=100`, via `gh api "repos/iagofrota/anvilore/releases?per_page=100"`) e o canal `"teste"`. A rota latest e o canal estável ignoram versões com sufixo ou marcadas como pré-release (`src/lib/atualizacao.ts`), portanto checar releases/latest numa RC não confirmaria a versão candidata.

A saída JSON deve mostrar a tag e versão novas. Para provar o caminho inteiro (busca da tag, assinatura, identidade, migração e aplicação) em uma máquina descartável, siga os cenários de `tests/atualizar.test.ts`, que usam Git, tags SSH e checkout reais (`tests/apoio/kit-atualizavel.ts`).

## Release ruim

**Nunca mova, reaponte, apague-e-recrie nem force o envio de uma tag já publicada.** Motivos
verificáveis no código:

- Quem já aplicou a versão está nela e o atualizador **não busca de novo** a tag da versão instalada
  nem de anterior (`atualizar`, a conferência de "mais nova que a instalada" antes do `fetch`). Uma tag
  reapontada no GitHub não chega a essas máquinas e separa quem instalou antes de quem instala depois: duas
  máquinas com a mesma versão e commits diferentes.
- Quem recusou a versão a tem em `recusadas`: reapontar a tag não a destrava.

O que fazer, sempre com o "sim" do dono nas ações públicas:

1. Publique a **próxima versão de correção** (`X.Y.(Z+1)`) com o mesmo procedimento. O kit escolhe a
   mais nova, então ela passa por cima da ruim.
2. Para quem ainda não recebeu a ruim: edite a release ruim para sumir do canal estável com
   `gh release edit vX.Y.Z --prerelease` (ou `--draft`, que a esconde de todos) e confirme com
   `gh api repos/iagofrota/anvilore/releases/latest` quem passou a ser a "latest". Isso muda a release, não a
   tag.
3. Para quem já aplicou: `bun src/cli.ts atualizar --voltar` (o agente roda isso por eles) volta para
   a versão anterior à última atualização bem-sucedida e marca a ruim como recusada. Só age se o `HEAD`
   ainda for o commit dessa atualização (`voltar` em `src/lib/atualizacao.ts`). Uma atualização que falha
   no meio (doctor pior, hook não bloqueia, `raw/` ou wiki mudou) já é desfeita sozinha e a versão entra
   em `recusadas`.
4. Registre no CHANGELOG, na versão de correção, o que houve, em linguagem simples.

## Estado das chaves no site (confianca.json)

A assinatura SSH prova que a tag foi assinada por uma chave em que a pasta já confia. Para **revogar** uma
chave sem esperar que todas as máquinas atualizem, o atualizador consulta, antes de aceitar uma versão, um
arquivo pequeno publicado fora do GitHub: `https://anvilore.iagofrota.com.br/confianca.json` (constante
`URL_CONFIANCA` em `src/lib/confianca.ts`; **nunca** vem de variável de ambiente).

```json
{ "formato": 1, "chaves": ["SHA256:<fingerprint do ssh-keygen -lf>", "..."], "versaoMinima": "x.y.z" }
```

- Validação estrita: campo extra, tipo errado, `formato` diferente de 1, `chaves` vazia ou repetida, fingerprint
  fora de `SHA256:<43 caracteres base64>` ou `versaoMinima` com pré-release recusam.
- A consulta é HTTPS com certificado validado, **sem seguir redirecionamento** (redirect = recusa), com
  `Cache-Control: no-cache` e `Pragma: no-cache`, prazo total de parede de 15 s e 64 KiB. Não há cache local nem fallback
  offline. Falha de rede, TLS, HTTP diferente de 200, formato ou tamanho: a atualização para com "não consegui
  conferir a lista atual de chaves em <URL>; nada mudou; tente de novo mais tarde" e a versão instalada fica.
- Antes do `verify-tag`, o atualizador monta um allowed_signers **temporário** só com as linhas das âncoras
  (as de seguranca/assinantes; as do arquivo da opção `--assinantes-do-instalador`, quando ela é usada) cuja
  fingerprint está em `chaves`: a **interseção**. O site nunca acrescenta uma chave. Interseção vazia recusa.
- Candidata abaixo de `versaoMinima` é recusada (`recusada`, sem entrar em `recusadas`).
- A consulta vale na verificação e na aplicação, nos dois caminhos (comum e com `--assinantes-do-instalador`),
  e só quando há uma versão candidata.

**Publicar** (o dono, no projeto do Cloudflare **separado** do blog, por upload direto, sem ligação com o GitHub):

1. Edite confianca.json e confira cada fingerprint com `ssh-keygen -lf <publica>` e com a que está no
   arquivo seguranca/assinantes da versão que vai sair.
2. Publique junto um arquivo `_headers` com /confianca.json e `Cache-Control: no-store`.
3. **Faça o purge do cache do Cloudflare depois de cada mudança** e confira com `curl -sI` que a resposta
   não vem de cache.
4. Rotação em duas fases: as **duas** chaves ficam na lista durante a transição; só retire a antiga depois
   que a versão de transição estiver nas instalações-alvo.
5. Comprometimento: **retire a fingerprint imediatamente** e faça o purge. Quem consultar deixa de aceitar a
   chave, mesmo que a assinatura seja válida.

Limites: a proteção assume domínio, TLS e Cloudflare íntegros (um host comprometido junto da chave de
assinatura serve o estado que quiser); o site fora do ar impede atualizar, não usar a wiki atual; e um
atualizador que saiu sem esta consulta nunca a ganha depois.

Os instaladores (instalar.sh e instalar.ps1) fazem a mesma consulta, com a URL **embutida** (região URL_CONFIANCA, que o
embutir sempre preenche com a constante e recusa se o modelo não a tem):

- **Instalação nova:** consulta depois de descobrir a tag e **antes de baixar** o kit; só a interseção da chave embutida com
  a lista vai ao `verify-tag`; chave fora da lista, versão da tag abaixo da `versaoMinima` ou falha da consulta param sem
  criar a pasta. A obtenção do próprio instalador deve ser conferida com a chave que a lista autoriza agora.
- **Reinstalação:** vem **depois** da base mínima (lida sem executar a pasta) e **antes** de qualquer execução da pasta;
  entrega ao atualizador, pela opção `--assinantes-do-instalador`, só as linhas embutidas autorizadas pela lista; e uma
  pasta instalada **abaixo da `versaoMinima`** da lista também é recusada sem executar nada dela.
- No sh a consulta é `curl --proto =https --max-redirs 0 --max-time 15 --max-filesize 65536` com `Cache-Control` e
  `Pragma`; no ps1, `HttpWebRequest` sem redirecionamento, com 15 s de parede no total (incluindo cabeçalhos e leituras), lendo o corpo em blocos e abortando ao passar de 64 KiB. O `curl --max-time 15` do sh também limita o tempo total. O documento é validado de forma estrita nos dois e recusa nome repetido ou qualquer barra invertida (`\`), inclusive escapes JSON; o atualizador aplica a mesma regra.
- Build de **teste**: `--url-confianca http://127.0.0.1:<porta>/... --aceitar-url-de-teste` (só loopback; qualquer outro
  http é recusado pelo embutir e pelo `--conferir`). Os testes usam `scripts/servir-confianca-teste.ts`. **Nunca numa
  release:** o par de flags de teste serve só para gerar e conferir artefatos de teste; a conferência da release roda
  SEM `--url-confianca` e SEM `--aceitar-url-de-teste`, e um instalador com a URL de loopback é recusado nela.

## Rotação e revogação da chave

O arquivo de assinantes pode ter **várias linhas**; qualquer chave listada assina. Quem confia é o que
já está instalado, então toda troca atravessa duas versões.

**Rotação planejada**

1. Gere a nova chave (pré-requisito 1) e acrescente a linha dela em seguranca/assinantes **mantendo a
   antiga**.
2. Publique uma versão **assinada pela chave antiga** que contenha as duas linhas. As máquinas a
   aceitam, e passam a ter as duas chaves.
3. Só passe a assinar com a nova chave (`git config user.signingkey` para a nova) quando **todas as
   instalações-alvo** tiverem atualizado para a versão de transição.
4. Numa versão posterior, assinada pela nova, remova a linha antiga.

Passar ao passo 3 sem que a versão do passo 2 esteja em todas as instalações faz quem ficou para trás
recusar as tags novas (chave desconhecida).

**Recuperação de instalações que ficaram para trás:**
Se alguma máquina não recebeu a versão de transição e a rotação avançou para a chave nova, o atualizador automático daquela máquina recusa a versão (chave desconhecida).
**Nunca faça `git checkout` manual direto**: o checkout manual pula o atualizador, não executa a migração de rastreio (`atualizacao/migracoes.json`) e pode sobrescrever ou remover arquivos pessoais (`raw/`, `wiki/`, `SCHEMA.md`).

Isto vale para pastas **na base mínima ou acima dela**. Uma pasta **anterior** à base mínima (a `0.2.0` ou um clone intermediário) o instalador recusa antes de executar qualquer coisa dela; para essas, o caminho é "pasta nova + migração assistida": instalar o Anvilore numa pasta nova com o instalador verificado e pedir ao agente que traga a wiki de lá para cá de forma conferida (cópia de segurança antes, conferência depois), sem apagar nem renomear a pasta original. Não use `git checkout` nem `migrar-rastreio --puxar` como bootstrap: eles não provam a cadeia de assinatura. A ferramenta que automatize essa migração é backlog.

O caminho seguro de recuperação é a **reinstalação com o instalador verificado**:
Baixe o instalador da versão mais recente (instalar.sh no Linux ou instalar.ps1 no Windows), confira seu hash SHA-256 e sua assinatura SSH contra a chave pública obtida por canal independente fora do GitHub (veja "Segurança no bootstrap"), e execute-o. O instalador preserva os dados pessoais existentes e atualiza a chave em seguranca/assinantes.

A recuperação manual via edição local de seguranca/assinantes e atualização foi retirada porque qualquer alteração no arquivo é preservada pelo atualizador (via `listarModificados` e `restaurarPessoais` em `src/lib/atualizacao.ts`, linhas 749 e 778), o que deixaria a chave adicionada permanentemente e impediria rotações e revogações futuras.

**Chave comprometida**

O que dá para fazer:

- Se há uma segunda chave de confiança já instalada nas máquinas, publique, assinada por ela, uma versão
  que **remove** a chave comprometida do arquivo. Quem atualizar passa a não confiar mais nela.
- Quem **já** aplicou uma versão assinada pela chave roubada pode voltar com `--voltar`, se foi a última
  atualização.

O que **não** dá (confirmado no código; não existe revogação retroativa para versões e instaladores ANTIGOS, que não fazem a
consulta ao confianca.json, nem canal fora da banda para eles):

- O kit só confia no arquivo que já tem. Se a chave comprometida era a **única**, nenhuma versão nova
  assinada por outra chave é aceita, e uma versão assinada pela comprometida seria aceita (inclusive
  se for do atacante). Nesse caso a saída é fora do kit: avisar as pessoas por outro meio para
  reinstalarem com o instalador verificado para uma versão que traga o arquivo corrigido.
- Máquinas que não atualizam continuam confiando na chave.
- Só o confianca.json (seção acima) revoga sem uma versão nova: retire a fingerprint dele e faça o purge. Ele
  vale para atualizadores que **já têm** a consulta; os que saíram antes dela não a ganham depois.

Por isso: tenha a rotação feita **antes** de precisar, e guarde a privada com senha.

## Limites conhecidos

- A assinatura e a verificação SSH não protegem um computador cujo ambiente local já esteja
  comprometido (por exemplo, se binários como `git` ou `ssh-keygen` resolvidos pelo `PATH` tiverem sido
  adulterados ou interceptados). A cadeia de confiança garante a integridade e autenticidade da versão
  distribuída a partir do repositório, assumindo a integridade do ambiente e das ferramentas locais.
- O ensaio provou assinatura, verificação e atualizador reais contra um espelho Git local e chaves de
  teste, com **Git 2.43 e OpenSSH 9.6**. Não foram testadas outras versões de Git ou de OpenSSH.
- `git push` da tag e `gh release create` **não foram ensaiados** (exigem o GitHub real); os flags
  conferem com `gh release create --help`, mas a primeira publicação real é o teste deles.
- O CI não bloqueia a tag: `checar-release` roda depois que ela existe e sinaliza, não impede
  (`docs/knowledge_base/contribuindo.md`). Quem impede é a conferência local do passo 6 e o "sim" do dono.
- Até o dono pôr `verified` em todas as páginas da KB (inclusive esta), `checar-release` reprova. É o
  comportamento esperado e não se contorna.
- A atualização do Bun gerenciado pelo Anvilore ainda não existe: versão que sobe o Bun é recusada para
  esses kits (`bunExigido`).
- A skill /release só automatiza esta página; ela não substitui a revisão do dono.

## Ativar a skill /release (só quem publica)

A skill executa este procedimento por conversa e **para antes de cada ação pública** pedindo o "sim".
O texto dela fica no repositório, inerte, em `docs/release/SKILL.md`; não está em `skills/` (essa pasta é
copiada para quem instala o kit) nem em .claude/skills (o atualizador trata essa pasta como
configuração gerada). Para ativá-la na sua máquina, aponte a skill de usuário para o checkout de
desenvolvimento:

```bash
mkdir -p ~/.claude/skills/release
ln -s <RAIZ-DO-CHECKOUT-DE-DESENVOLVIMENTO>/docs/release/SKILL.md ~/.claude/skills/release/SKILL.md
```

Quem só usa o kit não precisa disto, e a skill não funciona sem acesso de publicação ao repositório.
