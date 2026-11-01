---
generated: 2026-10-31
verified: 2026-11-01
---

# Decisões

O porquê das escolhas do Anvilore. Cada decisão diz o que a sustenta. Quando não há arquivo que a
sustente, ela vem marcada como **decisão do dono do projeto**, com a data. Nesse caso a página
registra a decisão e não a explica além do que o dono disse.

Para a linhagem do método e a argumentação completa das posições de design, leia `FILOSOFIA.md`.

## Rust descartado; TypeScript no Bun

- **Decisão do dono do projeto em 2026-10-23.** Rust foi descartado. TypeScript rodando no Bun foi
  escolhido pela integração futura com SDKs de agentes.
- O que o repositório mostra hoje: `package.json` fixa o Bun (`packageManager`), declara o
  executável `anvilore` apontando para `src/cli.ts`, inclui o SDK oficial do MCP como
  dependência de produção e deixa os tipos de Bun e o TypeScript como dependências de desenvolvimento;
  `tsconfig.json` liga o modo estrito; `bunfig.toml` define o
  limite de cobertura.
- O frontmatter é lido com o YAML que o próprio Bun traz (`Bun.YAML.parse`, em
  `src/lib/frontmatter.ts`), sem biblioteca de terceiros.

## Portar tudo, nos três sistemas

- **Decisão do dono do projeto em 2026-10-23.** Os scripts de manutenção, o instalador e o hook
  passam de bash e Python para TypeScript no Bun, e o alvo passa a ser Linux, Windows nativo e
  macOS, os três obrigatórios.
