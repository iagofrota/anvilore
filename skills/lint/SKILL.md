---
name: lint
description: "Varre a wiki atrás de problemas estruturais, factuais e de navegação — corrige o que não exige julgamento e apresenta o resto para quem cura decidir."
---

# Skill: Lint

Você foi invocado pelo orquestrador porque o usuário quer conferir a saúde da
wiki. Seu trabalho é achar o que está estruturalmente quebrado, o que virou
dívida de conhecimento e o que ficou invisível na navegação — corrigir o que
não exige julgamento e apresentar o resto para ele decidir.

Lint é manutenção, não conteúdo. Você não acrescenta conhecimento novo aqui.
Você torna o conhecimento que já existe mais confiável e mais navegável.

Siga todos os passos em ordem. **Complete a varredura inteira antes de corrigir
qualquer coisa.**

---

## Passo 1 — Levantar o estado da wiki

Três comandos, nesta ordem. Os três são determinísticos: rode-os antes de abrir
qualquer página, porque cada um responde, de graça, uma pergunta que você
responderia caro lendo arquivo por arquivo.

```bash
bash scripts/validar-wiki.sh wiki
python3 scripts/auditar-wiki.py wiki
python3 scripts/listar-lacunas.py wiki --consultar
```

| Comando | O que responde | Como ler a saída |
|---|---|---|
| `scripts/validar-wiki.sh` | invariantes do `SCHEMA.md` — frontmatter ausente, `type` inválido, `slug` divergente, área do frontmatter brigando com o diretório | `VALIDACAO: FAIL` é violação de contrato: **isso vem antes de tudo**, porque uma wiki que não valida torna o resto da varredura ruído |
| `scripts/auditar-wiki.py` | as cinco categorias estruturais do Passo 2 | sai `1` quando há achado, `0` quando não há; ele **nunca escreve**, só relata |
| `scripts/listar-lacunas.py … --consultar` | os callouts `[!gap]` e `[!contradiction]` abertos, um por linha, no formato `caminho.md:linha [tipo] texto` | é a dívida que quem cura **declarou** e ainda não fechou |

Depois, e só depois:

- Leia `wiki/index.md` inteiro. É o único índice da wiki — não existe outro.
- Leia as últimas entradas de `wiki/log.md` (as três mais recentes bastam).
  Anote o que foi ingerido recentemente, quais consultas rodaram, e se já houve
  um lint antes e quando.

**Se `wiki/index.md` não existir, ou não listar página nenhuma, diga isso ao
usuário e pare.** Não há o que varrer, e inventar um índice não é lint.

> **Sobre custo de contexto.** Os três comandos acima cabem em poucas centenas
> de linhas. O que custa é o Passo 3b (contradições implícitas), que exige ler
> páginas inteiras. Se a wiki for grande, despache essa leitura para um
> subagente com a lista de páginas já decidida, e traga de volta só o
> relatório — o mesmo raciocínio que a skill `ingest` aplica à leitura da
> fonte.

---

## Passo 2 — Ler a varredura estrutural

`scripts/auditar-wiki.py` devolve cinco seções. Você não precisa reimplementar
nenhuma delas; precisa saber o que cada uma significa para não tratar um achado
como se fosse outro.

### 2a — Páginas órfãs

Páginas listadas em `wiki/index.md` que não recebem `[[wikilink]]` de nenhuma
outra página. São becos sem saída: alcançáveis só pelo índice, invisíveis para
quem navega seguindo links. O índice não conta como link de entrada de
propósito — se contasse, órfã nenhuma existiria.

### 2b — Entradas ausentes do índice

Páginas que existem como arquivo mas não aparecem em `wiki/index.md`. Acontece
quando uma página é criada durante uma ingestão e a atualização do índice fica
pelo caminho.

### 2c — Wikilinks quebrados

`[[slug]]` que não corresponde a arquivo nenhum. São ponteiros pendurados:
parecem navegação e não levam a lugar nenhum. A linha do relatório nomeia a
página de origem e o slug alvo.

### 2d — Frontmatter incompleto

Campos que o `SCHEMA.md` exige e a página não declara — os comuns (`title`,
`slug`, `type`, `tags`) e os do tipo (`original_file`, `date_ingested`,
`authors` para `source`; `related_sources`, `related_concepts` para `concept` e
`entity`). O relatório nomeia os campos ausentes, um a um.

> Esta seção é **mais exigente** que `scripts/validar-wiki.sh` de propósito. O
> validador cobra invariante: o que reprova o repositório. O lint cobra
> completude: o que degrada a wiki sem quebrar nada.

### 2e — Páginas vazias ou esboço

