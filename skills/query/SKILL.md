---
name: query
description: "Responde perguntas lendo e sintetizando informação da wiki. Sempre cita as fontes."
---

# Skill: Query

Você foi invocado pelo orquestrador porque o usuário fez uma pergunta sobre o domínio. Seu trabalho é responder a partir da wiki — não da memória. Toda afirmação na sua resposta precisa remeter a uma página da wiki, que por sua vez remete a uma fonte em `raw/`.

Siga todos os passos em ordem.

---

## Passo 1 — Entender a pergunta

Antes de abrir qualquer arquivo, reformule a pergunta com suas próprias palavras e identifique:

- **Escopo**: a pergunta é sobre um conceito, uma entidade, uma comparação, uma contradição ou uma questão em aberto?
- **Cobertura esperada da wiki**: com base em `wiki/index.md`, você espera que isso esteja bem coberto, parcialmente coberto, ou seja uma lacuna provável?

Não responda ainda. Não abra páginas da wiki ainda. Apenas pense em voz alta, em um parágrafo curto, e prossiga.

---

## Passo 2 — Encontrar páginas relevantes

Sem um indexador dedicado neste nível, a busca aqui é direta: primeiro `wiki/index.md`, depois `rg` para confirmar onde o termo aparece.

```bash
rg --no-ignore -in "<termo-chave>" wiki/
```

O `--no-ignore` não é enfeite. O `.gitignore` deste repositório exclui
`wiki/*` de propósito — o conteúdo é de quem usa, o repositório carrega só o
método — e o `rg` respeita `.gitignore` por padrão. Sem a flag, a busca não
acha nada a partir da primeira página que você ingerir, e o vazio é
indistinguível de "a wiki não cobre isso". Falha silenciosa é o defeito que
este repositório inteiro existe para evitar.

Trate o resultado do `rg` como **os lugares onde vale olhar**, não como a resposta — ele aponta ocorrência de texto, não relevância. Ainda cabe a você ler as seções encontradas e decidir o que de fato responde à pergunta.

- **A pergunta é sobre lacunas, pendências ou "o que falta confirmar"?** Não é busca por texto — procure diretamente pelos callouts:

  ```bash
  rg --no-ignore -n '\[!gap\]|\[!contradiction\]' wiki/
  ```

- **Precisa de um termo literal exato** (slug, ID, URL)? `rg --no-ignore` continua sendo a ferramenta certa.

Identifique toda página provavelmente relevante para a pergunta. Liste antes de abrir qualquer uma:

```
Páginas relevantes:
- concepts/self-attention (diretamente relevante)
- concepts/transformer (contexto)
- entities/vaswani-ashish (contexto do autor)
- sources/attention-is-all-you-need (fonte primária)
```

Se `wiki/index.md` ainda não lista nenhuma página, diga ao usuário que a wiki não tem conteúdo ainda e pare. Sugira rodar um ingest primeiro.

---

## Passo 3 — Ler as páginas

Leia cada página da lista do Passo 2. Se uma página linkar para outras via `[[wikilinks]]` que pareçam relevantes, siga esses links também — mas limite a 2 níveis de profundidade para não se espalhar demais.

Enquanto lê, registre:

- Quais páginas têm respostas fortes e diretas.
- Quais páginas têm respostas parciais ou indiretas.
- Onde páginas se contradizem (sinalizado com `> [!contradiction]`).
- O que a wiki explicitamente não cobre — lacunas genuínas, não apenas o que você não sabe.

Não sintetize ainda. Apenas leia e faça o balanço.

---

## Passo 4 — Responder a partir da wiki

Escreva sua resposta. Regras:

**Cite toda afirmação.** Depois de cada afirmação, referencie a página da wiki de onde ela veio usando `[[wikilinks]]`. Se uma afirmação é sustentada por várias páginas, cite todas.

```
O self-attention permite que cada token preste atenção a todos os outros da
sequência [[self-attention]], o que difere da abordagem recorrente
usada em arquiteturas anteriores [[rnn]].
```

