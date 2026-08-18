# SCHEMA.md

Contrato que define o formato das páginas em `wiki/`. Vale para o agente e
para quem lê depois. Campo que não está aqui não deve aparecer numa página
sem antes atualizar este arquivo.

## Tipos de página

- **`source`** — o que uma fonte em `raw/` disse. Uma página por fonte
  relevante, não uma por ingestão — uma fonte já registrada é atualizada,
  não duplicada.
- **`concept`** — uma ideia, técnica ou tema que aparece em mais de uma
  fonte, ou que organiza o entendimento sobre algo.
- **`entity`** — uma pessoa, organização, produto ou ferramenta específica
  mencionada nas fontes.

## Frontmatter

Comum a todos os tipos:

```yaml
---
title: "Título legível"
slug: kebab-case-do-arquivo
type: source | concept | entity
tags: [uma, lista]
---
```

`type: source` acrescenta a proveniência — de onde a informação veio:

```yaml
original_file: raw/exemplo/nome-do-arquivo.md
date_ingested: AAAA-MM-DD
authors: [quem escreveu a fonte]
```

`type: concept` e `type: entity` acrescentam as ligações:

```yaml
related_sources: [slug-da-fonte]
related_concepts: [outro-conceito]
```

Regras:
- `slug` bate com o nome do arquivo, sem `.md`.
- Listas são sempre array, mesmo vazias: `[]`.
- Datas em ISO 8601: `AAAA-MM-DD`.

## Wikilinks

Referencie outra página com `[[slug]]` — sem caminho, sem extensão. Na
primeira menção a um conceito ou entidade dentro de uma página, use o
wikilink; nas menções seguintes na mesma página, não precisa repetir.

## Quando o agente encontra um problema

Ele **marca**, não resolve:

> [!gap]
> Falta a definição de X. Nenhuma fonte ingerida cobre isso.

> [!contradiction]
> A fonte A afirma X; a fonte B afirma o contrário. Não resolvido.

Resolver uma contradição é decidir qual versão da realidade vale. Isso é
autoridade epistemológica, e ela continua sendo de quem mantém a wiki.
Automatizar a manutenção não é delegar essa decisão ao modelo.

Nunca apague um callout por conta própria. Ele só sai da página quando a
pessoa confirma a resolução — aí o agente edita o conteúdo, remove o
callout e registra a mudança em `wiki/log.md`.
