---
name: ingest
description: "Adiciona novas fontes à wiki, criando ou atualizando páginas conforme necessário. Sempre atualiza o índice e o log."
---

# Skill: Ingest

Você foi invocado pelo orquestrador porque o usuário quer adicionar uma nova fonte à wiki. Siga todos os passos em ordem. Não pule passos. Não avance para o próximo sem terminar o atual.

**Esta skill conversa com a pessoa.** Ela aprova os takeaways (Passo 2) e a lista de páginas (Passo 4) antes de você escrever, e depois revisa o que você escreveu (Passo 7): as páginas nascem com `generated` e só valem depois que ela as aprova. Sem uma pessoa para responder, pare no Passo 2 e entregue os takeaways: não escreva em `wiki/`.

---

## Passo 0 — Fonte grande? Despache subagentes (só na sessão de conversa)

**Antes de tudo, confira o tamanho da fonte** (`wc -c`). Os subagentes só valem para fonte grande, **acima de 400.000 bytes**. Fonte pequena ou média você lê na própria sessão: **pule o Passo 0 inteiro e vá ao Passo 1**. Despachar subagentes para um texto de 12 KB é custo sem ganho.

**Pule este passo também se você já é o subagente** — ou seja, se seu prompt veio de uma chamada `Agent`, ou já diz explicitamente que você é "um agente de ingest deste projeto". Nesse caso vá direto ao Passo 1. Um subagente nunca despacha outro: isso é recursão.

Para fonte grande, se você é a sessão de conversa com o usuário, **não leia a fonte nem execute o pipeline aqui**. Despache **dois** subagentes, em série, com a discussão do Passo 2 entre eles.

Por quê: o pipeline lê a fonte inteira (fontes grandes em `raw/` passam de dezenas de milhares de tokens), o `SCHEMA.md`, as páginas-alvo, e edita `wiki/index.md`. Rodar isso na sessão de conversa queima o contexto onde vocês estão falando e força leitura fatiada. Num subagente, a fonte inteira entra de uma vez e o contexto é descartado ao final. O modelo citado abaixo (`sonnet[1m]`) é **exemplo, não requisito**: use um modelo com janela de contexto grande que o seu agente tenha, e avise a pessoa de que o ingest provavelmente vai custar mais.

**Por que dois e não um:** o Passo 2 (discutir 3–5 takeaways antes de escrever) é do usuário, não de um agente — o contrato deste projeto declara a curadoria humana como não-opcional. Um subagente único escreveria a wiki sem essa passagem. Então o primeiro subagente **lê e não escreve**, e o segundo só existe depois do aval dele.

### 0.a — Subagente leitor (`model: "sonnet[1m]"`)

Lê a fonte inteira e devolve, sem tocar em `wiki/`:

- 3–5 takeaways candidatos, cada um com a citação que o sustenta
- páginas-alvo que já existem (caminho) e as que precisariam ser criadas
- contradições e lacunas que viu

Passe no prompt: o caminho exato da fonte, "leia a fonte inteira de uma vez", e "você é read-only: não escreva nada em `wiki/`".

### 0.b — Discussão com o usuário

Apresente os takeaways **na sessão de conversa** e feche com ele o que entra. O contexto gasto aqui é só o relatório, não a fonte inteira. Se algo ficou ambíguo, é aqui que se pergunta.

### 0.c — Subagente escritor (`model: "sonnet[1m]"`)

Só depois do aval. O prompt **já deve conter** (senão ele relê tudo e desperdiça o ganho):

- o caminho exato da fonte em `raw/`
- os takeaways **como o usuário os aprovou** — incluindo o que ele cortou e por quê
- as páginas-alvo com caminho, separadas em "atualizar" e "criar"
- "leia a fonte inteira de uma vez"
- "não releia `SKILL.md`/`SCHEMA.md` se já resumido aqui"
- "execute os Passos 3 a 7; o Passo 2 já foi feito pelo humano"

### Depois do escritor

Quando o escritor voltar, **confira você mesmo** o que ele afirma ter feito: `bun src/cli.ts validar wiki` e `git status`. Relatório de subagente não é prova.

---

## Passo 1 — Ler a fonte

Localize o arquivo que o usuário indicou em `raw/`. Leia-o por inteiro antes de fazer qualquer outra coisa.

