# Ensaio dos dez minutos

Roteiro reaproveitável para medir, com um agente de verdade, o que uma pessoa nova vive entre o `git clone` e a primeira
página aprovada. Os dez minutos são a **meta** do dono do projeto, não um resultado: o ensaio mede quanto levou e registra
o que quebrou. Os números e as correções dos ensaios já feitos estão em
`docs/knowledge_base/perguntas-frequentes.md`.

Este arquivo é conferência manual: nenhum teste automático o executa.

## Regras do ensaio

- **A persona só conhece o `README.md`.** Quem executa lê o README, o `AGENTS.md`, o `SCHEMA.md` e a skill
  `skills/ingest/SKILL.md`, e roda os comandos que eles mandam. Não lê código-fonte, testes, planos nem relatórios de
  ensaios anteriores: o que o README não explica é exatamente o achado.
- **Diretório descartável.** Clone a branch a testar numa pasta nova e vazia (`<dir-do-ensaio>`), de preferência com um
  `HOME`, um cache do Bun e um `TMPDIR` também dentro dela. Toda instalação usa `--destino <dir-do-ensaio>/anvilore` e
  `--alvo <agente>`. Nada vai para `~/.claude`, `~/.codex` ou outra configuração real, e nenhuma etapa faz commit nem push.
- **Um agente por rodada.** Repita o roteiro para cada agente que se quer cobrir (Claude Code, Codex, Gemini, Copilot).
  Anote o nome e a versão do agente e do Bun.
- **Sem dono disponível?** Dizer isso no relatório. A conversa dos Passos 2 e 4 da skill (takeaways e lista de páginas)
  pode ser substituída por um plano escrito pelo executor, registrado em arquivo; isso testa o fluxo mecânico, **não** a
  curadoria humana. Nunca grave `verified` para obter `VALIDACAO: PASS`.
- **Cronometre com o relógio do shell** (`date +%s`), um par início/fim por etapa. O tempo inclui leitura, decisão e
  comandos, não só CPU. Se o total parecer baixo demais para o trabalho de um modelo, diga isso em vez de "corrigir" o
  número.

## Etapas

| # | Etapa | O que fazer | Esperado |
|---|---|---|---|
| 1 | Pré-requisitos, clone e dependências | Conferir Bun e git; `git clone` da branch; `bun install --frozen-lockfile` | Dependências instaladas; o README diz como obter o Bun e o git |
| 2 | Simular e instalar | `bun src/cli.ts instalar --simular --destino <clone> --alvo <agente>`, depois a instalação real | Simulação diz "Nada foi alterado"; a instalação termina com "Próximo passo" (reabrir o agente e rodar o `init`) |
| 3 | Áreas | `bun src/cli.ts init --areas pessoal`; repetir; com `anvilore.toml` com `areas`, pedir uma área fora da lista | Áreas criadas; repetição sem mudanças; área fora da lista recusada nomeando a lista |
| 4 | Ingestão | Pedir ao agente que siga `skills/ingest/SKILL.md` e ingira `raw/exemplo/llm-wiki.md` | Páginas na área escolhida com `generated`; entrada em `wiki/log/log-AAAA-MM-DD.md`; `wiki/log.md` intocado; `raw/` idêntico (compare o hash antes e depois) |
| 5 | Validar e fechar | `bun src/cli.ts validar` e `bash scripts/fechar-wiki.sh wiki` | `FAIL` só por "página gerada sem aprovação humana", uma vez por página; nenhum outro erro |
| 6 | Doctor | `bun src/cli.ts doctor <clone>` | Código 0 com a trava do agente instalado ligada; outros agentes só no PATH aparecem como opcionais |
| 7 | Hook de `raw/` | Rodar o comando do hook gravado na configuração do agente com os payloads abaixo | Escrita em `raw/` sai 2; escrita em `wiki/` e leitura de `raw/` saem 0 |

Se o ensaio incluir a aprovação humana de verdade (uma pessoa lê as páginas e acrescenta `verified`), acrescente uma
etapa 8: `validar` e `fechar-wiki.sh` devem dar `VALIDACAO: PASS` e `FECHAMENTO: OK`.

### Payloads do hook (etapa 7)

Cada payload vai para a entrada padrão do comando de hook que o instalador gravou na configuração do agente, e também para
`bun src/cli.ts hook proteger-raw`. O formato do payload muda de agente para agente; use o do agente testado.

| Payload | Saída esperada |
|---|---|
| Escrita (`Write`, `apply_patch` ou equivalente) em `raw/exemplo/novo.md` | 2 |
| Edição de `raw/exemplo/llm-wiki.md` | 2 |
| Terminal: `rm raw/exemplo/llm-wiki.md` | 2 |
| Terminal: `echo oi > raw/exemplo/x.md` | 2 |
| Escrita em `wiki/pessoal/concepts/novo.md` | 0 |
| Terminal: `ls raw/exemplo` | 0 |

Isso confere a **decisão** do comando. Só uma sessão do agente aberta depois da instalação prova que o agente carrega o
hook; se o ensaio não abriu essa sessão, o relatório diz que não provou.

## O que registrar

Um relatório por agente, com:

1. Versões (agente, Bun, git), data e a revisão exata do clone.
2. A tabela de etapas: início, fim, duração em segundos, resultado e o que quebrou ou confundiu.
3. O total das sete etapas e, separado, o total com a redação do relatório.
4. Achados por gravidade, cada um com o trecho do README ou da skill que o provoca, o que aconteceu e uma sugestão.
5. As adaptações que a skill `ingest` precisou (subagentes, conversa com a pessoa, área, log), e se o contrato de três
   camadas foi mantido.
6. O que o ensaio **não** provou (sessão real do agente, aprovação humana, `skills/query`, outros sistemas operacionais).
7. Ressalvas de isolamento, por exemplo um comando que rodou sem `HOME` ou cache redirecionados.

## Critérios para dar o ensaio por bom

- Cada etapa termina com o esperado da tabela, ou o desvio está nos achados com a correção proposta.
- `raw/` ficou byte a byte igual (mesmo hash antes e depois).
- Nenhuma página nasceu sem `generated`, e nenhuma tem `verified` escrito pelo agente.
- O relatório diz quanto levou **de fato**, mesmo que passe de dez minutos.
