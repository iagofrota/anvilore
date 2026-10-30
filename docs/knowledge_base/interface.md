---
generated: 2026-10-29
---

# Interface local (`anvilore ui`)

Como a interface web local é montada e como acrescentar uma tela. Quem só mantém uma wiki não precisa
desta página. As decisões de fundo (servidor opcional, aprovação pelo servidor) estão em
[decisoes.md](decisoes.md).

## Telas de hoje

| Tela | Endereço | O que mostra | Código |
|---|---|---|---|
| Início | `#/inicio` (a tela inicial) | Atalhos de ingestão e revisão, rascunhos, atividade do log, saúde e fontes de `raw/` sem ingestão. | `ui/web/inicio.tsx`, `src/lib/ui-inicio.ts` |
| Chat de ingestão | `#/chat` e `#/chat/<id>` | Fonte, leitura, parada, escrita e fechamento. | `ui/web/chat.tsx`, `src/lib/ui-ingestao.ts` |
| Revisão | `#/revisao` | Fila de rascunhos, mudanças e Aprovar. | `ui/web/main.tsx`, `src/lib/ui-fila.ts` |

Endereço vazio ou desconhecido abre o Início (`lerRota` em `ui/web/navegacao.ts`).

## O que o Início mostra e de onde vem

- **Para revisar:** a mesma fila da Revisão (`listarFilaRascunhos`), com a contagem e as cinco primeiras páginas.
- **Atividade recente:** as entradas `## [AAAA-MM-DD] tipo | resumo` dos arquivos de dia em `wiki/log/`, as mais novas
  primeiro (`atividadeRecente`). O índice `wiki/log.md` é gerado e não entra.
- **Saúde da wiki:** o servidor roda `validarWiki`, `auditarWiki` e `listarLacunas --consultar` em processo
  (`saudeDaWiki`). A pessoa nunca recebe um comando para rodar. Se só falta aprovar páginas geradas, a tela diz
  que é o portão funcionando, não um erro. Os três só leem.
- **Em raw/, sem ingestão:** arquivo de `raw/` que nenhuma página da wiki cita em `sources[].resource` nem em
  `original_file` (`fontesSemIngestao`). Link simbólico em `raw/` não é seguido. Se há uma conversa de ingestão aberta
  para o arquivo, a linha oferece **Continuar**.

A tela abre com um único `GET /api/inicio`, que traz tudo, inclusive a saúde (campo `saude`, com a mesma forma de
`GET /api/saude`). O servidor valida a wiki uma vez por pedido e não guarda nada: `validarWiki` lê a wiki inteira de
forma síncrona, então a carga a paga uma vez só, e cada carga vê a wiki como ela está. **Validar agora** chama
`GET /api/saude`, que valida na hora. As duas rotas exigem o token e o Host local, como as demais
(`src/ui/servidor/servidor.ts`).

## Como acrescentar uma tela (Nota, Biblioteca, Onboarding)

1. Em `ui/web/navegacao.ts`: acrescente o nome em `Tela`, um item em `MENU` e o caso em `lerRota` e `hashDaRota`.
2. Escreva a tela como um `<main className="main">…</main>` em `ui/web/<tela>.tsx`. A parte sem hooks e sem rede
   fica num componente à parte, que se testa só com dados (veja `PainelDoInicio` e `tests/ui-web-inicio.test.tsx`).
3. Em `ui/web/main.tsx`, acrescente o caso no `switch` de `Aplicacao`. O casco com menu, conversas e agente é
   `Shell` (`ui/web/shell.tsx`); a tela só entrega o conteúdo.
4. Dados novos entram por uma rota `GET /api/...` em `src/ui/servidor/servidor.ts`, com a regra de negócio em `src/lib/`.
5. Rode `bun run build:ui` e inclua `src/ui/public/` no commit: é o artefato que o `anvilore ui` serve.
6. Cenários Dado/Quando/Então em `e2e/specs/<tela>.e2e.ts`, claro e escuro (modelo: `e2e/specs/inicio.e2e.ts`).

## O que não foi provado

- O Início foi testado com o Claude Code falso e com Chromium. Não há prova em navegador no Windows nem no macOS.
- **Ingerir** uma fonte que já está em `raw/` ainda não tem botão no Início: o Chat só cria a conversa a partir
  de um arquivo ou texto enviado. Hoje a lista só informa e leva à conversa aberta.
- A validação varre a wiki inteira a cada carga do Início e a cada **Validar agora**, de forma síncrona no servidor; em
  wiki muito grande ela demora e bloqueia o servidor enquanto roda. A tela mostra "Lendo a wiki…" até chegar.
