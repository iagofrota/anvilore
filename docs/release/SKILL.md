---
name: release
description: Publica uma release do Anvilore (CHANGELOG, conferências, tag SSH assinada, release no GitHub) e para antes de cada ação pública pedindo o "sim" do dono. Use quando o dono disser /release, "publicar release", "criar a versão X.Y.Z" ou "soltar uma versão".
---

# /release — publicar uma versão do Anvilore

Fonte da verdade: `docs/knowledge_base/release.md` (cada exigência lá aponta o código). Leia a página
antes de começar e siga os comandos dela exatamente. Esta skill é de **quem mantém o kit**: não vai
para `skills/` nem para `.claude/skills`, e não é instalada em quem só usa o Anvilore.

## Como falar

O dono nunca digita comando. Você roda tudo e fala em **ações**, em frases curtas: "CHANGELOG
pronto", "CI verde nos três sistemas", "vou criar a tag v0.4.0, ok?". Sem despejar saída de comando;
mostre só o que decide algo.

## Proibido, sempre

- Gerar, escolher ou trocar chave real; imprimir chave privada (a impressão digital da **pública** pode; a chave pública é versionada em `seguranca/assinantes`, a privada nunca).
- Forçar o envio de tag (`--force`, `+`), mover, reapontar ou apagar tag já publicada.
- Publicar enquanto houver achado de segurança ALTO ou MÉDIO aberto nos instaladores ou no atualizador, com revisão de outro modelo registrada.
- Escrever `verified` em página da KB (só pessoa, depois de ler).
- Mudar workflow (`.github/workflows/`).
- Criar tag, enviar tag, criar ou editar release, mesclar PR ou enviar branch **sem o "sim" explícito
  do dono para aquela ação**. "Sim" vale para uma ação só; "não", silêncio ou resposta ambígua é "não".

## Fluxo

1. **Versão.** Se o dono não informou `X.Y.Z`, leia o CHANGELOG (`[Unreleased]`) e a última tag
   (`git tag --sort=-v:refname | head -1`), sugira a próxima SemVer (correção, menor ou maior, com o porquê
   em uma linha) e pergunte. Sufixo (`-rc.1`) = pré-release.
2. **Preparar (sem publicar).** Numa branch de release, na raiz do checkout de desenvolvimento:
   - passar `[Unreleased]` para `## [X.Y.Z] - AAAA-MM-DD` e ajustar `version` do `package.json`;
   - migração: `git diff --name-only --diff-filter=D --no-renames vANTERIOR HEAD -- raw wiki SCHEMA.md anvilore.toml`;
     saída não vazia sem cobertura em `atualizacao/migracoes.json` → pare;
   - Bun mínimo: `git diff vANTERIOR HEAD -- package.json | rg "^[+-].*packageManager"`; mudou → avise o dono
     e registre em "Atenção" no CHANGELOG;
   - `bun run checar`, `bun src/cli.ts checar-docs`, `bun src/cli.ts checar-release X.Y.Z`;
   - checklist de segurança: nenhum achado de segurança ALTO ou MÉDIO aberto nos instaladores ou no atualizador, com revisão de outro modelo registrada;
   - **base mínima** (`instalador/base-minima`, uma linha `X.Y.Z`): na **primeira release assinada** ela recebe o número dessa release (hoje o valor é o provisório `0.3.0`; confira com o dono que é o mesmo do `package.json` que vai sair). Nas seguintes não muda sem decisão do dono (subir a base deixa pastas antigas recusadas pelo instalador). Sem `X.Y.Z` válido o embutir recusa gerar;
   - instaladores (quando U3/U4 entrarem na `main`): embutir instalador (`bun scripts/embutir-instalador.ts`; embute manifesto, chave, base mínima e a URL da lista de chaves; a URL é a constante de `src/lib/confianca.ts`, sempre https), conferir com `--conferir` (confere os quatro), gerar `sha256` dentro de `dist` (`cd dist && sha256sum ...`) e assinar com `ssh-keygen -Y sign -n file`;
   - **URL de teste fora da release:** gerar e conferir os instaladores da release sem `--url-confianca` e sem `--aceitar-url-de-teste`. Nunca use `--aceitar-url-de-teste` numa release: um instalador com a URL de loopback (build de teste) é recusado pela conferência sem flags; se ela recusar por causa da URL, gere de novo sem as flags e não publique o artefato recusado;
   - **`checar-release` reprovando por falta de `verified` é esperado** até o dono revisar as páginas:
     diga quais páginas faltam e pare. Nunca ponha `verified`.
