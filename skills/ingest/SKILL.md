---
name: ingest
description: "Adiciona novas fontes à wiki, criando ou atualizando páginas conforme necessário. Sempre atualiza o índice e o log."
---

# Skill: Ingest

Você foi invocado pelo orquestrador porque o usuário quer adicionar uma nova fonte à wiki. Siga todos os passos em ordem. Não pule passos. Não avance para o próximo sem terminar o atual.

---

## Passo 0 — Despache um subagente (só na sessão de conversa)

**Pule este passo inteiro se você já é o subagente** — ou seja, se seu prompt veio de uma chamada `Agent`, ou já diz explicitamente que você é "um agente de ingest deste projeto". Nesse caso vá direto ao Passo 1. Um subagente nunca despacha outro: isso é recursão.

Se você é a sessão de conversa com o usuário, **não leia a fonte nem execute o pipeline aqui**. Despache **dois** subagentes, em série, com a discussão do Passo 2 entre eles.

Por quê: o pipeline lê a fonte inteira (fontes maiores em `raw/` podem passar de dezenas de milhares de tokens), o `SCHEMA.md`, as páginas-alvo, e edita `wiki/index.md`. Rodar isso na sessão de conversa queima o contexto onde vocês estão falando e força leitura fatiada. Num subagente, a fonte inteira entra de uma vez e o contexto é descartado ao final. Um modelo com janela de contexto grande (`sonnet[1m]`, por exemplo) não custa mais que o padrão enquanto o prompt ficar abaixo de 200 mil tokens — o ganho vale a pena para fontes grandes.

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

### Antes de despachar, e depois

Confira o tamanho da fonte (`wc -c`). Se passar de 400.000 bytes, avise o usuário que o ingest provavelmente vai exigir um contexto grande e pode custar mais — ele decide se segue.

Quando o escritor voltar, **confira você mesmo** o que ele afirma ter feito: `bash scripts/validar-wiki.sh` e `git status`. Relatório de subagente não é prova.

---

## Passo 1 — Ler a fonte

Localize o arquivo que o usuário indicou em `raw/`. Leia-o por inteiro antes de fazer qualquer outra coisa.

- Se o arquivo for um PDF ou uma imagem, extraia todo o texto legível primeiro.
- Se o arquivo tiver imagens com conteúdo relevante (gráficos, diagramas, capturas de tela), anote-as explicitamente — você vai referenciá-las na página de resumo.
- Se o arquivo não existir em `raw/`, avise o usuário e pare. Nunca ingira a partir de fora de `raw/`.

### Capturar fonte de URL com fidelidade integral

Se a fonte é uma URL (o usuário passou um link, não um arquivo), capture o **texto integral** para `raw/<subpasta>/<slug>.md` **antes** de qualquer outra coisa. Ferramenta por tipo de fonte:

- **Artigo / HTML / newsletter** → uma ferramenta de navegador que devolva o corpo completo da página, não um resumo.
- **YouTube / vídeo** → uma ferramenta de transcrição.
- **Arquivo local (PDF/doc)** → copie para `raw/` e leia o arquivo.

Se o domínio da fonte tiver uma ferramenta de captura dedicada disponível na sessão, prefira-a às opções genéricas acima — e registre a escolha e o motivo.

**Não use uma ferramenta que resume para capturar a fonte.** Uma ferramenta de resumo roda um modelo menor que condensa o conteúdo e com frequência recusa transcrição integral por direitos autorais, devolvendo texto degradado — o que contaminaria as páginas curadas (viola o princípio de "nada inventado"). Uma ferramenta assim serve para responder perguntas rápidas, não para capturar fonte.

**Importante:** se qualquer captura vier **resumida, truncada ou recusada**, PARE e refaça com a ferramenta de texto integral. Nunca grave um resumo em `raw/` rotulado como "fonte" e nunca escreva uma página curada a partir dele. Degradação silenciosa — aceitar o resumo e seguir em frente — é o erro que este passo existe para evitar.

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

Crie `wiki/sources/<slug>.md`, onde `<slug>` é uma versão em minúsculas e com hífens do título da fonte.

Use exatamente este frontmatter:

```yaml
---
title: "Título completo da fonte"
slug: slug-da-fonte
type: source
tags: []
original_file: raw/nome-do-arquivo.ext
date_ingested: AAAA-MM-DD
authors: []
---
```

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
Páginas a atualizar:
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
- Adicione uma subseção `## A partir de [[slug]]` se a fonte acrescenta conteúdo novo substancial.

### Criando uma página de entidade nova

Frontmatter:

```yaml
---
title: "Nome da entidade"
slug: slug-da-entidade
type: entity
tags: []
related_sources: [slug]
related_concepts: []
---
```

Escreva um resumo factual de quem ou o que é essa entidade, baseado só no que as fontes dizem. Não acrescente conhecimento externo que não esteja na wiki.

### Criando uma página de conceito nova

Frontmatter:

```yaml
---
title: "Nome do conceito"
slug: slug-do-conceito
type: concept
tags: []
related_sources: [slug]
related_concepts: []
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

## Passo 6 — Atualizar os arquivos de navegação

Depois que todas as páginas estiverem escritas, atualize dois arquivos. Eles pertencem ao orquestrador, mas você escreve as entradas durante o ingest.

**`wiki/index.md`** — adicione as páginas novas na categoria correta. Para páginas só atualizadas, não duplique a entrada.

**`wiki/log.md`** — adicione uma entrada logo abaixo do título do arquivo:

```markdown
## [AAAA-MM-DD] ingest | Título da fonte

Páginas tocadas: sources/slug, entities/x, concepts/y (N no total)
Páginas novas: concepts/cross-attention
Contradições sinalizadas: 1 (ver sources/slug)
```

---

## Passo 7 — Fechar o ciclo

Diga ao usuário o que foi feito em linguagem simples. Não precisa listar todo arquivo — resuma:

```
Pronto. Ingerida a fonte "Attention Is All You Need" (2017).

Criadas: sources/attention-is-all-you-need, concepts/cross-attention
Atualizadas: concepts/self-attention, entities/vaswani-ashish
Sinalizada: 1 contradição com concepts/positional-encoding

Tem algo que você quer que eu revise antes de continuarmos?
```

---

## Regras

- Nunca ingira um arquivo que não esteja em `raw/`. Se o usuário colar conteúdo direto no chat, peça para ele salvar em `raw/` primeiro e então ingerir a partir de lá. Isso mantém a camada de fonte limpa.
- Nunca sobrescreva conteúdo existente da wiki sem ler primeiro.
- Nunca responda perguntas durante o ingest. Se o usuário perguntar algo no meio do fluxo, anote e diga que vai responder depois que o ingest terminar.
- Se um passo produzir mais de ~20 mudanças de arquivo, pare e pergunte ao usuário se ele quer continuar ou reduzir o escopo.
- Prefira atualizar páginas existentes a criar novas. Fragmentação é inimiga de uma wiki útil.

---

_Esta skill é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
