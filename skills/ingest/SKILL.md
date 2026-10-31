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

### Passo 0a — Capture o bruto

Quem captura é a **sessão principal, antes do leitor**. Nunca altere, sobrescreva, renomeie ou apague
algo em `raw/`; crie arquivos novos só com `anvilore capturar`. O comando escolhe o destino e acrescenta
um sufixo quando o nome existe. Rode na raiz da wiki; respeite a subpasta que a pessoa indicar usando
`--subpasta`, um único segmento. Escolha um `--assunto` curto, minúsculo, sem acentos e separado por hífens.
Para contexto, grave a frase literal da pessoa num arquivo temporário **fora de raw/** usando a ferramenta
de escrita, sem resumir, corrigir, aparar espaços nem mudar quebras de linha. Passe sempre por
`--contexto-de <contexto-temporário>`; o comando lê o conteúdo do arquivo. Isso preserva aspas e acentos
sem depender do escape de cada shell.

Passe a URL por `--url-de <url-temporária>` quando a URL tiver um trecho `raw`: grave a URL num arquivo
temporário fora de `raw/`, e omita a URL posicional. O comando tira só espaços e quebras de linha das
pontas da URL. URL posicional e `--url-de` juntos são erro. O hook continua fechado: citar raw em linha,
inclusive numa URL ou em prosa, pode bloquear a chamada; não tente contorná-lo com uma exceção.

**Fonte existente:** se o arquivo já está em `raw/`, use-o direto, sem capturar de novo. Confira que existe;
se não existir, avise e pare. Nunca siga a ingestão a partir de fora de `raw/`.

**Nota digitada:** salve o texto exatamente como veio em um arquivo temporário fora de `raw/`, sem corrigir,
resumir, reformatar nem mudar quebras de linha. Execute `anvilore capturar nota --de <temporário> --assunto
<slug> [--contexto-de <contexto-temporário>]`. O corpo fica literal; o cabeçalho registra origem, data e hash.

**Página ou link:** execute `anvilore capturar link <url> --assunto <slug> [--contexto-de <contexto-temporário>]`.
O comando prefere Markdown oficial indicado pela página; caso contrário, extrai o conteúdo principal e
guarda também o HTML original byte a byte. Respostas de texto ou Markdown guardam ainda um irmão
.original.txt ou .original.md com os bytes baixados, inclusive BOM e charset; use o `.md` de proveniência
como representação para leitura e os originais irmãos para auditoria. Ao cair para a extração de HTML, diga isso em uma linha.
WebFetch e ferramentas que resumem são proibidos para esta etapa: resumo não é captura. Não use um modelo
para reescrever a fonte. Se a captura vier resumida, truncada, cortada ou recusada, PARE; refaça por uma
ferramenta integral ou explique o impedimento, sem seguir a ingestão com fonte incompleta.

Se a página depender de JavaScript, login ou paywall, ou a extração falhar, use o navegador disponível
(no Claude Code, a extensão do Chrome), com a sessão da própria pessoa, **sem pedir licença**. Diga em
uma linha: "Troquei para o navegador para capturar a página inteira." Exporte o texto integral, sem
resumo nem corte, para um temporário fora de `raw/`; guarde também o HTML renderizado quando a ferramenta
permitir. Execute `anvilore capturar link <url> --metodo navegador --de <texto-temporário> --html
<html-temporário> --assunto <slug>`; omita `--html` quando ele não estiver disponível. Se o navegador não
existir ou também falhar, pare e explique à pessoa.

**Vídeo do YouTube:** execute `anvilore capturar video <url> --assunto <slug> [--contexto-de <contexto-temporário>]`.
Links do YouTube entregues a `capturar link` seguem essa mesma rota. A legenda humana tem preferência;
automática também serve. O idioma do vídeo vem primeiro, depois português e inglês. Sem `yt-dlp` ou
sem legenda disponível, pare e explique o que falta; não invente transcrição.

**Imagem colada ou arquivo:** use o caminho do arquivo que o agente expõe e execute `anvilore capturar
arquivo <caminho> --assunto <slug> [--contexto-de <contexto-temporário>]`. O original é copiado byte a byte; nunca é movido.
Para arquivo `.md`, a fonte do leitor é o `.original.md`; o `.md` irmão contém a proveniência.
O Markdown irmão guarda a proveniência e só o contexto, ou corpo vazio. Sua interpretação da imagem fica
para o leitor e nunca vira bruto. Se o agente **não expuser o arquivo** da imagem colada, pare e explique:
"Envie a imagem como anexo de arquivo ou indique o caminho local para eu preservar o original."

Após a captura, use o `.md` criado como fonte de `rota-ingestao` e do leitor. Para imagem e arquivo, a fonte
é o **binário**, com o `.md` irmão como contexto; passe ambos ao leitor. A primeira linha da saída é o
Markdown e as demais são os arquivos irmãos. Confira a saída e pare se o comando falhar.

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

Fonte binária (PDF, imagem, texto que não é UTF-8): a conferência não lê o texto e devolve
`AVISO: citações não conferidas automaticamente`. Ela continua conferindo o resto; mostre o `AVISO` na parada,
junto dos takeaways, para a pessoa conferir os trechos na fonte.

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
- Nunca escreva `verified`, nem edite `wiki/log.md` (é gerado), nem altere ou apague nada em `raw/`; criar só pelo capturador do Anvilore.
- Nunca resolva uma contradição entre fontes: registre e pergunte.
- Nunca responda perguntas durante o ingest. Se a pessoa perguntar algo no meio do fluxo, anote e diga que
  vai responder depois que o ingest terminar.
- Prefira atualizar páginas existentes a criar novas. Fragmentação é inimiga de uma wiki útil.

---

_Esta skill é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