3. **Entrar na `main`.** Enviar a branch, abrir o PR e mesclar são ações públicas: peça o "sim" de
   cada uma. Depois confira o CI no commit da `main` que vai receber a tag: os três jobs
   `testes (ubuntu-latest | windows-latest | macos-latest)` e os cinco `Playwright Chromium (1/5…5/5)` com
   `completed`/`success` (`gh run list --commit … --json …` e `gh run view … --json jobs`). Pendente,
   ausente ou vermelho → pare e diga qual.
4. **Assinatura.** Confira `git config --get gpg.format` (tem de ser `ssh`), `user.signingkey`, a
   impressão digital da pública e que a **linha da chave está no arquivo da versão anterior**
   (`git show vANTERIOR:seguranca/assinantes | rg -F …`). **Confira também a lista atual do site**
   (`curl -s https://anvilore.iagofrota.com.br/confianca.json`): a fingerprint da chave que vai assinar
   (`ssh-keygen -lf`) tem de estar em `chaves` e a `versaoMinima` não pode passar da versão que sai.
   Fora da lista, pare e diga ao dono (a release seria recusada por quem consulta). Sem isso, pare: se a chave ainda não foi
   publicada, a release atual é a que a leva e **não será aceita pelo atualizador**; diga isso e
   deixe o dono decidir. Se faltar configuração, diga o que o dono precisa configurar (você não
   escolhe a chave). **Bootstrap:** se a versão anterior não tem seguranca/assinantes (a `0.2.0`), é a
   primeira release assinada e é a **base mínima** (pastas anteriores são recusadas pelos instaladores, sem release de transição). Só com um "sim" do dono específico para o bootstrap, confira a linha no
   arquivo **da própria release** (`git show <COMMIT>:seguranca/assinantes | rg -F …`) e mostre a
   impressão digital para ele comparar com a chave publicada fora do GitHub (página, item 11).
5. **Resumo e os três "sim".** Mostre, em poucas linhas: versão, commit, o que muda, resultado das
   conferências, CI nos três sistemas, impressão digital e canal (estável ou pré-release). Depois,
   uma ação por vez, esperando "sim" a cada uma:
   1. criar a tag assinada: `git tag -s vX.Y.Z -m "Anvilore X.Y.Z" <COMMIT>`, depois conferir
      `git cat-file -t` e `verify-tag` com o arquivo da **versão anterior**, ou com o da própria
      release no bootstrap aprovado (página, Ação 1). Se a
      conferência falhar, apague só a tag **local** e pare;
   2. enviar a tag: `git push origin refs/tags/vX.Y.Z` (nunca `--force`) e conferir com `ls-remote`;
   3. criar a release: `gh release create vX.Y.Z ...` anexando os instaladores, hashes e assinaturas SSH (quando U3/U4 entrarem na `main`), com `--prerelease` se a versão tem sufixo e `--latest=false` se é correção de linha antiga.
6. **Depois.** `gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url` e o trecho do
   `selecionarRelease` da página (com `releases/latest` e canal estável para versão estável, ou `/releases?per_page=100` e canal teste para pré-release). Relate em uma frase: o que o kit instalado vai enxergar.

## Quando algo dá errado

Pare, diga em **uma frase** o que aconteceu e o que fazer. Não tente consertar sozinho uma tag ou
release publicada: release ruim se corrige com a **próxima versão de correção** (página, "Release
ruim"). Se o dono pedir para "refazer" a tag, recuse e proponha a versão seguinte. Em rotação de
chaves, assinar com a nova exige que todas as instalações tenham a versão de transição; para as que
ficaram para trás, a recuperação é manual exclusivamente via reinstalação com o instalador verificado
contra a chave pública obtida fora do GitHub (nunca checkout manual nem edição local de assinantes).
A definição da âncora externa de chave é pendência do dono.
Ambiente local já comprometido (binários no PATH) está fora do alcance da assinatura.