- O que o repositório mostra hoje: validação, manutenção, instalador e hook estão em TypeScript no Bun
  (`src/cli.ts`, `src/comandos/instalar.ts` e `src/comandos/hook-proteger-raw.ts`);
  o fechamento (`src/comandos/fechar.ts`) também é TypeScript. O `README.md`
  declara suporte a Linux, Windows e macOS. O CI roda nos três sistemas (`.github/workflows/ci.yml`) e passou nos PRs das Ondas 1 (#13, run 40150863576) e 2 (#11, run 40191764239). Os detalhes e os riscos
  estão em [plataformas.md](plataformas.md).

## Não fundir buscas

- **Decisão do Iago em 2026-10-26.** O MCP consulta apenas a wiki; cada outra fonte fica nos MCPs
  próprios, sem ranking fundido.
- O caminho sem MCP continua usando `rg --no-ignore` (`skills/query/SKILL.md`).

## Curadoria humana não é opcional

- O agente ingere, cruza e escreve. O que entra como verdade passa por quem cura
  (`FILOSOFIA.md`, seção 2; `README.md`, parágrafo "Por que ele é assim").
- Onde isso está escrito como regra: `skills/ingest/SKILL.md` manda o leitor ler a fonte sem
  escrever, mostrar de 3 a 5 takeaways e a lista de páginas numa parada só e só depois o escritor
  escrever (Passos 1 a 3). O `AGENTS.md` proíbe o agente de resolver uma contradição entre fontes
  por conta própria.
- **Limite honesto:** isso é texto de skill e de contrato. Nenhum script ou hook confere que a
  pessoa deu o aval. Veja [governanca.md](governanca.md).

## Leitor e escritor sempre separados

- **Decisão do Iago em 2026-10-27, trazida pelo líder do W06.** A ingestão separa sempre os dois
  papéis, para fonte de qualquer tamanho: o leitor lê e devolve o relatório, a pessoa aprova takeaways e
  páginas numa parada só, e só então o escritor escreve. A pessoa nunca roda comando.
- O que mudou do R70: ele dispensava subagentes abaixo de 400 000 bytes. O motivo era portabilidade, não
  custo: a skill não podia pressupor subagentes nem um modelo do Claude Code. Esse motivo continua. No
  Claude Code a skill despacha os agentes `anvilore-leitor` e `anvilore-escritor`, que o
  `anvilore instalar` gera dos prompts (`src/lib/papeis-ingestao.ts`). Onde não há subagente com
  ferramentas restritas, a própria sessão faz os dois papéis, guiada pelos mesmos arquivos. O tamanho da
  fonte decide só a janela de contexto (`anvilore rota-ingestao`).
- Os prompts (`skills/ingest/leitor.md`, `skills/ingest/escritor.md`) e o esquema do relatório
  (`skills/ingest/relatorio-leitor.schema.json`) são a fonte única para a skill no terminal e para a
  interface. O código só interpreta o esquema (`src/lib/relatorio-leitor.ts`).

## A fronteira rígida entre raw e wiki

- `raw/` guarda o bruto, criado pela pessoa ou pelo capturador do Anvilore, sempre só com acréscimos;
  `wiki/` é do agente (`AGENTS.md`, tabela de camadas; `FILOSOFIA.md`,
  seção 1).
- O hook `anvilore hook proteger-raw` (`src/comandos/hook-proteger-raw.ts`) transforma a regra em
  recusa **para as ferramentas de edição de arquivo e para o comando de terminal**, dentro dos
  limites de [governanca.md](governanca.md). Ele falha fechado quando não consegue isolar o caminho. O alcance exato está em
  [governanca.md](governanca.md).

## Captura do bruto antes da ingestão (2026-10-31)

- **Decisão do dono do projeto em 2026-10-31:** `raw/` guarda o bruto e só aceita acréscimos. O agente pode
  criar o registro pelo capturador do Anvilore; nunca altera, sobrescreve, renomeia, move ou apaga algo que
  já existe. Pedir à pessoa que salve manualmente uma nota, página ou imagem interrompia a experiência de
  ingestão. A captura automática conserva a prova intacta para conferir a interpretação depois.
- O comando `anvilore capturar` (`src/comandos/capturar.ts`) cria arquivos exclusivamente, com sufixo em
  colisões (`src/lib/raw-captura.ts`), e registra origem, data com offset, contexto literal e SHA-256. O
  HTML original e os binários são preservados; leitura de imagem e resumo ficam fora do bruto.
- A sessão principal captura antes do leitor. O leitor, a parada de aprovação e o escritor continuam no
  mesmo fluxo (`skills/ingest/SKILL.md`); a curadoria humana continua valendo para as páginas geradas.
- YouTube usa `yt-dlp` opcional para legenda JSON3; ausência do programa ou da legenda interrompe a captura
  com explicação (`src/lib/youtube.ts`, `src/lib/yt-dlp.ts`). Os instaladores avisam e não instalam o programa.

## Sem RAG; índice local opcional

- A wiki continua sendo Markdown. O índice FTS5 local é opcional, derivado e descartável, fica no
  diretório oculto local ignorado pelo Git, e pode ser reconstruído a partir de `wiki/`.
- Os comandos de métricas e o MCP usam o diretório local de dados na raiz do clone; `ANVILORE_DIR`
  substitui esse diretório para ambientes isolados.
- O servidor MCP roda sob demanda. Não há RAG, banco vetorial ou serviço residente.
- Uma falha temporária ao abrir o índice não desativa a sessão MCP: cada `buscar` tenta sincronizar
  de novo, e falhas de acesso/ocupação são relatadas como `indice_indisponivel`.
- Um symlink de Markdown cujo alvo real continua dentro de `wiki/` entra no índice só pelo caminho
  canônico do alvo, mantendo o endereço de busca consistente com `ler`.

## SDK oficial do protocolo MCP

- **Decisão do Iago em 2026-10-26.** @modelcontextprotocol/sdk é a primeira dependência de
  produção do kit, para manter a porta MCP conforme o protocolo oficial.

## Revisão web local opcional

- **Decisão do dono do projeto em 2026-10-27.** `anvilore ui` oferece uma interface local opcional
  para revisar rascunhos. O servidor só existe enquanto o comando roda; a wiki segue em arquivos
  Markdown e continua legível sem ele. Esta é uma exceção explícita à posição de não manter servidor
  (`FILOSOFIA.md`, seção 4). O backend usa `Bun.serve`; o front React+TypeScript é compilado por
  `bun run build:ui` e os assets são empacotados em `src/ui/public/`.
- Durante a escrita de uma ingestão, `ANVILORE_SEM_AUTOCOMMIT=1` desliga o autocommit do hook
  `hooks-wiki autocommit`; a aprovação posterior continua sendo feita pela interface.
- A fila calcula SHA-256 do conteúdo exibido; o servidor confere essa versão dentro de
  `aprovarPaginas` antes de registrar `verified`. Se o conteúdo mudou, a interface informa a pessoa
  e recarrega a fila para uma nova revisão (`src/lib/ui-fila.ts`, `src/comandos/aprovar.ts`,
  `src/ui/servidor/servidor.ts`, `ui/web/main.tsx`). A fila também usa a mesma validação de timestamp
  de `src/lib/okf.ts`, incluindo offsets só de horas.
- O comportamento está em `src/ui/servidor/`, `src/comandos/hooks-wiki.ts` e `tests/hooks-wiki.test.ts`.

## Os arquivos da pessoa saem do rastreio do kit

- **Decisão do Iago em 2026-10-27, com detalhes acertados pelo líder da tarefa em 2026-10-28.** `SCHEMA.md`, o índice
  e o log da wiki, o esqueleto e o exemplo de `wiki/` e `raw/` são da pessoa e deixam de ser rastreados pelo kit, em
  duas versões: a primeira traz `anvilore migrar-rastreio` e o aviso "clone a migrar" no `doctor`; a seguinte tira os
  arquivos do rastreio. Os originais ficam em `modelos/` (`src/lib/modelos.ts`).
- `instalar` e `init` copiam de `modelos/` só o que falta e nunca sobrescrevem. O exemplo (`wiki/exemplo/`,
  `raw/exemplo/`) só nasce em instalação nova, quando `wiki/` ou `raw/` ainda não existem: o que a pessoa apagou
  continua apagado em toda reinstalação e atualização (`planejarModelos`).
- O original de `raw/` mora em `modelos/fontes/`, porque o hook trata qualquer componente `raw` de um caminho como a
  camada da pessoa (`estaEmRaw`, em `src/lib/caminhos.ts`); o `.gitignore` da wiki mora como `modelos/wiki/gitignore`
  para não ignorar o exemplo dentro do próprio kit.
- O estado da migração fica no manifesto `.anvilore/migracao/<id>/manifesto.json`, não no arquivo de estado do atualizador (atualizacao.json, na mesma pasta),
  que ele usará para reconhecer uma instalação gerenciada (`src/lib/migracao.ts`).
- Provado com git de verdade (`tests/migrar-rastreio.test.ts`): depois do `git rm --cached`, um `git pull` da versão
  seguinte recusa, porque o git apagaria os arquivos que ficaram no disco. Por isso `migrar-rastreio --puxar`
  estaciona os arquivos por `rename` na pasta .anvilore (que o kit ignora), puxa com `--ff-only` e os devolve conferindo
  o SHA-256; se o processo morrer no meio, a execução seguinte devolve antes de qualquer outra coisa. Sem migrar, o
  `git pull` recusa quando há arquivo editado e apaga o que não foi editado, que `instalar` e `init` recriam.
- Na versão que tira os arquivos do rastreio, o `.gitignore` do kit ignora `/raw/`, `/wiki/` e `/SCHEMA.md`; o
  `checar-docs` aceita uma menção a esses caminhos quando o original existe em `modelos/` (`origemNoModelo`).
- O mesmo teste prova que um `git checkout --force` de uma versão antiga sobrescreve em silêncio o `SCHEMA.md` da
  pessoa, já ignorado: quem voltar de versão precisa restaurar a cópia depois do checkout.

## Ingestão pela interface: uma execução do agente por fase

- **Decisão do dono do projeto em 2026-10-27.** O chat de ingestão chama o Claude Code pela linha de
  comando (`claude -p` com saída em stream JSON), não pelo Agent SDK: o SDK exige chave de API, e a
  interface usa a conta em que a pessoa já entrou. A ponte fica atrás de uma interface neutra
  (`src/lib/ponte-agente.ts`), com o Claude Code como primeira implementação
  (`src/lib/ponte-claude-code.ts`); Codex e Gemini entram depois pelo mesmo contrato.
- Cada fase (leitor, escritor) é um processo; nenhum processo atravessa a parada humana, que é uma só
  (takeaways e páginas juntos). O escritor continua a sessão do leitor com `--resume`. O estado fica em
  .anvilore/ui/conversas, fora de `wiki/` e de `raw/` (`src/lib/ui-ingestao.ts`).
- Isolamento provado num vault temporário em 2026-10-27 (Claude Code 2.1.311): `--setting-sources
  project,local` impede que as permissões do settings.json da pessoa liberem escrita fora da wiki;
  `--tools` por papel remove as ferramentas que o papel não usa; a leitura fica no vault e na wiki, e a
  edição só na wiki, por regra de caminho absoluto. O filho sempre recebe `ANVILORE_WIKI`, para o hook
  proteger também uma wiki fora da pasta. Cancelar manda SIGINT, que preserva o turno parcial; o fim
  cancelado é lido em `terminal_reason`, não no código de saída.
- O servidor não acredita no que o agente diz ter feito: o relatório do leitor passa pelo
  `conferir-leitura` antes da parada, e o `fechar` é rodado pela interface, que mostra a saída real.
- Ainda não provado com o Claude Code de verdade: `--system-prompt-snapshot off` no `--resume` do
  escritor, a regra de leitura por caminho absoluto, Windows (forma do caminho e SIGINT) e macOS.

## Neutralidade de provedor de agente

- Uma fonte só de skills e de hook, ligada a Claude Code, Codex, Gemini e Copilot por
  `anvilore instalar` (`FILOSOFIA.md`, seção 5; `hooks/README.md`, tabela "As formas por agente").
- Só a forma do Claude Code foi exercitada de ponta a ponta com um agente de verdade. As outras
  três foram instaladas conforme a documentação de cada uma e não foram executadas
  (`hooks/README.md`, final).

## Governança desta versão: padrões e guardrails

- **Decisão do dono do projeto em 2026-10-23.** Esta versão prioriza padrões e guardrails.
  Vazamento de documentos internos fica para depois, e o projeto não afirma que protege
  contra ele. O `CHANGELOG.md` registra isso em "Não resolvido nesta versão".
- O que está de fato imposto, e o que não está, é o assunto de [governanca.md](governanca.md).

## Esta knowledge base é documentação, não wiki

- **Decisão do dono do projeto em 2026-10-23.** A pasta `docs/knowledge_base/` fica no repositório,
  trata do projeto (nunca das notas de quem usa) e é escrita junto com o código. O contrato do
  agente continua em `AGENTS.md`, e `CLAUDE.md` só aponta para ele.
- A trava que sustenta isso: `bun src/cli.ts checar-docs` (links e menções) e
  `bun src/cli.ts checar-release` (revisão por pessoa antes da release). Código em
  `src/comandos/checar-docs.ts` e `src/comandos/checar-release.ts`.

## Atualização automática do kit

- O atualizador exige o arquivo de estado .anvilore/atualizacao.json, `origin` oficial e `HEAD` numa tag cuja versão
  SemVer corresponde ao estado local (`src/lib/atualizacao.ts`). O comando é `anvilore atualizar`
  com `--verificar`, `--voltar` e `--estado` (`src/comandos/atualizar.ts`, `src/cli.ts`).
- A tag candidata é buscada sem tags implícitas e verificada por `git verify-tag` com SSH e o arquivo
  de assinantes do kit instalado. Sem o arquivo de assinantes seguranca/assinantes local, a atualização recusa a candidata;
  a chave pública real do dono entra na 0.3.0. A chave privada não é usada pelo atualizador.
  O atualizador aceita exclusivamente assinatura SSH (`-----BEGIN SSH SIGNATURE-----`), fixa
  `gpg.ssh.program=ssh-keygen` e desliga os verificadores OpenPGP/x509 no `git verify-tag`,
  barrando programas aprovadores locais e assinaturas não-SSH.
  O `fetch` (`guardaDeRede` em `src/lib/atualizacao.ts`) só abre o protocolo da origem oficial (`GIT_ALLOW_PROTOCOL`), zera o
  `credential.helper` e não pergunta senha: a configuração global não abre `ext::` antes de a tag ser autenticada.
  Com a opção interna `anvilore atualizar --assinantes-do-instalador <arquivo>` (o instalador entrega as chaves embutidas dele), o
  `verify-tag` usa só esse arquivo no lugar do arquivo seguranca/assinantes local; ausente, vazio ou ilegível recusa. O arquivo local
  não é editado: vem do commit verificado. A opção só vale ao aplicar (com `--verificar`, `--voltar` ou `--estado` é uso inválido,
  código 2) e não aparece na mensagem de "Uso:". O atualizador não lê variável de ambiente para isso: uma atualização manual ou
  agendada que herdasse a variável trocaria a âncora por acidente. Alcance: a opção não prova que quem chamou é o instalador (um
  processo local hostil pode passá-la, assim como poderia trocar o PATH); o ganho é que a âncora não é mais herdada por acidente.
- O arquivo seguranca/assinantes usa o formato OpenSSH `allowed_signers`, uma entrada por linha:
  `<principal> [opções] <tipo-da-chave> <chave-pública-base64> [comentário]`. Para as tags Git, a entrada
  deve incluir `namespaces="git"` nas opções e o principal deve corresponder ao e-mail de assinatura Git
  (`git config user.email`) usado nas tags. A chave pública aprovada precisa estar no kit já instalado,
  antes de verificar a candidata. Nunca copie a chave só do checkout/tag candidata, nem use chave privada
  ou chave local escolhida automaticamente como âncora. Esta entrega não inclui arquivo vazio ou chave
  fictícia que possa ser confundida com confiança. Se o arquivo faltar, estiver vazio ou `git verify-tag`
  recusar, `anvilore atualizar` apresenta o caminho e orienta a conferir principal, opção de namespace e
  chave pública previamente provisionada; a operação é recusada até isso ser configurado.
- `git verify-tag` prova a assinatura do objeto, não que o nome assinado é o da ref: um espelho poderia publicar
  a ref v0.3.2 apontando para a tag assinada da v0.3.1. Por isso, depois da assinatura, o atualizador lê o
  conteúdo assinado (`git cat-file tag`) e exige tag anotada, nome igual ao da release, alvo do tipo commit (sem
  tag aninhada) e o mesmo commit que a ref resolve. A versão comparada, recusada e aplicada vem desse nome e tem
  de ser mais nova que a instalada; o commit aplicado é o do objeto assinado, e o que se lê da candidata
  (migração, `package.json`) é lido desse commit. Qualquer divergência recusa antes da cópia e do checkout.
  A ref é resolvida uma vez e o mesmo id de objeto passa por `verify-tag`, `cat-file` e pela resolução do
  commit. O `fetch` usa `+refs/tags/<tag>:refs/tags/<tag>`, para que uma tag trocada por um espelho seja
  substituída pela do origin (sem o `+` o git recusa sobrescrever a tag local). Esse fetch só roda para uma
  versão **mais nova que a instalada**, comparada antes de qualquer busca e em toda ação (uma `baixada` obsoleta
  é descartada); como o nome da candidata é então sempre outro, um espelho não sobrescreve a tag da versão
  instalada nem a da anterior. Qualquer recusa ou erro depois do fetch, até a verificação terminar, devolve a ref
  da tag ao que era antes da busca (apaga se não existia): uma tag não confirmada apontando para o commit
  instalado mudaria o `describe` e o clone deixaria de ser gerenciado. Recusa por
  assinatura ou identidade não entra em `recusadas`: o objeto não foi confirmado como da release, e marcá-la
  bloquearia para sempre a tag legítima da mesma versão; o estado fica `recusada` com o erro e com `verificadoEm`,
  para que o hook de início de sessão só tente de novo depois de 24 h.
  **Limite:** a falha ao consultar a API de releases também grava `verificadoEm`; sem rede ou com o GitHub fora do
  ar, a checagem seguinte espera as mesmas 24 h.
- **Antes do checkout**, nada é mudado se algo destes falhar: o atualizador compara `bun.lock`/`bun.lockb`
  entre o `HEAD` atual e a tag (erro do `git diff` recusa, nunca vale como "igual"); lê
  atualizacao/migracoes.json da tag; e **recusa a candidata** que deixaria de rastrear um arquivo da
  pessoa (`raw/`, `wiki/`, `SCHEMA.md`, anvilore.toml ou um item da lista do rastreio de `src/lib/modelos.ts`) sem
  declará-lo em `deixa_de_rastrear` — o checkout o apagaria do disco. Também confere o `packageManager`
  da tag: se pedir Bun mais novo e o Bun for da pessoa, recusa e manda atualizar (`bun upgrade`); se o
  Bun foi posto pelo Anvilore (`bunGerenciado` no estado), só atualiza por um ponto injetável
  (`atualizarBun`), que o instalador ainda não fornece — sem ele, recusa dizendo isso. A reversão não
  rebaixa o Bun.
- **Cópia** em .anvilore/atualizacao/<id>/, com SHA-256 de cada entrada: (a) o que `git status
  --porcelain=v2 --no-renames` lista (editado, apagado, renomeado, não rastreado; inclusive em `raw/` e
  `wiki/`) e os caminhos da migração declarada; (b) tudo o que `instalar` escreve —
  .claude/settings.json, .claude/skills, .claude/agents, .codex/config.toml, .agents/skills,
  .gemini/, .github/hooks/anvilore.json, .github/agents, .github/copilot/settings.json e
  anvilore.toml; (c) o `doctor` e a prova do hook antes de começar; e a medição de `raw/` e da wiki
  (pelo caminho de `ANVILORE_WIKI`, quando definido). Caminho que passa por link dentro do kit é recusado.
- Depois do checkout, a migração é devolvida (`devolverTudo` de `src/lib/migracao.ts`) e a cópia (a)
  volta conferida por hash; o que a pessoa tinha apagado e o checkout recriou sai de novo, só se for
  exatamente o blob do commit. `instalar`, `doctor --json` e o hook rodam em subprocesso
  `bun src/cli.ts` da versão ativa no disco: os hooks gerados vêm da versão nova e, na reversão, da antiga.
  Não executa `git clean`.
- **Política de preservação de `raw/` e da wiki:** todo arquivo que existia continua presente e com o
  mesmo SHA-256. Só é aceito arquivo novo que seja peça do esqueleto que `instalar` cria quando falta
  (o exemplo só se a pasta não existia). O `.git` da wiki fica fora da medição (a migração pode criá-lo
  e o autocommit o altera). O atualizador **detecta** mudança, não restaura conteúdo de `raw/` ou da
  wiki que não esteja na cópia (a): nesse caso desfaz o kit, recusa a versão, grava `alerta` no estado
  (mostrado pelo `doctor` em modo texto — o `doctor --json` não traz o estado do atualizador —, pela
  interface e por `anvilore atualizar --estado` até a próxima atualização conferida) e a mensagem diz o
  que mudou, em vez de afirmar que está como antes. **Limite:** a atualização seguinte mede a partir de
  `raw/` e da wiki como estão; não restaura nem lembra o dano anterior, e ao terminar conferida apaga o
  alerta mesmo que o arquivo continue alterado.
- Estado: a operação em curso (`operacao`: tipo, cópia, origem, alvo, para onde voltar) fica separada
  da última atualização bem-sucedida (`ultima`, usada por `--voltar`, que só age se o `HEAD` for o commit
  dela). Refs refs/anvilore/anterior e refs/anvilore/operacao guardam os commits. Reversão R1–R5
  conferida etapa a etapa; falha deixa `reversao-incompleta` com etapa e erro, mantém cópia e refs, e o
  próximo início retoma antes de consultar releases. Processo morto com `aplicando` é retomado igual.
  Log em .anvilore/atualizacao.log; trava .anvilore/atualizar.lock com o pid (dono morto = trava
  abandonada, removida e registrada). `doctor` (modo texto) mostra versão, estado e alerta
  (`src/comandos/doctor.ts`). SessionStart do Claude e Codex tenta aplicar uma atualização assinada
  pendente e agenda a checagem seguinte (`hooks/hooks.json`, `src/comandos/instalar.ts`,
  `src/comandos/hooks-wiki.ts`).
- Cenários com Git, checkout e tags SSH reais e descartáveis em `tests/atualizar.test.ts`, com o kit de
  `tests/apoio/kit-atualizavel.ts` (cada tag traz um `src/cli.ts` mínimo que registra qual versão rodou) e
  a queda real por SIGKILL de `tests/apoio/atualizar-e-morrer.ts`.
- `anvilore ui` mostra o estado recente, o resumo da versão do changelog, as ações de verificação/aplicação/
  reversão e o botão de retomada (`src/ui/servidor/servidor.ts`, `ui/web/main.tsx`).
- A documentação descreve o código atual da fatia U2 e ainda aguarda revisão humana. A primeira
  operação real usa a chave pública do dono no arquivo seguranca/assinantes, a partir da 0.3.0.

## Estado das chaves fora do GitHub (revogação)

**Decisão:** o atualizador consulta, antes do `verify-tag`, https://anvilore.iagofrota.com.br/confianca.json
(chaves permitidas por fingerprint e versão mínima) e aceita só a **interseção** com as chaves que a pasta já
tinha. **Por quê:** a assinatura SSH só prova a chave, e um arquivo de assinantes entregue na própria versão
nunca revoga (a circularidade da seção "Atualização automática do kit"). Um arquivo estático em domínio do dono,
sem servidor nem chave a mais, dá o veto atual. **Escolhas:** URL fixa (constante de build, sem ambiente);
site fora do ar para a atualização, não a wiki; sem cache nem fallback; o site não acrescenta chave. **Custo:**
o dono mantém o arquivo e o purge; os instaladores consultam antes da tag e antes de executar a pasta (e recusam pasta abaixo da `versaoMinima`, como a base mínima); vale só para quem já tem a consulta (parecer de segurança de 2026-10-29, seção 2, fora do repositório). Guia: `docs/knowledge_base/release.md`, "Estado das chaves no site".

## Instalador do Linux (instalar.sh)

- O instalador é um script bash único (`instalador/instalar.sh`) e a release embute nele o manifesto de dependências e
  a chave pública (`scripts/embutir-instalador.ts`). Motivo: ele precisa dos dois antes de clonar o kit, e a única
  confiança inicial é a do HTTPS do GitHub ao baixar o script; daí em diante só entra o que o dono assinou.
- Sem chave embutida válida o script recusa instalar. Não há chave de mentira no modelo do repositório.
- A primeira release assinada é a **base mínima** (`instalador/base-minima`, embutida como o manifesto e a chave), sem release de
  transição. Motivo: a `0.2.0` não tem atualizador nem âncora de confiança, então publicar outra tag não cria confiança nas
  máquinas antigas, e executar o CLI da pasta para descobrir se ela serve é executar código não autenticado. Os dois
  instaladores leem a versão do `package.json` como texto e recusam, antes de executar qualquer coisa da pasta, o que for menor,
  ausente, ilegível, inválido ou pré-release. O arquivo próprio (e não um campo do `instalador/dependencias.json`) evita mexer no formato que
  o `awk` do instalar.sh lê. Migração dos dados de uma pasta antiga: pasta nova + migração conferida, ferramenta no backlog
  (parecer em specs/release/PARECER-SOL-DECISOES-RELEASE.md, seção 1).
- Só vale assinatura SSH. O `git verify-tag` escolhe o verificador pelo tipo de assinatura que a tag traz; por isso o
  script exige o bloco SSH e desliga os programas de gpg e x509, para o chaveiro da pessoa nunca entrar na decisão.
- Respostas por /dev/tty e `ANVILORE_SEM_PERGUNTAS=1`; sem terminal usa os padrões. Instalar o Claude Code é sempre
  uma pergunta (D7), nunca padrão silencioso.
- O Bun baixado vai para ~/.bun/bin e ganha um link em ~/.local/bin/bun, porque os hooks chamam `bun` pelo PATH
  e uma sessão aberta antes do instalador não enxerga o PATH novo (prova U0, item 16).