- Se o arquivo for um PDF ou uma imagem, extraia todo o texto legível primeiro.
- Se o arquivo tiver imagens com conteúdo relevante (gráficos, diagramas, capturas de tela), anote-as explicitamente — você vai referenciá-las na página de resumo.
- Se o arquivo não existir em `raw/`, avise o usuário e pare. Nunca ingira a partir de fora de `raw/`.

### Fonte que é uma URL

Você **não** escreve em `raw/`: o contrato proíbe e o hook recusa. Se o usuário passou um link, peça a ele que salve o **texto integral** (a página inteira, ou a transcrição do vídeo) em `raw/<subpasta>/<slug>.md` e avise quando estiver pronto; só então ingira a partir desse arquivo.

Nunca ingira a partir de um resumo: uma ferramenta que resume roda um modelo menor que condensa o conteúdo e contaminaria as páginas curadas (viola o princípio de "nada inventado"). Se o arquivo em `raw/` parecer resumido, truncado ou incompleto, PARE e diga isso à pessoa.

---

## Passo 2 — Discutir antes de escrever

> **Subagente: o que fazer com este passo.** Você não conversa com o usuário, então siga o que seu prompt de despacho declarar — e ele tem de declarar um dos dois:
>
> | O prompt diz | Você faz |
> |---|---|
> | "Passo 2 já feito pelo humano" (despacho 0.c) | Pula para o Passo 3 e escreve **exatamente** os takeaways aprovados que vieram no prompt — não renegocie nem acrescente outros |
> | nada sobre o Passo 2 | **Pare.** Devolva os takeaways ao orquestrador e não escreva em `wiki/` — escrever sem aval é o erro que este passo existe para evitar |

Antes de tocar em qualquer arquivo da wiki, apresente os takeaways principais ao usuário. Seja conciso: no máximo 3–5 bullets. Depois pergunte:

- Tem algo aqui que você quer que eu enfatize ou ignore?
- Isso contradiz ou reforça algo que já está na wiki?
- Existem entidades ou conceitos aqui que já têm página?

Espere a resposta do usuário. Ajuste seu entendimento antes de prosseguir. Se o usuário disser "pode seguir" sem mudanças, prossiga com seu próprio julgamento.

Este passo existe porque a pessoa cura e o agente executa. Não pule mesmo que a fonte pareça simples.

---

## Passo 3 — Criar a página de resumo da fonte

### Onde gravar: a área

Veja como a wiki está organizada (`ls wiki`):

- **Uma só área** (um diretório `wiki/<área>/` com `sources`, `entities` e `concepts`, sem contar `exemplo/`, `_meta/` e `log/`): use-a, sem perguntar.
- **Várias áreas**: pergunte à pessoa em qual delas ingerir (ou use a que ela já indicou).
- **Nenhuma área**: layout plano, em `wiki/sources/`, `wiki/entities/` e `wiki/concepts/`, sem o campo `area`.

Com área, a página vai para `wiki/<área>/sources/<slug>.md` e leva `area: <área>` no frontmatter. Se a pessoa pedir uma área que não existe, diga que `bun src/cli.ts init --areas <área>` a cria (e que um `anvilore.toml` com `areas` pode recusá-la).

`<slug>` é uma versão em minúsculas e com hífens do título da fonte.

### O frontmatter: toda página que você escreve leva `generated`

Página escrita por agente nasce **marcada como rascunho**: o bloco `generated` diz quem a escreveu e quando, e o validador reprova a página até uma pessoa aprová-la (portão humano, ver `SCHEMA.md`). Use `<agente>/<versão>` em `by` (por exemplo `claude-opus/2026-09`; nunca `human:`) e a hora atual **com offset** em `at` (`date -Iseconds` no Linux e no macOS; `Get-Date -Format o` no PowerShell).

Use exatamente este frontmatter:

```yaml
---
title: "Título completo da fonte"
slug: slug-da-fonte
type: source
area: pessoal                      # só no layout por área
tags: []
original_file: raw/nome-do-arquivo.ext
date_ingested: AAAA-MM-DD
authors: []
generated:
  by: claude-opus/2026-09
  at: 2026-10-24T10:30:00-03:00
---
```

**Você nunca escreve `verified`.** Quem aprova é a pessoa (veja o Passo 7).

Estrutura da página:

