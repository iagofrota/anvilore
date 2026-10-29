---
generated: 2026-10-29
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
5. Três ações públicas, cada uma só com o **"sim" explícito do dono**, uma de cada vez: criar a tag,
   enviar a tag, criar a release no GitHub.
6. Release ruim nunca se corrige mexendo na tag: publica-se a próxima versão de correção.

## O que o kit instalado exige de uma release

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
- **Uma versão que o kit recusou por motivo da própria versão** (migração ausente, Bun) fica em
  `recusadas` naquela máquina e **nunca mais é reconsiderada** ("já foi recusada; aguardando outra
  release"). Só uma versão nova a destrava. Recusa por assinatura ou identidade **não** entra em
  `recusadas` (o objeto não foi confirmado como da release), mas o estado fica `recusada` até a
  próxima checagem, que espera 24 horas.

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

1. A primeira versão que traz o atualizador **e** a chave pública é aplicada à mão por quem a tem
   (veja "Atenção" no `CHANGELOG.md`: `bun src/cli.ts migrar-rastreio --puxar`). Assine a tag dela
   também, para que se possa conferir.
2. **Só depois** dela, as versões seguintes (assinadas pela chave que já está nas máquinas) são
   verificadas e aplicadas pelo atualizador.
3. Se uma versão for assinada por uma chave que **não** está no arquivo do kit instalado, ela é
   recusada, mesmo que a chave nova venha dentro dela. Isso é proposital: a chave da candidata não é
   confiável (`verificarAssinaturaTag`; cenário em `tests/atualizar.test.ts`).

Sem seguranca/assinantes (ausente, vazio ou ilegível), o kit recusa toda candidata e diz o motivo.

**Segurança no bootstrap do instalador:** conferir apenas a tag Git não autentica o instalador
executado por quem instala pela primeira vez. Para fechar a cadeia de confiança antes da primeira execução:
1. A chave pública embutida no instalador gerado precisa ser idêntica a seguranca/assinantes (conferida por `bun scripts/embutir-instalador.ts --conferir <script>`).
2. Cada instalador gerado (dist/instalar.sh e dist/instalar.ps1) deve ter seu SHA-256 e sua assinatura SSH (`ssh-keygen -Y sign -n file`) publicados junto da release.
3. Quem baixa o instalador confere o hash e a assinatura (`ssh-keygen -Y verify`) contra a chave pública obtida por canal independente (como o README oficial ou perfil do mantenedor) antes de executá-lo.

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
8. **Gerar e conferir os instaladores (quando U3/U4 entrarem na main).**
   Gere os scripts com manifesto e assinantes embutidos:

   ```bash
   bun scripts/embutir-instalador.ts --modelo instalador/instalar.sh --assinantes seguranca/assinantes --saida dist/instalar.sh
   bun scripts/embutir-instalador.ts --conferir dist/instalar.sh --assinantes seguranca/assinantes
   bun scripts/embutir-instalador.ts --modelo instalador/instalar.ps1 --assinantes seguranca/assinantes --saida dist/instalar.ps1
   bun scripts/embutir-instalador.ts --conferir dist/instalar.ps1 --assinantes seguranca/assinantes
   ```

   O `--conferir` confirma que a chave embutida e o manifesto batem exatamente com seguranca/assinantes e instalador/dependencias.json. (Nota: este passo passa a valer quando as branches U3 e U4 forem mescladas na `main`).
9. **Assinar e gerar hashes dos instaladores.**
   Gere o hash SHA-256 e a assinatura SSH (`ssh-keygen -Y sign -n file`) de cada instalador gerado:

   ```bash
   sha256sum dist/instalar.sh > dist/instalar.sh.sha256
   ssh-keygen -Y sign -f <CAMINHO-DA-CHAVE-PRIVADA> -n file dist/instalar.sh
   sha256sum dist/instalar.ps1 > dist/instalar.ps1.sha256
   ssh-keygen -Y sign -f <CAMINHO-DA-CHAVE-PRIVADA> -n file dist/instalar.ps1
   ```

   Confira localmente as assinaturas antes de prosseguir:

   ```bash
   ssh-keygen -Y verify -f seguranca/assinantes -I "<EMAIL-DE-ASSINATURA>" -n file -s dist/instalar.sh.sig < dist/instalar.sh
   ssh-keygen -Y verify -f seguranca/assinantes -I "<EMAIL-DE-ASSINATURA>" -n file -s dist/instalar.ps1.sig < dist/instalar.ps1
   ```

   Ambos devem retornar `Good "file" signature` e sair com 0.
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
git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=<ARQUIVO-TEMPORARIO-DE-ASSINANTES> verify-tag vX.Y.Z
```

Tem de imprimir `Good "git" signature` e sair com 0. Se falhar, **não envie**: apague a tag *local*
(`git tag -d vX.Y.Z`, só enquanto ela não saiu da sua máquina) e descubra a causa (chave, e-mail,
arquivo da versão anterior).

**Ação 2 — enviar a tag.** Sem `--force`, sem `+`, só esta tag:

```bash
git push origin refs/tags/vX.Y.Z
git ls-remote origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
```

O `ls-remote` mostra dois ids: o da tag e, com `^{}`, o do commit da release. Os dois têm de ser
diferentes (tag anotada) e o segundo tem de ser `<COMMIT>`. O CI roda `checar-release` na tag
(`.github/workflows/ci.yml`, última etapa do job `testes`).

**Ação 3 — criar a release no GitHub.** As notas saem da seção do CHANGELOG. Quando U3/U4 entrarem na `main`, envie também os instaladores gerados com seus hashes e assinaturas SSH como assets:

```bash
awk -v v="X.Y.Z" '$0 ~ "^## \\[" v "\\]" {f=1; next} /^## /{f=0} f' CHANGELOG.md > <ARQUIVO-DE-NOTAS>
gh release create vX.Y.Z dist/instalar.sh dist/instalar.sh.sha256 dist/instalar.sh.sig dist/instalar.ps1 dist/instalar.ps1.sha256 dist/instalar.ps1.sig --verify-tag --title "Anvilore X.Y.Z" --notes-file <ARQUIVO-DE-NOTAS>
```

- Versão com sufixo (`-rc.1`): acrescente `--prerelease`. **Nunca** publique versão com sufixo sem
  essa marca: nenhum canal a enxerga.
- `--verify-tag` aborta se a tag não existir no remoto. Não use `--target` nem deixe o `gh` criar a
  tag: ela já existe, assinada.
- O canal estável lê releases/latest. O `gh` marca a release como "latest" automaticamente por data e
  versão (`gh release create --help`); numa correção de uma linha antiga, use `--latest=false` para não
  tirar o posto da versão mais nova.

**Como quem instala confere o instalador antes de executar** (canal independente):
Quem faz o primeiro download obtém a chave pública por canal independente (README oficial do repositório ou perfil do mantenedor) e grava em um arquivo local `assinantes` (ex.: `echo "<EMAIL-DO-MANTENEDOR> namespaces=\"file\" <CHAVE-PUBLICA>" > assinantes` ou sem a opção de namespace).
A pessoa confere o hash SHA-256 e a assinatura SSH antes de rodar:

No Linux:
```bash
sha256sum -c instalar.sh.sha256
ssh-keygen -Y verify -f assinantes -I "<EMAIL-DO-MANTENEDOR>" -n file -s instalar.sh.sig < instalar.sh
```

No Windows (PowerShell):
```powershell
Get-FileHash .\instalar.ps1 -Algorithm SHA256
ssh-keygen -Y verify -f assinantes -I "<EMAIL-DO-MANTENEDOR>" -n file -s .\instalar.ps1.sig (Get-Content .\instalar.ps1 -Raw)
```

A saída `Good "file" signature` confirma que o instalador está autêntico e íntegro.

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
Se alguma máquina não recebeu a versão de transição e a rotação avançou para a chave nova, a atualização
automática é recusada. O procedimento manual de recuperação para essas instalações é:
- Baixar o instalador da versão mais recente (dist/instalar.sh ou dist/instalar.ps1), verificar o hash SHA-256 e a assinatura SSH contra a chave pública publicada por canal independente, e reinstalar;
- Ou atualizar o repositório manualmente (`git pull` / checkout no commit da release) sob supervisão de quem administra para atualizar o arquivo seguranca/assinantes.

**Chave comprometida**

O que dá para fazer:

- Se há uma segunda chave de confiança já instalada nas máquinas, publique, assinada por ela, uma versão
  que **remove** a chave comprometida do arquivo. Quem atualizar passa a não confiar mais nela.
- Quem **já** aplicou uma versão assinada pela chave roubada pode voltar com `--voltar`, se foi a última
  atualização.

O que **não** dá (confirmado no código; não há lista de revogação nem canal fora da banda):

- O kit só confia no arquivo que já tem. Se a chave comprometida era a **única**, nenhuma versão nova
  assinada por outra chave é aceita, e uma versão assinada pela comprometida seria aceita (inclusive
  se for do atacante). Nesse caso a saída é fora do kit: avisar as pessoas por outro meio para
  atualizarem à mão (`git`) para uma versão que traga o arquivo corrigido.
- Máquinas que não atualizam continuam confiando na chave.
- O atualizador não consulta a internet para saber se uma chave foi revogada.

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
