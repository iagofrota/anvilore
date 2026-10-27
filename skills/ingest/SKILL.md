---
name: ingest
description: "Adiciona novas fontes à wiki, criando ou atualizando páginas conforme necessário. Sempre atualiza o índice e o log."
---

# Skill: Ingest

Você foi invocado porque a pessoa quer adicionar uma fonte à wiki. Siga os passos em ordem, sem pular
nenhum.

**A ingestão tem dois papéis e uma parada só.** Um **leitor** lê a fonte e a wiki e devolve um relatório;
a pessoa lê e aprova, numa única parada, os takeaways e a lista de páginas; só então um **escritor**
escreve. Depois a pessoa revisa o que foi escrito: as páginas nascem com `generated` e só valem quando ela
as aprova. Sem uma pessoa para responder, pare no Passo 2 e entregue o relatório: não escreva em `wiki/`.

**Quem roda os comandos é você, nunca a pessoa.** `rota-ingestao`, `conferir-leitura`, `aprovar` e
`fechar` são seus; a pessoa só lê, comenta e aprova. Não mostre comando para ela copiar.

---

## Os dois papéis

Os prompts ficam nesta pasta da skill e são a **fonte única** dos papéis: a interface do Anvilore usa os
mesmos arquivos.

| Papel | Prompt | Ferramentas | Entrega |
|---|---|---|---|
| Leitor | `skills/ingest/leitor.md` | só leitura: `Read`, `Grep`, `Glob` | relatório JSON no esquema `skills/ingest/relatorio-leitor.schema.json` |
| Escritor | `skills/ingest/escritor.md` | `Read`, `Grep`, `Glob`, `Edit`, `Write`, só na wiki; sem comandos; nunca `raw/` | páginas com `generated`, `index.md` e log do dia |

Como cada agente cumpre os papéis:

- **Claude Code:** despache os subagentes `anvilore-leitor` e `anvilore-escritor` (ou os `-grande`, pela
  rota do Passo 0). A instalação os gera a partir dos prompts, já com as ferramentas restritas. Se o
  subagente não existir na sessão, diga isso à pessoa e siga como nos outros agentes.
- **Codex, Gemini, Copilot e outros sem subagente com ferramentas restritas:** faça os dois papéis em
  sequência, nesta sessão. Leia `skills/ingest/leitor.md` e cumpra o papel de leitor; enquanto for leitor,
  não edite nada. Depois da parada, leia `skills/ingest/escritor.md` e cumpra o de escritor.

**Se você já é o leitor ou o escritor** (seu prompt veio de um despacho ou diz qual é o seu papel), siga só
o arquivo do seu papel e nunca despache outro agente.

---

## Passo 0 — A fonte, a rota e a área

**A fonte tem de estar em `raw/`.** Localize o arquivo que a pessoa indicou. Se não existir, avise e pare.
Nunca ingira a partir de fora de `raw/`. Se a pessoa colou o conteúdo no chat, peça que ela o salve em
`raw/` primeiro.

### Fonte que é uma URL

Você **não** escreve em `raw/`: o contrato proíbe e o hook recusa. Se a pessoa passou um link, peça que ela
salve o **texto integral** (a página inteira, ou a transcrição do vídeo) em `raw/<subpasta>/<slug>.md` e
avise quando estiver pronto; só então ingira a partir desse arquivo.

Nunca ingira a partir de um resumo: uma ferramenta que resume roda um modelo menor que condensa o conteúdo
e contaminaria as páginas curadas (viola o princípio de "nada inventado"). Se o arquivo em `raw/` parecer
resumido, truncado ou incompleto, PARE e diga isso à pessoa.

### A rota

Execute `rota-ingestao <fonte>`. Ela mede a fonte e diz:

- `padrao`: use `anvilore-leitor` e `anvilore-escritor`.
- `grande` (acima de 400.000 bytes): use `anvilore-leitor-grande` e `anvilore-escritor-grande`, de janela
  de contexto grande, e avise a pessoa de que a ingestão vai custar mais. Fora do Claude Code, a sessão
  precisa de um modelo de janela grande; se não tiver, diga isso à pessoa e pare.
- `dividir` (sai com 3): a fonte não cabe nem na janela grande. Pare e combine com a pessoa como dividir.

O modelo de janela grande que a instalação grava nos agentes `-grande` é **exemplo, não requisito**: o que
importa é a janela.

### A área

Veja como a wiki está organizada (a pasta `wiki/`, ou a de `ANVILORE_WIKI` se ela estiver definida):

- **Uma só área** (um diretório `wiki/<área>/` com `sources`, `entities` e `concepts`, sem contar
  `exemplo/`, `_meta/` e `log/`): use-a, sem perguntar.
- **Várias áreas**: use a que a pessoa já indicou; se ela não indicou, o leitor sugere uma e ela confirma na
  parada do Passo 2 (não pergunte antes).
- **Nenhuma área**: layout plano, em `wiki/sources/`, `wiki/entities/` e `wiki/concepts/`, sem o campo
  `area`.