```markdown
## Resumo

2–4 parágrafos. Do que trata esta fonte? Qual é seu argumento ou contribuição principal?
Escreva como se estivesse explicando para alguém que nunca vai ler o original.

## Afirmações-chave

- Afirmação 1 — seja específico, inclua dados ou citações quando relevante.
- Afirmação 2
- ...

## Conexões com a wiki existente

O que esta fonte confirma, contesta ou nuança? Referencie páginas existentes usando [[wikilinks]].
Se ela contradiz uma página existente, sinalize explicitamente:

> [!contradiction] Esta fonte contesta [[pagina-existente]] sobre X.

## Perguntas em aberto

O que esta fonte deixa sem resposta? O que valeria a pena investigar a seguir?

## Citações notáveis

> "Citação direta, se relevante." (p. N ou timestamp)
```

---

## Passo 4 — Identificar páginas a atualizar

Antes de escrever qualquer coisa, percorra `wiki/index.md` e liste toda página que esta fonte toca. Pense em duas categorias:

**Entities** — pessoas, organizações, produtos, datasets, modelos citados na fonte. Verifique se já existe página. Se sim, atualize. Se não, crie.

> **Apelido/sigla ≠ entidade existente.** Uma sigla ou apelido que só aparece numa fonte (por exemplo "JS", "Cia") **não** deve ser fundido com uma entidade existente sem uma fonte que traga o **nome por extenso**. Iniciais que "combinam" com alguém que você conhece são sinal de alerta, não confirmação. Sem uma fonte com o nome completo: crie uma entidade nova provisória ou marque `[!gap]`. Esse tipo de fusão precipitada já aconteceu e propagou o nome errado por várias páginas antes da correção — desfazer custa sempre mais do que esperar uma fonte melhor.

**Concepts** — temas, técnicas, teorias, argumentos com que a fonte dialoga. Mesma regra: atualize se existir, crie se não.

Escreva essa lista antes de prosseguir:

```
Páginas a atualizar (caminhos sob wiki/<área>/, ou direto sob wiki/ no layout plano):
- entities/nome-do-autor (existe)
- concepts/self-attention (existe)
- concepts/cross-attention (nova)
```

Pergunte ao usuário se a lista parece certa. Ajuste se necessário.

---

## Passo 5 — Atualizar ou criar cada página

Percorra a lista do Passo 4 uma página por vez.

### Atualizando uma página existente

Leia a página atual por inteiro. Depois:

- Adicione a informação nova na seção apropriada.
- Não apague conteúdo existente a menos que esteja factualmente errado. Se for o caso, substitua o trecho e explique por quê na mesma edição — este nível do schema só define os callouts `[!gap]` e `[!contradiction]`, então não invente outro para marcar a mudança.
- Se a fonte contradiz algo na página, adicione um callout `> [!contradiction]` com link para a página da fonte.
- Adicione `[[slug]]` ao campo `related_sources` do frontmatter da página.
- Grave (ou atualize) `generated` com `by` e a hora atual em `at`. Se a página já tinha `verified`, **mantenha a lista como está**: a aprovação anterior fica com data anterior à nova geração e deixa de valer até a pessoa revisar de novo. Nunca acrescente `verified` você mesmo.
- Adicione uma subseção `## A partir de [[slug]]` se a fonte acrescenta conteúdo novo substancial.

### Criando uma página de entidade nova

Frontmatter (com `area` e `generated`, como no Passo 3):

```yaml
---
title: "Nome da entidade"
slug: slug-da-entidade
type: entity
area: pessoal                      # só no layout por área
tags: []
related_sources: [slug]
related_concepts: []
generated:
  by: claude-opus/2026-09
  at: 2026-10-24T10:30:00-03:00
---
```

Escreva um resumo factual de quem ou o que é essa entidade, baseado só no que as fontes dizem. Não acrescente conhecimento externo que não esteja na wiki.

### Criando uma página de conceito nova

Frontmatter (com `area` e `generated`, como no Passo 3):

```yaml
---
title: "Nome do conceito"
slug: slug-do-conceito
type: concept
area: pessoal                      # só no layout por área
tags: []
related_sources: [slug]
related_concepts: []
generated:
  by: claude-opus/2026-09
  at: 2026-10-24T10:30:00-03:00
---
```

Estrutura da página:

```markdown
## Definição

O que é este conceito? Um parágrafo claro.

## Como funciona

Mecanismo, processo ou explicação.

## Evidências e afirmações

O que as fontes ingeridas dizem sobre isso? Cite com [[wikilinks]].

## Conexões

Links para conceitos e entidades relacionados.

## Perguntas em aberto
```

