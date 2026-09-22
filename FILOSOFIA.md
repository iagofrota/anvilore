# Filosofia

Este documento é o porquê. O [`README.md`](./README.md) descreve o que o
repositório é e como usá-lo; aqui ficam as posições que explicam por que ele
tem essa forma e não outra, e a linhagem de onde ele veio.

Cada posição abaixo aponta para algo que já existe no repositório — um
arquivo, uma skill, um comportamento do validador ou do instalador. Nenhuma
descreve um recurso futuro.

## 1. A fronteira entre `raw/` e `wiki/` é rígida

`raw/` é escrito só pela pessoa. `wiki/` é escrito só pelo agente. O
`AGENTS.md` declara isso numa tabela de três linhas, e `hooks/` transforma a
declaração em recusa: `hooks/proteger-raw.sh` lê o payload que o agente
entrega antes de executar uma ferramenta de escrita e sai com código `2`
quando o caminho alvo está dentro de `raw/`.

**Por quê:** `raw/` é a evidência, e a evidência não pode ser editável por
quem a interpreta. Um agente que pode reescrever a fonte pode, com a melhor
das intenções, "corrigir" o texto que contradiz a página que ele acabou de
escrever — e o rastro que permitiria descobrir o erro desaparece junto. Uma
wiki cujo lastro foi editado não é mais verificável: você deixa de poder
perguntar "de onde saiu isto?" e receber um arquivo que ninguém tocou.

Por isso a regra não fica só em prosa. Prosa é uma promessa que depende de o
agente lembrar dela a cada turno; o hook é a mesma regra com dentes, e ele
**falha fechado** — quando não consegue isolar o caminho no payload, recusa
em vez de deixar passar. Errar recusando é o lado barato de errar.

## 2. A autoridade sobre o que é verdade é de quem cura, não do agente

O agente ingere, cruza e escreve; o que entra na wiki como verdade passa por
quem cura. A `skills/ingest` despacha um primeiro subagente que **lê e não
escreve**, devolve 3–5 takeaways candidatos com a citação que os sustenta, e
só depois do aval humano um segundo subagente escreve. A `skills/query`
responde a partir da wiki, não da memória, e toda afirmação remete a uma
página, que remete a uma fonte. A `skills/lint` corrige o que não exige
julgamento e **apresenta o resto** para quem cura decidir. E o `AGENTS.md`
proíbe o agente de resolver por conta própria uma contradição entre fontes:
ele registra e pergunta.

**Por quê:** um agente com contexto parcial infere um mecanismo plausível e o
enuncia como fato. Numa conversa isso custa uma frase errada que morre com a
sessão. Numa wiki persistente, a invenção vira uma página, a página vira
citação de outra página, e seis meses depois você consulta como conhecimento
aquilo que ninguém nunca verificou. Uma base de conhecimento só vale o que
vale a sua pior página, e a diferença entre acumular conhecimento e acumular
plausibilidade é exatamente o passo humano que estas skills se recusam a
pular.

É também por isso que a dívida é declarada em vez de resolvida no escuro:
`> [!gap]` e `> [!contradiction]` existem para que o que não se sabe fique
visível. `scripts/listar-lacunas.py` reúne os callouts abertos num índice, e
o validador conta a dívida sem reprovar por causa dela. Registrar uma
contradição não é criar uma contradição — é torná-la visível.

## 3. Crescimento por níveis, contra a adoção antecipada de estrutura

Os quatro níveis do `README.md` não são um roteiro a cumprir: cada um só
existe porque o anterior doeu em algum ponto nomeado. A estrutura de áreas
temáticas é o caso mais claro — o campo `area` é **opcional** no `SCHEMA.md`,
e uma wiki plana, com as páginas soltas na raiz de `wiki/`, continua válida e
continua validando. Quando a dor chegar, `scripts/migrar-areas.sh` move as
páginas para as áreas e injeta o campo no frontmatter, com `--simular` para
ver antes.

**Por quê:** estrutura adotada antes da dor tem custo imediato e benefício
nenhum. Organizar vinte páginas em áreas é cerimônia que ninguém sente falta;
é exatamente o tipo de trabalho chato e sem retorno visível que faz uma base
de conhecimento pessoal ser abandonada na terceira semana. Organizar
centenas sem nenhuma estrutura é inviável — mas essa é uma dor que você vai
sentir, não uma que precisa antecipar. Adiantar o nível também custa o que
não se vê: uma convenção adotada cedo demais é adotada sem informação, e
convenção errada é mais cara de desfazer do que de nunca ter tido.

É o mesmo motivo pelo qual o nível 04 não está empacotado aqui. Uma resposta
genérica para busca, backup e automação entregaria complexidade que ninguém
ainda conquistou, e as escolhas certas nesse ponto dependem de volume de
dados e de agente — coisas que não existem antes de a wiki existir.

