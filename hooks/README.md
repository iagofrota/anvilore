# hooks/

O `AGENTS.md` diz, em prosa, que `raw/` é imutável para o agente. Prosa é uma
promessa que depende de o agente lembrar dela a cada turno. Este diretório é a
mesma regra com dentes.

## A regra mora num lugar só

```
hooks/proteger-raw.sh    a decisão: "este caminho é uma escrita em raw/?"
hooks/hooks.json         uma forma de configuração, apontando para o script
```

`proteger-raw.sh` lê, na entrada padrão, o payload JSON que o agente entrega
antes de executar uma ferramenta de escrita, procura o caminho alvo e sai com
código `2` quando ele está dentro de `raw/`. O motivo vai para o stderr, que é
o canal que os agentes devolvem ao modelo.

Toda forma de configuração abaixo **aponta para esse script por caminho**.
Nenhuma reimplementa a regra, e é isso que faz de `raw/` uma fronteira com um
dono só: mudar a decisão é editar um arquivo, não lembrar de quatro.

Rodar à mão, sem nenhum agente envolvido:

```bash
printf '{"tool_input":{"file_path":"raw/exemplo/teste.md"}}' | bash hooks/proteger-raw.sh; echo $?   # 2
printf '{"tool_input":{"file_path":"wiki/exemplo/teste.md"}}' | bash hooks/proteger-raw.sh; echo $?  # 0
```

O script aceita mais de uma grafia de chave (`file_path`, `filePath`, `path`,
…) e procura em qualquer profundidade do payload, porque a decisão é sobre o
caminho e não sobre o formato de um agente específico. Se não houver como
isolar o caminho, ele **falha fechado**: recusa em vez de deixar passar. Isso
vale para os três casos em que o caminho não sai do payload — JSON inválido,
máquina sem leitor de JSON, e JSON válido em que **nenhuma** chave reconhecida
aparece. O terceiro não é hipotético: é a forma do Codex CLI abaixo, que
carrega o caminho alvo dentro do corpo do patch. Nesses casos a decisão passa a
ser sobre o texto inteiro do payload — grosseira, podendo recusar demais, que é
o lado certo de errar num hook de proteção:

```bash
printf '{"tool_input":{"patch":"*** Update File: raw/exemplo/x.md"}}'  | bash hooks/proteger-raw.sh; echo $?  # 2
printf '{"tool_input":{"patch":"*** Update File: wiki/exemplo/x.md"}}' | bash hooks/proteger-raw.sh; echo $?  # 0
```

## As formas por agente

Este repositório versiona uma forma pronta (a de `hooks.json`) e **documenta** o
formato esperado das demais. Instalar cada uma na máquina de quem clona é outro
assunto, e ainda não está feito aqui.

| Agente | Arquivo de configuração | Evento | Estado |
|---|---|---|---|
| Claude Code | `hooks/hooks.json` (fundido no `.claude/settings.json` do projeto) | `PreToolUse`, matcher `Write\|Edit\|NotebookEdit` | **versionado aqui**, instalado por `instalar.sh` |
| Codex CLI | `.codex/config.toml` | `[[hooks.PreToolUse]]`, matcher `apply_patch\|Edit\|Write` | instalado por `instalar.sh` |
| Gemini CLI | `.gemini/settings.json` | `hooks.BeforeTool`, matcher `write_file\|replace` | instalado por `instalar.sh` |
| Copilot CLI | `.github/copilot/settings.json` | `hooks.preToolUse` | instalado por `instalar.sh` |

Cada forma abaixo traz a fonte da convenção. Formato sem referência é palpite, e
quem vier depois não tem como saber se pode confiar nele.

### Codex CLI — `.codex/config.toml`

```toml
[[hooks.PreToolUse]]
matcher = "apply_patch|Edit|Write"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "./hooks/proteger-raw.sh"
```

Fonte: <https://learn.chatgpt.com/docs/hooks> (acesso em 2026-09-22). O matcher
de edição de arquivo aceita `apply_patch`, `Edit` e `Write`; os três entram,
porque o mesmo agente edita por mais de um caminho.

### Gemini CLI — `.gemini/settings.json`

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          { "name": "proteger-raw", "type": "command", "command": "./hooks/proteger-raw.sh" }
        ]
      }
    ]
  }
}
```

Fonte: <https://geminicli.com/docs/hooks/reference/> (acesso em 2026-09-22) para
o evento e a forma; <https://geminicli.com/docs/reference/tools/> (mesmo acesso)
para os nomes `write_file` e `replace`, que são as duas ferramentas de escrita.

### Copilot CLI — `.github/copilot/settings.json`

```json
{
  "hooks": {
    "preToolUse": [
      { "type": "command", "bash": "./hooks/proteger-raw.sh" }
    ]
  }
}
```

Fonte: <https://docs.github.com/en/copilot/reference/hooks-reference> (acesso em
2026-09-22).

> **Correção.** Até a onda anterior este documento descrevia, para o Copilot CLI,
> um evento `hooks.toolCall` com um campo `"phase": "before"` no payload. **Isso
> não existe.** A referência oficial não traz evento `toolCall` nem campo
> `phase`: o evento que roda antes da ferramenta chama-se `preToolUse` (com
> `PreToolUse` aceito por compatibilidade), e a entrada é
> `{ "type": "command", "bash": ... }`. A forma antiga foi escrita a partir de
> documentação lida de segunda mão e nunca exercitada — exatamente o risco que
> a seção abaixo anunciava. Ficou registrada aqui, e não apagada, porque quem
> tiver copiado a forma errada precisa saber que ela era errada.
>
> Este evento **não tem `matcher`**: ele roda em toda chamada de ferramenta.
> Como `proteger-raw.sh` decide pelo caminho e sai `0` quando ele não é de
> `raw/`, rodar sempre é inofensivo.

## O que está verificado, e o que não está

O que está provado por teste (`tests/test-proteger-raw.sh`) é o **script**: que
ele bloqueia `raw/`, que ele **não** bloqueia `wiki/` na mesma execução, que um
payload sem chave de caminho reconhecida citando `raw/` também é bloqueado (com
o controle fora de `raw/` passando na mesma execução), e que desativar a
condição de decisão faz o bloqueio desaparecer — sem essa última prova, o teste
não estaria medindo nada.

Instalar essas formas na máquina de quem clona é trabalho de `instalar.sh`, e
`tests/test-instalar.sh` prova que cada uma chega ao disco no arquivo certo,
referenciando o script por caminho em vez de reimplementar a decisão.

**Só a forma do Claude Code foi exercitada de ponta a ponta com um agente de
verdade** — sessão real, skill invocada, escrita em `raw/` recusada (ver
`tests/test-instalar-agente-real.sh`). Codex, Gemini e Copilot estão instalados
na forma que a documentação oficial de cada um descreve, com a fonte citada
acima, mas **nenhum dos três foi executado**. É menos do que prova por execução,
e está dito aqui para não ser confundido com ela.

---

_Este diretório é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