---

## Passo 6 — Atualizar o índice e o log

Depois que todas as páginas estiverem escritas, atualize dois arquivos de navegação.

**`wiki/index.md`** — adicione as páginas novas na categoria correta, no formato do esqueleto: no layout por área, sob a seção da área (`## Área: <nome>`, com `### Fontes`, `### Conceitos` e `### Entidades`; crie a seção se ela ainda não existe); no layout plano, sob `## Fontes`, `## Conceitos` e `## Entidades`. Cada linha é `- [[slug]] — descrição curta`. Para páginas só atualizadas, não duplique a entrada.

**O log do dia** — escreva em **`wiki/log/log-AAAA-MM-DD.md`** (a data de hoje). Se o arquivo não existe, crie-o com o título `# Log — AAAA-MM-DD`; se existe, acrescente ao fim. A entrada:

```markdown
## [AAAA-MM-DD] ingest | Título da fonte

Páginas tocadas: sources/slug, entities/x, concepts/y (N no total)
Páginas novas: concepts/cross-attention
Contradições sinalizadas: 1 (ver sources/slug)
```

**Não edite `wiki/log.md`.** Ele é um índice gerado a partir de `wiki/log/log-*.md` pelo fechamento, e o que você escrevesse nele seria sobrescrito.

---

## Passo 7 — Fechar o ciclo

### 7.a — Rodar o fechamento

```bash
bash scripts/fechar-wiki.sh wiki
```

Ele sincroniza a contagem dos índices, regenera `wiki/log.md` a partir do log do dia, valida a wiki e cobra a entrada do dia no log. Ele para no primeiro passo que falha. **Não diga que o ingest está concluído se o fechamento reprovou por outro motivo que não seja a aprovação humana:** leia a mensagem, corrija (wikilink quebrado, página fora do índice, log do dia ausente...) e rode de novo.

**A aprovação humana pendente é o único FAIL esperado.** Como toda página que você escreveu leva `generated`, o `validar` (e, com ele, o fechamento) reprova com `ERRO: página gerada sem aprovação humana: <página>` até a pessoa revisar. Isso não é erro seu: é o portão funcionando. Confira que **todos** os erros listados são desse tipo; se houver qualquer outro, corrija-o. Como o fechamento para nessa etapa, o gate do log do dia só roda depois da aprovação: por isso o Passo 6 tem de estar completo antes de você falar com a pessoa.

### 7.b — Dizer à pessoa o que foi feito, e o que falta

Em linguagem simples, sem listar todo arquivo, e **sempre** com o passo da aprovação:

```
Pronto. Ingerida a fonte "Attention Is All You Need" (2017).

Criadas: sources/attention-is-all-you-need, concepts/cross-attention
Atualizadas: concepts/self-attention, entities/vaswani-ashish
Sinalizada: 1 contradição com concepts/positional-encoding

Falta a sua aprovação. Estas páginas foram escritas por mim e estão marcadas como
rascunho (`generated`): `bun src/cli.ts validar` vai reprovar com "página gerada sem
aprovação humana" até você ler cada uma e, se concordar, acrescentar no frontmatter

verified:
  - by: human:<seu-id>
    at: <hora atual com offset, depois de generated.at>

Depois disso, rode `bash scripts/fechar-wiki.sh wiki` de novo para fechar o ciclo.
Tem algo que você quer que eu revise antes?
```

---

## Regras

- Nunca ingira um arquivo que não esteja em `raw/`. Se o usuário colar conteúdo direto no chat, peça para ele salvar em `raw/` primeiro e então ingerir a partir de lá. Isso mantém a camada de fonte limpa.
- Nunca sobrescreva conteúdo existente da wiki sem ler primeiro.
- Nunca escreva `verified`, nem edite `wiki/log.md` (é gerado), nem escreva em `raw/`.
- Nunca responda perguntas durante o ingest. Se o usuário perguntar algo no meio do fluxo, anote e diga que vai responder depois que o ingest terminar.
- Se um passo produzir mais de ~20 mudanças de arquivo, pare e pergunte ao usuário se ele quer continuar ou reduzir o escopo.
- Prefira atualizar páginas existentes a criar novas. Fragmentação é inimiga de uma wiki útil.

---

_Esta skill é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
