---
generated: 2026-10-24
---

# Perguntas frequentes

Dúvidas que um agente costuma receber sobre a primeira experiência com o Anvilore, com a resposta e o
arquivo que a sustenta. A maior parte vem de dois ensaios manuais do README, um com Claude Code e outro com
Codex, feitos em 2026-10-24; o roteiro para repeti-los está em `tests/ensaio-dez-minutos.md`. Os relatórios
dos ensaios não estão versionados: os números abaixo são os que eles registraram, e a página só afirma o que
eles mediram.

## Quanto tempo leva a primeira experiência?

**Medido: 103 s de relógio no Claude Code e 139 s nas sete etapas do Codex (259 s contando a redação e a
conferência do relatório).** Os dez minutos são a meta do dono do projeto, não um resultado; o que vale são os
números abaixo, com as condições em que foram obtidos.

| Etapa | Claude Code | Codex |
|---|---|---|
| 1. Pré-requisitos, clone e dependências | 1 s de clone, menos de 1 s de instalação | 28 s |
| 2. Simular e instalar | menos de 1 s cada | 9 s |
| 3. Áreas (`init`, e o perfil anvilore.toml no Codex) | menos de 1 s | 13 s |
| 4. Ingestão de `raw/exemplo/llm-wiki.md` (12 347 bytes) | só o total é cronometrado | 50 s |
| 5. Validar e fechar | menos de 1 s | 17 s |
| 6. `doctor` | menos de 1 s | menos de 1 s |
| 7. Hook de `raw/` (testado por comando) | 14 a 16 ms por chamada | 22 s |
| **Total** | **103 s** (21:05:16 a 21:06:59, relógio do shell) | **139 s** (259 s com o relatório) |

Condições, para ninguém ler isso como promessa:

- Bun e git já estavam instalados nas duas máquinas. Instalar o Bun não entrou na conta.
- A fonte era pequena (12 347 bytes), abaixo do limite de 400 000 bytes da skill, então nenhum subagente foi
  usado.
- **Não havia pessoa para conversar.** A skill pede que a pessoa aprove os pontos principais e a lista de páginas
  antes de escrever, e depois revise e aprove as páginas. Nos ensaios, um plano escrito pelo executor ocupou o
  lugar da conversa e **a aprovação humana não aconteceu**: as páginas terminaram como rascunho. O tempo de uma
  pessoa lendo e aprovando cinco ou seis páginas não está nos números.
- O relógio do Claude Code (103 s) parece baixo para o trabalho de escrever seis páginas; o relatório dele diz isso e
  pede que o número seja lido como "comandos mais sessão, medidos por esse relógio", não como estimativa do tempo
  de uma pessoa.

## Por que o `validar` reprova logo depois do ingest?

Porque é assim que o portão humano funciona. Toda página que o agente escreve nasce com o bloco `generated`
(`skills/ingest/SKILL.md`, Passo 3), e o validador reprova a página até uma pessoa acrescentar `verified` com
`by: human:<id>` e uma hora igual ou posterior à da geração (`SCHEMA.md`, "Portão humano"). O primeiro
`validar` e o primeiro `anvilore fechar` terminam em `FAIL`, com um erro "página gerada sem aprovação
humana" por página, e isso é o esperado. O agente nunca escreve `verified` (`AGENTS.md`). O README mostra o
trecho de frontmatter exato. `tests/skill-ingest.test.ts` prova que os modelos de página da skill produzem
exatamente esse erro e que, com a aprovação, o validador aprova.

## O que quebrou nos ensaios e o que foi corrigido?

As correções saíram em rodadas numeradas do projeto (R70, R73 e R74); a coluna "Correção" diz o que mudou.

| Achado do ensaio | Correção |
|---|---|
| A skill `ingest` não gravava `generated`, então a página escrita pelo agente nunca acionava o portão humano e o `PASS` do README vinha sem aprovação alguma | R70: a skill grava `generated` em toda página; o README explica o `FAIL` esperado e mostra a aprovação |
| A skill mandava escrever o log em `wiki/log.md`, que o fechamento regenera e sobrescreve; o gate cobrava outro arquivo | R70: a skill escreve o log do dia em `wiki/log/` (um arquivo log-AAAA-MM-DD.md por dia) e não edita `wiki/log.md` (o mesmo vale para `query` e `lint`) |
| O fechamento (`anvilore fechar`) não aparecia no fluxo do `ingest` nem no README | R70: é o último passo da skill, e o README o cita |
| A skill criava páginas no layout plano e ignorava as áreas que o `init` acabou de criar | R70: uma área, usa-se essa; várias, pergunta-se; nenhuma, layout plano. O README manda dizer a área |
| O Passo 0 da skill pressupunha subagentes e um modelo específico do Claude Code | R70: subagentes só para fonte acima de 400 000 bytes; o modelo citado é exemplo; a skill declara que conversa com a pessoa |
| O `init` ignorava o anvilore.toml, e o esqueleto `wiki/exemplo/` reprovava qualquer perfil de áreas | R70: o `init` recusa área fora da lista (`src/comandos/init.ts`). R74: `init` e `validar` usam a mesma comparação, exata, sem caixa nem normalização (`src/lib/perfil.ts`) |
| O instalador terminava sem dizer o próximo passo, e a simulação terminava com "instalados:" | R70: a instalação real termina com "Próximo passo: reabra o agente neste clone … e rode `init`"; a simulação diz "Nada foi alterado" |
| O `doctor` saía com código 1 ("faltam 3 travas") para quem instalou só um agente | R70: só se cobra o agente configurado no clone; agente só no PATH é opcional. R74: a versão antiga do Claude Code só reprova se o Claude estiver configurado (`src/comandos/doctor.ts`) |
| O README não listava Bun e git como pré-requisitos, nem dava como conferir o hook | R70: pré-requisitos com o comando de instalação do Bun, linha de autoverificação do hook (deve imprimir `2`) e aviso de que `wiki/index.md` e `wiki/log.md` são rastreados e mudam com o uso |
| Seguir o README e apagar `wiki/exemplo/` deixava `[[area-tematica]]` no `wiki/index.md`, e o `validar` reprovava por wikilink quebrado | R73: o README manda apagar também a seção `## Área: exemplo` do índice; `tests/esqueleto-sem-exemplo.test.ts` prova |

