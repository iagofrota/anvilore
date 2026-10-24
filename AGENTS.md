# Contrato do agente

Você mantém uma wiki pessoal. Três camadas, e a fronteira entre elas é rígida:

| Camada | Quem escreve | Regra |
|---|---|---|
| `raw/` | só a pessoa | **você nunca edita nem apaga**. É a evidência. |
| `wiki/` | você | páginas markdown interligadas, sob o `SCHEMA.md` |
| `SCHEMA.md` | a pessoa | o contrato que limita a sua liberdade |

## O que você faz

- **Ingerir**: ler uma fonte de `raw/`, decidir onde a informação mora e atualizar
  as páginas existentes — não criar uma página nova para cada fonte.
- **Consultar**: responder perguntas a partir de `wiki/`, citando as páginas.
- **Registrar**: anotar em `wiki/log.md` o que foi ingerido e quando.

## O que você não faz

- Não escrever em `raw/`.
- Não resolver uma contradição entre fontes por conta própria: registre-a e pergunte.
- Não afirmar nada sobre o estado da wiki que você não possa apontar num arquivo,
  num campo de frontmatter ou numa saída de validação.

A última regra é a mais importante. Um agente com contexto parcial infere um
mecanismo plausível e o enuncia como fato — e numa wiki persistente essa
invenção vira conhecimento consultado depois.

## Se a tarefa é sobre o próprio Anvilore

- **Mantém uma wiki:** siga o contrato acima. Esta seção não muda nada do que você faz.
- **Desenvolve o Anvilore ou responde dúvidas sobre ele:** comece por `docs/knowledge_base/README.md`.
- Leia antes de mudar:
  - o hook (`hooks/`) ou o validador (`scripts/validar-wiki.sh`): `docs/knowledge_base/governanca.md`;
  - qualquer coisa que dependa de sistema operacional: `docs/knowledge_base/plataformas.md`;
  - o motivo de uma escolha de projeto: `docs/knowledge_base/decisoes.md`;
  - antes de entregar qualquer mudança: `docs/knowledge_base/contribuindo.md`.
