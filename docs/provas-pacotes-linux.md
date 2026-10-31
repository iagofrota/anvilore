# Provas U9: pacotes Linux

Autoria Sol 6.1 High, 2026-10-30 (America/Fortaleza). Branch `feat/u9-pacotes-linux`.
QA final independente será Gemini; estes resultados são verificações do autor.

## Estado recebido

HEAD `665a93f`; WIP em `scripts/empacotar-linux.ts`, `tests/empacotar-linux.test.ts` e
`scripts/provar-pacotes-linux.sh` (não rastreado). O WIP já corrigia exit0 em falhas de download,
mas apagava saídas anteriores e ainda pulava HTTP404 no teste. O ensaio de runtime podia instalar
no host e aceitar timeout como êxito. Preservei os avanços e adaptei os três arquivos: falha fechada,
staging com preservação do par anterior, mocks determinísticos e instalação somente em contêineres.
Nenhuma mudança em Windows, `release.yml`, instalador ou lançador da U6.

## Cinco achados: RED e correção

| Achado | Prova que falhava | Comportamento conferido após correção |
|---|---|---|
| P1: instalar.sh cru | Regressões de build padrão/artefato cru/artefato de teste: quatro campos vazios ou script aceito indevidamente | Build padrão embute; `--instalar-sh` é conferido por `conferirEmbutidos`; manifesto, assinantes, base e URL iguais às fontes oficiais. Chave/URL/base customizadas só com `--teste`, sem relaxamento herdado do ambiente. DEB extraído e instalação real dos dois formatos conferidos. |
| P2: ssh-keygen ausente | Geração real do DEB falhou em `Depends:.*openssh-client` | Metadados reais: DEB depende de `openssh-client`; RPM depende de `openssh`. Nas imagens limpas `ssh-keygen` estava ausente e passou a existir após apt/dnf; `dpkg-query -S` e `rpm -qf` confirmaram o provedor. |
| P2: erro HTTP/rede aprovado | Snapshot original `665a93f`, em cópia descartável, falhou no teste HTTP404: esperado exit1, recebido exit0 (0 pass/1 fail) | Mocks HTTP404, exceção de rede e bytes adulterados retornam exit1, preservam ambos os arquivos anteriores e não anunciam sucesso. CLI nunca pula download; só o teste Bun local tem opt-out explícito, desativado no CI. |
| P2: publicação parcial | nfpm falso escreve DEB e devolve42 para RPM, com par anterior preexistente | Exit1, dois arquivos anteriores intactos, nenhum DEB novo publicado nem staging residual. nfpm que retorna0 sem arquivos também reprova. Ambos são gerados/conferidos antes da publicação. |
| P2: branch aceita como versão | `GITHUB_REF_NAME=feat/u9-pacotes-linux` era usado como versão | Build real com ref de branch usa `package.json`; `dpkg-deb -I` lê a versão. Ref de tag válida é aceita; valores explícitos inválidos (`feat/...`, `1.02.3`, `1.2.3-01`, vazio, `v1.2`) são recusados antes de nfpm. |

Testes em `tests/empacotar-linux.test.ts` e `tests/empacotar-linux-regressoes.test.ts`.
RED sobre o WIP recebido: **0 pass/9 fail/15 asserts** nas regressões e **4 pass/2 fail/55 asserts**
na suíte anterior ampliada. Os testes foram commitados antes da implementação (`9034d71`).
GREEN final: **15 pass/0 fail/107 asserts**, com DEB/RPM reais. No host sem rpm há aviso explícito;
a inspeção RPM é obrigatória no ensaio Fedora e no CI.

Mutação própria: numa cópia descartável, trocar a condição da validação SemVer por `false`.
O cenário da versão caiu com **0 pass/1 fail/5 asserts**, por aceitar versão inválida com exit0.
A árvore de trabalho não foi mutada.

## Runtime Ubuntu e Fedora

`agentop run --rm -- bash scripts/provar-pacotes-linux.sh` terminou com exit0 em x86_64:

- Ubuntu 24.04: apt com `--no-install-recommends`, DEB `all`, scripts0755/desktop e ícone0644,
  proprietário root, link absoluto correto e `desktop-file-validate` aprovado.
- Fedora 44: dnf com dependências fracas desativadas, RPM `noarch`, `rpm -qip`/`-qlvp`, dependências
  e provedor de ssh-keygen conferidos, permissões e desktop aprovados.
- Duas contas Unix distintas em cada sistema: quatro instalações reais, quatro `doctor` com saída0,
  oito chamadas de lançador ao todo. Segundo clique não mudou o hash do log nem o HEAD; cada conta
  teve duas chamadas de UI. A entrada de sistema impediu atalhos duplicados por usuário.
- apt/dnf removeu os arquivos do pacote. Listagem completa (modos, donos, links) e SHA-256 de todos
  os arquivos dos dois kits ficaram iguais antes/depois, inclusive fontes e wiki criadas na prova.
- Nenhum pacote instalado no host; contêineres, servidor e chave descartável removidos no EXIT.

O ensaio usa Bun real pré-fornecido, Claude falso e UI interceptada com saída0. Instalar, init,
assinatura SSH e doctor são reais; não prova download do Bun (coberto pelo ensaio separado do instalar.sh),
login de agente, UI no navegador, menu GNOME/KDE nem duplo clique no Centro de Aplicativos.
O validador desktop emite uma dica sobre as duas categorias principais herdadas da U6, mas sai0.

As falhas encontradas durante a preparação do ensaio foram de fixture: Git exige `safe.directory`
para a origem montada com outro UID (inclusive o caminho `.git`), e a imagem Fedora mínima não traz
`diff`. Só a origem descartável é confiada e `diffutils` é instalado como ferramenta do ensaio.
Nenhum timeout é aceito como prova de sucesso.

## Comandos de reprodução

```bash
agentop run --rm -- bun install --frozen-lockfile
agentop run --rm -- bun test tests/empacotar-linux.test.ts tests/empacotar-linux-regressoes.test.ts
agentop run --rm -- bash scripts/provar-pacotes-linux.sh
agentop run --rm -- bun run checar
agentop run --rm -- bun src/cli.ts checar-docs
agentop run --rm -- shellcheck -S warning scripts/empacotar-linux.sh scripts/provar-pacotes-linux.sh scripts/provar-pacote-linux-container.sh instalador/linux/pos-instalacao.sh instalador/linux/pos-remocao.sh instalador/instalar.sh instalador/anvilore-abrir
git diff --check
```

`bun run checar`: **3035 pass, 1 skip, 0 fail, 10552 asserts**, cobertura global **98,00% funções /
98,89% linhas**; inclui build da interface e `tsc --noEmit`. Testes focados repetidos após a prova
de versão de branch real: 15/0/107. Shellcheck warning, tipos, checar-docs e diff-check passaram.
Os resultados remotos e o HEAD entregue ficam registrados na subtarefa U9, com os links do CI.

## Limites de publicação

O job `pacotes-linux` preserva os jobs existentes de `ci.yml` e acrescenta uma matriz Ubuntu/Fedora;
qualquer erro reprova o job. Só o log é guardado como artefato: pacotes com chave de teste nunca são publicados.
Não há PR, merge, tag, release ou assinatura de pacote nesta entrega.
A troca do par usa renames com restauração em erro; não promete transação atômica contra desligamento
do processo/máquina nem coordenação de builds concorrentes no mesmo diretório de saída.
