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
| Claude Code | `hooks/hooks.json` (referenciado do `settings.json` do projeto) | `PreToolUse`, matcher `Write\|Edit\|NotebookEdit` | **versionado aqui** |
| Codex CLI | `config.toml` | `[[hooks.PreToolUse]]` com `matcher` | forma documentada abaixo |
| Gemini CLI | `.gemini/settings.json` | `hooks.BeforeTool`, matcher `write_file\|replace` | forma documentada abaixo |
| Copilot CLI | `settings.json` | `hooks.toolCall`, fase `before` | forma documentada abaixo |

### Codex CLI — `config.toml`

```toml
[[hooks.PreToolUse]]
matcher = "apply_patch"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "./hooks/proteger-raw.sh"
```

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

### Copilot CLI — `settings.json`

```json
{
  "hooks": {
    "toolCall": { "command": "./hooks/proteger-raw.sh", "shell": "bash" }
  }
}
```

O evento `toolCall` dispara antes **e** depois da ferramenta; o payload traz
`"phase": "before"` na primeira passagem. Como o script decide pelo caminho e
sai `0` quando ele não é de `raw/`, a passagem de depois é inofensiva — mas
filtrar pela fase é o que se espera de uma instalação caprichada.

## O que ainda não foi verificado

As três formas acima foram escritas a partir da documentação de cada agente e
**não foram executadas de ponta a ponta** neste repositório. O que está provado
por teste (`tests/test-proteger-raw.sh`) é o script: que ele bloqueia `raw/`,
que ele **não** bloqueia `wiki/` na mesma execução, que um payload sem chave de
caminho reconhecida citando `raw/` também é bloqueado (com o controle fora de
`raw/` passando na mesma execução), e que desativar a condição de decisão faz o
bloqueio desaparecer — sem essa última prova, o teste não estaria medindo nada.

Instalar essas formas na máquina de quem clona o repositório é trabalho do
instalador, que ainda não existe.

---

_Este diretório é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
