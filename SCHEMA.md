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

## Perfil de proveniência (opcional)

Qualquer tipo de página **pode** registrar de onde a informação veio, quem a
gerou, quem a revisou e quando ela vence. Todos os campos são opcionais: uma
página sem nenhum deles é válida, e o validador **nunca** reprova por ausência.
Ele só reprova um campo que esteja **presente e malformado**.

```yaml
sources:
  - id: reuniao-2026-08-30                    # chave estável para citação; opcional
    resource: raw/exemplo/nome-do-arquivo.md  # obrigatório na entrada
    title: "Título legível"                   # opcional
    author: human:<id>                        # opcional, convenção de atores
    last_modified: 2026-08-30T10:00:00-03:00  # opcional, ISO 8601 com offset

generated:
  by: process:<id>                            # obrigatório no bloco, convenção de atores
  at: 2026-08-30T10:30:00-03:00               # opcional, ISO 8601 com offset

verified:                                     # lista OU um único mapping (ambos válidos)
  - by: human:<id>                            # convenção de atores
    at: 2026-08-31T09:00:00-03:00             # ISO 8601 com offset

stale_after: 2027-02-28T00:00:00-03:00        # instante absoluto, ISO 8601 com offset
```

**Convenção de atores** (`generated.by`, `verified[].by`, `sources[].author`):
- `human:<id>` — uma pessoa.
- `process:<id>` — um processo automatizado.
- `<produtor>/<versão>` — um gerador com versão, ex.: `claude-opus/2026-09`.

**Forma de `sources[].resource`** — três formas, e só uma é checada:
- **URL** (tem esquema de URI, ex.: `https://…`, `ftp://…`, `mailto:…`) — referência
  externa, nunca resolvida.
- **caminho do vault** (tem `/` ou termina em extensão de arquivo) — tem de existir
  dentro da raiz do repositório, como um wikilink que não pode apontar para o vazio.
  `raw/` e `wiki/` são consequência dessa forma, não uma lista de prefixos consultada.
- **descritor de escopo** (o resto: sem barra e sem extensão, ex.: `todas as sessões
  de 2026`) — não resolve para arquivo nenhum e não é checado.

  Espaço em branco no valor **não** decide a forma: um caminho com espaço no nome
  continua sendo caminho e tem de existir.

**Timestamps:** os campos novos (`generated.at`, `verified[].at`, `stale_after`,
`sources[].last_modified`) usam ISO 8601 **com offset explícito**
(`2026-09-03T10:30:00-03:00`). Os campos de data existentes (`date_ingested`)
seguem `AAAA-MM-DD`, inalterados.

**Métricas** (nunca reprovam, só informam): quantas páginas estão vencidas
(`agora ≥ stale_after`) e quantas foram geradas depois da última verificação.

## Áreas (opcional)

Uma wiki pequena vive plana: as páginas soltas em `wiki/`, sem áreas. Isso é
válido e continua sendo. Quando o volume cresce, as páginas podem ser agrupadas
por assunto dentro de `wiki/<área>/`, cada área com os três tipos:

```
wiki/
  <área>/
    sources/
    entities/
    concepts/
  _meta/     # índices gerados; não é uma área
  log/       # log fatiado por dia; não é uma área
```

O campo `area` no frontmatter declara a que área a página pertence:

```yaml
area: nome-da-area
```

- **É opcional.** Uma página sem `area` é válida — é assim que a wiki plana
  funciona. Se o campo faltar, o validador não cobra nada dele.
- **Se estiver presente numa página guardada dentro de uma área**, precisa bater
  com o diretório: uma página em `wiki/marketing/concepts/` com `area: vendas`
  está guardada na área errada. O validador **reprova**, nomeando o arquivo e as
  duas áreas em conflito, para que dê para corrigir sem abrir o validador.
- **Numa página solta na raiz** (`wiki/pagina.md`), o campo `area` não é
  cobrado contra o diretório — não há área de diretório com que comparar.

Os diretórios `_meta/` e `log/` são reservados e não são áreas temáticas.

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