O porte do fechamento resolveu a ajuda: `anvilore fechar --help` e `anvilore fechar -h` mostram o uso e saem 0
(`src/comandos/fechar.ts`, função `comandoFechar`). O gate também dispensa páginas rastreadas iguais ao `HEAD`,
mesmo com mtime de hoje por causa do checkout; mudanças pendentes (inclusive staged), páginas ignoradas e páginas
sem repositório continuam sendo cobradas pelo mtime. Uma edição já incorporada ao `HEAD` passa a ser a versão de referência
(`src/comandos/fechar.ts`, funções `versionadasSemAlteracao` e `gateDoLog`).

Ainda aberto, de propósito ou por estar fora do escopo da primeira onda:

- O README ainda mostra `--alvo claude` nos exemplos de instalação; quem usa outro agente precisa trocar o alvo. O
  ensaio com Codex sugeriu apresentar a escolha do alvo antes dos comandos.
- O `doctor` não diferencia "configuração encontrada" de "hook carregado na sessão": a sessão do agente só carrega o
  hook se foi aberta depois da instalação.

## A skill `ingest` funciona no Codex?

Funcionou, sem mudar o contrato de três camadas nem a curadoria humana. O ensaio com Codex rodou a skill já
corrigida pelo R70. O que o executor registrou:

- Fonte de 12 347 bytes, lida inteira na própria sessão; nenhum subagente, que a skill só pede acima de 400 000 bytes.
- Cinco páginas na única área criada pelo `init` (uma fonte, dois conceitos, duas entidades), todas com `area` e
  `generated` (produtor e versão do agente, hora local com fuso) e nenhuma com `verified`.
- Entrada no log do dia, em `wiki/log/` (um arquivo log-AAAA-MM-DD.md por dia); o fechamento regenerou `wiki/log.md`.
- `raw/` ficou idêntico (mesmo SHA-256 antes e depois), e nenhuma contradição foi "resolvida" por conta própria; uma
  lacuna foi registrada.
- O fechamento terminou em `FAIL` no passo de validação, só pela aprovação humana pendente; por isso o gate do log
  do dia, que vem depois, não chegou a rodar. A skill já prevê essa parada.
- Como não havia dono, o plano de takeaways e a lista de páginas foram escritos pelo executor antes de gravar. Isso
  substitui só os pontos de conversa dos Passos 2 e 4, para testar o fluxo mecânico; não é curadoria humana. No uso
  normal, sem pessoa para responder, a skill manda parar no Passo 2.

O ensaio com Claude Code rodou a versão **anterior** da skill, e foi ele que apontou as adaptações que depois viraram a
correção: não despachou subagentes para a fonte pequena, decidiu sozinho takeaways e lista de páginas por falta de dono,
escolheu a área por conta própria, escreveu o log em `wiki/log.md` e teve de criar o log do dia para o fechamento passar.

## O que os ensaios não provaram?

- **Que o agente carrega o hook.** Nos dois, a sessão do executor começou antes da instalação. Foi testado o comando do
  hook, com payloads de escrita e leitura (todos com a saída esperada, 2 para `raw/` e 0 para `wiki/`), não a sessão.
- **A aprovação humana e o `PASS` final.** Ninguém escreveu `verified`; isso exige uma pessoa.
- **A skill `query`.** O ensaio com Claude Code não a rodou, e o relatório do Codex não a cobre.
- **Windows e macOS.** Os dois ensaios foram em Linux. O estado dos outros sistemas está em
  [plataformas.md](plataformas.md).
- **Isolamento completo no Codex.** O primeiro `bun install` rodou sem redirecionar o cache, então não se pode
  certificar que ele não escreveu no cache padrão do Bun; o relatório registra isso como limitação do executor.

## Como repito o ensaio?

Siga `tests/ensaio-dez-minutos.md`: regras de isolamento, as sete etapas com o resultado esperado, os payloads do hook
e o que registrar. O que cada trava protege e o que não protege está em [governanca.md](governanca.md).