Frontmatter presente, corpo com menos de 3 linhas. Quase sempre são
marcadores criados para fechar um link e nunca preenchidos.

---

## Passo 3 — Varrer o que só julgamento enxerga

A varredura do Passo 2 é mecânica. Esta não é: aqui você lê.

### 3a — Contradições declaradas

Toda linha `[contradiction]` da saída de `scripts/listar-lacunas.py`. Para cada
uma, abra a página no ponto indicado e descreva **os dois lados**. Seu trabalho
é trazê-las à superfície para o usuário, não resolvê-las.

### 3b — Contradições implícitas

Afirmações em páginas diferentes que são logicamente incompatíveis e ainda não
foram marcadas. Exige ler páginas que se sobrepõem — conceitos e fontes sobre o
mesmo assunto. **Use julgamento e erre para menos:** só sinalize quando o
conflito for claro e material. Uma lista de contradições duvidosas é pior que
nenhuma, porque ensina o usuário a ignorar a lista.

### 3c — Consultas não arquivadas

A skill `query` registra toda consulta em `wiki/log.md`. Quando a resposta foi
salva como página, a entrada traz uma linha `Resposta registrada como: …`;
quando não foi, a entrada existe sem essa linha. É essa ausência que você
procura:

```bash
rg --no-ignore -n '^## \[.*\] query \|' wiki/log.md
```

Para cada entrada de consulta encontrada, confira se o bloco dela tem a linha
`Resposta registrada como:`. As que não têm são conhecimento que foi
sintetizado e não persistiu — candidatas a virar página. Uma pergunta trivial
que não merecia página também cai aqui; é o usuário quem separa as duas.

O `--no-ignore` não é enfeite: `wiki/.gitignore` ignora tudo e reabre só o
esqueleto, então sem a flag a busca vem vazia justamente na wiki que já tem
conteúdo.

### 3d — Lacunas de conceito

Duas origens:

1. **Explícita** — os wikilinks quebrados do Passo 2c. Cada um é alguém tendo
   escrito o nome de uma página que deveria existir.
2. **Implícita** — nomes próprios e termos técnicos que aparecem em várias
   páginas no corpo do texto e não têm página nem wikilink. Ao contrário de 3b,
   aqui errar para mais é barato: sugerir uma página é reversível.

Não confunda lacuna de conceito com `[!gap]`. O `[!gap]` é uma lacuna que quem
cura **declarou**; esta é uma que ninguém percebeu ainda.

---

## Passo 4 — Apresentar o relatório

Antes de corrigir qualquer coisa, apresente o consolidado. Formato:

```
## Relatório de lint — AAAA-MM-DD

### Contrato
- Validação: PASS | FAIL (N violações de invariante)

### Estrutural
- Páginas órfãs (N): caminho, caminho, …
- Entradas ausentes do índice (N): …
- Wikilinks quebrados (N): página → [[alvo]] não existe
- Frontmatter incompleto (N): página — campo ausente: X
- Páginas vazias ou esboço (N): …

### Conteúdo
- Contradições declaradas (N): caminho.md:linha — resumo dos dois lados
- Contradições implícitas (N): página X ↔ página Y sobre Z
- Lacunas declaradas [!gap] (N): caminho.md:linha — texto
- Consultas não arquivadas (N): "pergunta" — AAAA-MM-DD
- Lacunas de conceito (N): termo aparece em N páginas, sem página própria

### Resumo
N problemas. N corrigíveis sem julgamento. N precisam de você.
```

Depois pergunte:

```
Como você quer seguir?
(a) Corrigir agora tudo o que não exige julgamento, e me mostrar o resto
(b) Passar item por item
(c) Corrigir só uma categoria específica
(d) Só o relatório — eu decido depois
```

**Espere a resposta antes de tocar em qualquer arquivo.**

---

## Passo 5 — Corrigir o que não exige julgamento

Só depois de (a) ou (c), e só a categoria escolhida.

| Problema | Correção |
|---|---|
| Entrada ausente do índice | Acrescente a página a `wiki/index.md`, na seção correspondente ao layout em uso, com um resumo de uma linha tirado do frontmatter ou do primeiro parágrafo. |
| Wikilink quebrado cujo alvo deveria existir | Crie a página mínima, com frontmatter correto e uma seção `## Perguntas em aberto` dizendo que falta conteúdo. Acrescente ao índice. |
| Frontmatter incompleto | Preencha os campos ausentes com o que dá para inferir (`slug` pelo nome do arquivo, `type` pelo diretório, listas como `[]`). Marque o valor inferido com um comentário `# inferido`. |
| Página órfã | Ache as 2–3 páginas mais relacionadas e acrescente o wikilink no corpo delas, na seção onde ele faz sentido — não só no frontmatter, que não é navegação. |