Com área, a página da fonte vai para `wiki/<área>/sources/<slug>.md` e leva `area: <área>`. Se a área
pedida ainda não existir, execute `init --areas <área>` e explique se o perfil `anvilore.toml` impedir a
criação.

---

## Passo 1 — O leitor

Despache o leitor (ou cumpra o papel nesta sessão). A mensagem leva:

- o caminho exato da fonte em `raw/` e o caminho da wiki;
- a área decidida, ou as áreas existentes;
- o caminho de `skills/ingest/relatorio-leitor.schema.json`;
- "leia a fonte inteira de uma vez" e "você é só leitura: não escreva nada".

**Confira o relatório antes de mostrá-lo.** Grave a resposta do leitor, como veio, em
`.anvilore/ingest/leitura.json` e execute `conferir-leitura .anvilore/ingest/leitura.json`. Ela confere o
esquema, que cada trecho citado existe na fonte e que cada página a criar ainda não existe (e cada uma a
atualizar, sim). Com `FAIL`, devolva os erros ao leitor e peça o relatório corrigido; depois da segunda
falha, mostre o problema à pessoa em vez de seguir. Relatório de subagente não é prova.

---

## Passo 2 — A parada: takeaways e páginas juntos

Esta é a **única** parada antes da escrita. Mostre, numa só mensagem e sem JSON:

- os 3–5 takeaways, cada um com o trecho que o sustenta e a seção; diga a certeza quando não for
  `comprovado`;
- as páginas, separadas em "criar" e "atualizar", com o caminho;
- as lacunas e as contradições (registradas, não resolvidas);
- a área sugerida, se a wiki tem várias e a pessoa ainda não escolheu.

Depois pergunte:

- Tem algo aqui que você quer que eu enfatize ou ignore?
- As páginas estão certas? Alguma entidade ou conceito já tem página com outro nome?
- Como tratar as contradições?

Espere a resposta. Ajuste o relatório ao que a pessoa disse: o que ela cortou sai, e o porquê vai junto
para o escritor. Se ela disser "pode seguir" sem mudanças, siga com o relatório como está. Se a lista
passar de ~20 páginas, pergunte se ela quer reduzir o escopo.

Este passo existe porque a pessoa cura e o agente executa. Não pule mesmo que a fonte pareça simples.

---

## Passo 3 — O escritor

Despache o escritor (ou cumpra o papel nesta sessão). A mensagem **já deve conter** tudo, senão ele relê e
desperdiça o ganho:

- o caminho exato da fonte em `raw/` e o caminho da wiki;
- o relatório **como a pessoa o aprovou**: takeaways (com o que ela cortou e por quê), páginas separadas em
  "criar" e "atualizar", lacunas e contradições, e o comentário dela;
- o `by` (`<agente>/<versão>`, por exemplo `claude-opus/2026-09`; nunca `human:`) e o `at`: a hora atual
  **com offset**, que você lê agora (`date -Iseconds` no Linux e no macOS; `Get-Date -Format o` no
  PowerShell). O escritor não roda comando e não tem relógio;
- "leia a fonte inteira de uma vez" e "o Passo 2 já foi feito pela pessoa".

Os modelos de frontmatter, a estrutura das páginas, o índice e o log do dia estão em
`skills/ingest/escritor.md`. Toda página escrita leva `generated`; ninguém além da pessoa escreve
`verified`.

Quando o escritor voltar, **confira você mesmo** o que ele diz ter feito: o `git status` da wiki e as
páginas listadas. Relatório de subagente não é prova.

---

## Passo 4 — Aprovar e fechar

Mostre um resumo curto (poucas linhas) com a fonte, quantidade de páginas novas/atualizadas e contradições
sinalizadas. Não mostre YAML nem peça para a pessoa editar frontmatter ou executar comandos. Pergunte:
**"Aprovar estas N páginas?"** com os caminhos das páginas geradas.

Se a pessoa aprovar, execute `aprovar` com os caminhos das páginas. O hook Claude apresenta a permissão
para um clique; se o comando for negado por modo automático, peça para sair desse modo e solicite a
aprovação de novo. Nunca escreva `verified` por conta própria. Depois execute `fechar wiki` você mesmo. Se
a pessoa não aprovar, mantenha as páginas como rascunho e não declare o ingest concluído.

O fechamento atualiza índices e log, valida a wiki e verifica a entrada do dia. Se falhar por outro
motivo, corrija e execute novamente antes de encerrar o fluxo.

---

## Regras

- Nunca ingira um arquivo que não esteja em `raw/`.
- Nunca sobrescreva conteúdo existente da wiki sem ler primeiro.
- Nunca escreva `verified`, nem edite `wiki/log.md` (é gerado), nem escreva em `raw/`.
- Nunca resolva uma contradição entre fontes: registre e pergunte.
- Nunca responda perguntas durante o ingest. Se a pessoa perguntar algo no meio do fluxo, anote e diga que
  vai responder depois que o ingest terminar.
- Prefira atualizar páginas existentes a criar novas. Fragmentação é inimiga de uma wiki útil.

---

_Esta skill é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