## 4. Sem RAG, sem banco vetorial, sem infraestrutura

A wiki é um diretório de markdown. O validador (`scripts/validar-wiki.sh`) é
shell puro; a única checagem que pede mais que isso é o perfil de
proveniência, opcional, e mesmo ele **pula com uma linha `SKIP:`** quando
falta a dependência, em vez de reprovar. Os scripts de manutenção são shell e
Python de biblioteca padrão. Não há servidor, índice binário nem processo
rodando por trás.

**Por quê:** na escala de uma wiki pessoal, um agente que lê `wiki/index.md`
e abre as páginas relevantes é suficiente — e o que se ganha em recuperação
com um índice vetorial se perde em tudo o mais. Infra é uma coisa a mais para
manter viva: um índice que precisa ser reconstruído, uma dependência que
quebra numa atualização, um serviço que estava no ar no dia em que você
escreveu e não está no dia em que você consulta. Um kit cujo pré-requisito é
subir um banco de dados não sobrevive ao primeiro fim de semana em que a
pessoa só queria anotar uma coisa.

E há o lado do artefato. Markdown em disco continua legível sem o agente que
o escreveu, sem este repositório, e sem uma linha de código rodando: você lê
no editor, versiona no git, faz `grep`, move para outro lugar. Um embedding
num banco vetorial não é lido por ninguém — se a ferramenta que o produziu
sumir, o que sobra é um arquivo de números. O conhecimento precisa durar mais
que a ferramenta.

## 5. Nenhum casamento com um provedor de agente

O método não pertence a nenhuma CLI. `instalar.sh` configura quatro
provedores — Claude Code, Codex, Gemini e Copilot — a partir de **uma fonte
só**: as skills são instaladas por link simbólico para `skills/<nome>` (ou,
no caso do Gemini, por um comando que aponta para o mesmo `SKILL.md`), e cada
forma de configuração de hook referencia `hooks/proteger-raw.sh` **por
caminho**, sem reimplementar a decisão. O texto de instruções da skill de
lint não cita provedor nenhum, e `tests/test-porte-onda-3.sh` cobra isso —
com uma isca plantada, para provar que a varredura pega o que procura.

**Por quê:** quatro cópias do mesmo método divergem. Basta uma correção
aplicada em três dos quatro lugares para que o quarto passe a ser outro
produto, silenciosamente — e a descoberta acontece quando alguém usa o agente
errado no dia errado. Instalar por link, em vez de copiar, faz "mudar a
regra" ser editar um arquivo, não lembrar de quatro.

O motivo de fundo é mais simples: o mercado de agentes de código muda mais
rápido que uma base de conhecimento pessoal. Uma wiki que você pretende
consultar daqui a cinco anos não pode depender de qual CLI você instalou este
ano, nem de qual formato de configuração o fornecedor dela resolveu adotar.
Amarrar o método a um provedor é apostar o conteúdo numa decisão que não é
sua.

## De onde isto veio

Nada aqui nasceu do zero, e a linhagem explica o repositório melhor do que
qualquer lista de recursos.

**O ponto de partida foi o [Segundo Cérebro](https://www.buildingasecondbrain.com/book),
de Tiago Forte.** Capturar, organizar, destilar e expressar. A parte de
capturar sempre foi fácil. Organizar e destilar é que nunca sobreviveu a duas
semanas — é trabalho chato, repetitivo, e sem ele o resto não compõe.

**Depois veio o gist [`llm-wiki.md`](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f),
do Andrej Karpathy.** Ele descreve o padrão: em vez de perguntar a um LLM e
jogar a resposta fora, deixe o agente manter uma wiki que sobrevive à
conversa. O gist é deliberadamente abstrato — um padrão, não uma
implementação. Está reproduzido na íntegra em `raw/exemplo/` deste
repositório, como fonte de teste.

**E a implementação que mostrou que o padrão funcionava foi a
[`wiki-wonka`](https://github.com/cooperacode/wiki-wonka), da Coopera Code.**
Foi dela que saiu o desenho que está aqui: o fluxo de dois tempos do `ingest`
(discutir antes de escrever), o `query` que só responde citando página, o
frontmatter, os wikilinks e o sistema de callouts. As skills deste
repositório são **obra derivada** dela — traduzidas para português do Brasil
e adaptadas, sob a licença MIT, com o aviso de copyright original preservado
no [`LICENSE`](./LICENSE).

O que este repositório acrescenta por cima: o passo de despacho de subagentes
no `ingest`, o validador `scripts/validar-wiki.sh` com testes, um schema
deliberadamente menor, a fronteira de `raw/` com dentes em `hooks/`, o
instalador multi-agente, e a ideia de que a coisa cresce em níveis — você
começa com duas skills e um contrato, e só adiciona estrutura quando a dor
aparece.