**Não corrija automaticamente** contradição, lacuna de conceito ou consulta não
arquivada. As três precisam ou de julgamento humano, ou de uma ingestão nova.

Relate cada correção enquanto faz:

```
Corrigido: entrada de índice acrescentada para concepts/atencao-cruzada
Corrigido: página mínima criada para entities/nome-da-pessoa (alvo de link quebrado)
Corrigido: campo slug acrescentado a sources/artigo-tal (inferido do nome do arquivo)
```

Depois de corrigir, rode `python3 scripts/auditar-wiki.py wiki` de novo e
confira que os itens que você diz ter corrigido **saíram** do relatório. Dizer
"corrigi" sem essa segunda passada é afirmar sobre o estado da wiki algo que
você não pode apontar numa saída de validação — o que o `AGENTS.md` proíbe.

---

## Passo 6 — Apresentar o que exige julgamento

Um item por vez se o usuário escolheu (b); agrupados se escolheu (a).

### Contradição

```
Contradição: concepts/exemplo-um afirma "X é inevitável",
mas sources/exemplo-dois afirma "X é evitável sob a condição Y".

Opções:
(1) Atualizar concepts/exemplo-um com a afirmação mais recente
(2) Acrescentar um callout [!contradiction] a concepts/exemplo-um, apontando a outra
(3) Deixar como está e anotar para uma ingestão futura
```

### Lacuna de conceito

```
Lacuna: "termo-recorrente" aparece em 4 páginas (concepts/a, sources/b,
sources/c, entities/d) e não tem página própria.

Opções:
(1) Criar concepts/termo-recorrente agora, sintetizando a partir dessas 4
(2) Marcar um [!gap] na página mais central, para a próxima ingestão
(3) Pular
```

### Consulta não arquivada

```
Consulta não arquivada (AAAA-MM-DD): "pergunta que o usuário fez"
A resposta foi sintetizada e não virou página.

Opções:
(1) Rodar a consulta de novo e arquivar o resultado
(2) Pular — a pergunta não merece página
```

**Espere a escolha do usuário em cada item antes de seguir.**

---

## Passo 7 — Fechar o ciclo

Acrescente a entrada em `wiki/log.md`, no mesmo formato que `ingest` e `query`
usam:

```markdown
## [AAAA-MM-DD] lint | Varredura completa

Problemas encontrados: N
Corrigidos sem julgamento: N (índice: N, links: N, frontmatter: N, órfãs: N)
Resolvidos com o usuário: N
Adiados: N
Contradições em aberto: N
```

Depois rode o ritual de fechamento, que reconstrói o que é derivado e valida o
resultado:

```bash
bash scripts/fechar-wiki.sh wiki
```

Ele sincroniza a contagem dos índices, regenera o log a partir do log fatiado
(quando houver), roda a validação e cobra a entrada do dia. **Se ele reprovar,
o lint não terminou** — leia o passo que falhou e resolva antes de dizer ao
usuário que acabou.

---

## Regras

- **Complete a varredura inteira antes de corrigir.** Nunca corrija enquanto
  varre: você precisa do quadro completo antes de tocar em arquivo.
- **Nunca resolva uma contradição por conta própria.** Traga à tona, apresente
  as opções, espere. Quem decide o que a wiki acredita é a pessoa — o
  `SCHEMA.md` chama isso de autoridade epistemológica, e ela não é sua.
- **Nunca apague uma página.** Se uma página é duplicata ou erro confirmado,
  marque com um callout `[!contradiction]` apontando a página correta e
  proponha ao usuário tirá-la do índice. O arquivo fica. Este schema só define
  os callouts `[!gap]` e `[!contradiction]` — não invente um terceiro.
- **Nunca apague um callout.** Ele sai da página quando a pessoa confirma a
  resolução, e a remoção é registrada em `wiki/log.md`.
- **Nunca ingira fonte nova durante o lint.** Se uma lacuna se resolveria
  melhor com uma fonte nova, diga isso e pare. Ingestão é outra skill, outra
  sessão.
- **Nunca toque em `raw/`.** Lint opera só sobre `wiki/`. Existe um hook em
  `hooks/` que recusa essa escrita — mas o contrato vale mesmo onde o hook não
  estiver instalado.
- **Se a wiki tiver menos de 10 páginas**, pule o Passo 3c (consultas não
  arquivadas) e o 3d implícito: em escala pequena eles produzem mais ruído que
  sinal.
- **Um lint é uma varredura completa.** Se o usuário quer saber só quais
  páginas não têm link de entrada, isso é uma consulta — rode
  `python3 scripts/auditar-wiki.py wiki` e responda. Não chame de lint.

---

_Esta skill é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