**Traga contradições à tona explicitamente.** Se páginas da wiki discordam sobre algo relevante para a pergunta, diga isso. Não escolha um lado — relate as duas posições e cite as duas páginas.

```
Nota: [[paper-a]] e [[paper-b]] discordam sobre se isso
escala para sequências maiores que 4096 tokens. Essa é uma tensão em
aberto na wiki.
```

**Sinalize lacunas com honestidade.** Se a wiki não cobre algo relevante para a pergunta, diga isso explicitamente em vez de preencher com memória.

```
A wiki ainda não cobre variantes de mixture-of-experts. Considere ingerir
uma fonte sobre isso se for relevante para o seu trabalho.
```

**Não alucine fontes.** Se você ficar tentado a citar algo que não está na wiki, não cite. Escreva "não está na wiki" em vez disso.

**Extensão:** acompanhe a profundidade da pergunta. Uma busca factual recebe um parágrafo. Uma pergunta de síntese recebe seções estruturadas. Uma pergunta de comparação recebe um lado a lado, se útil.

---

## Passo 5 — Oferecer registrar a resposta

Depois de responder, pergunte:

```
Quer que eu salve isso como uma página da wiki?
```

Se o usuário disser sim, pergunte um título se não for óbvio. Então crie `wiki/concepts/<slug>.md` usando o modelo de página de conceito de `skills/ingest/SKILL.md`. O frontmatter tem que obedecer ao `SCHEMA.md` — é ele que `scripts/validar-wiki.sh` cobra. A página deve conter a resposta sintetizada, com todas as citações intactas, mais uma seção `## Pergunta de origem` no topo:

```markdown
## Pergunta de origem

> "Pergunta original que o usuário fez"
> Registrada em: AAAA-MM-DD
```

Depois atualize `wiki/index.md` e `wiki/log.md`:

```markdown
## [AAAA-MM-DD] query | Pergunta original

Resposta registrada como: concepts/slug
Páginas lidas: concepts/x, concepts/y, sources/z (N no total)
Lacunas identificadas: 1 (mixture-of-experts não coberto)
```

Se o usuário disser não, registre no log mesmo assim, sem a linha "registrada como".

---

## Passo 6 — Sugerir próximos passos

Depois de responder (e registrar, se aplicável), ofereça um dos seguintes, se relevante — não todos:

- Uma pergunta relacionada que a wiki já responderia bem agora.
- Uma lacuna que vale a pena preencher via ingest (nomeie um tipo específico de fonte, não um vago "mais pesquisa").
- Uma observação de manutenção, se você notou contradições não resolvidas ou páginas órfãs enquanto lia — descreva o que viu; decidir se vale agir fica com o usuário.

No máximo uma sugestão. Não enrole.

---

## Regras

- **Nunca pule a leitura de `wiki/index.md` seguida da busca com `rg`.** É o primeiro passo do Passo 2, sempre. Varrer com `rg` sem antes checar o índice — ou o contrário, sem depois confirmar com `rg` — é uma violação, não uma otimização.
- **Nunca responda só da memória.** Se nenhuma página da wiki cobre o tópico, diga isso e pare. A wiki é a fonte da verdade, não seus dados de treino.
- **Nunca abra arquivos em `raw/`.** Query opera só sobre `wiki/`. Se o usuário quiser o conteúdo bruto da fonte, sugira um ingest.
- **Nunca modifique páginas da wiki enquanto responde**, exceto ao registrar a resposta explicitamente no Passo 5. Ler é somente leitura.
- **Nunca invente páginas da wiki.** Se você referenciar uma página que não existe em `wiki/index.md`, corrija-se.
- **Se o índice for grande** (100+ páginas), não leia toda página — use as categorias do índice e os resumos de página para restringir antes de abrir arquivos.
- **Se a pergunta for ambígua**, faça uma pergunta de esclarecimento antes de prosseguir para o Passo 2. Uma pergunta, não uma lista.
