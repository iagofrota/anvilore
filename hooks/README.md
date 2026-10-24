# hooks/

O `AGENTS.md` diz, em prosa, que `raw/` é imutável para o agente. Prosa é uma
promessa que depende de o agente lembrar dela a cada turno. Este diretório é a
mesma regra com dentes.

## A regra mora num lugar só

```
src/comandos/hook-proteger-raw.ts   a decisão: "este caminho (ou comando) escreve em raw/?"
hooks/hooks.json                    uma forma de configuração, chamando o subcomando
```

O subcomando `anvilore hook proteger-raw` (`bun src/cli.ts hook proteger-raw`) lê, na
entrada padrão, o payload JSON que o agente entrega antes de executar uma
ferramenta, decide e sai com código `0` (segue) ou `2` (bloqueado). O motivo vai
para o stderr, que é o canal que os agentes devolvem ao modelo. Não precisa de
`jq` nem de Python: só do Bun, que o resto do kit já exige.

Toda forma de configuração abaixo **chama esse subcomando** e termina em
`|| exit 2`: se o Bun faltar ou o processo quebrar, o agente recebe bloqueio em
vez de seguir sem proteção (um hook que falha com outro código não bloqueia). Nenhuma
reimplementa a regra, e é isso que faz de `raw/` uma fronteira com um dono só:
mudar a decisão é editar um arquivo, não lembrar de quatro.

Rodar à mão, sem nenhum agente envolvido:

```bash
printf '{"tool_input":{"file_path":"raw/exemplo/teste.md"}}'  | bun src/cli.ts hook proteger-raw; echo $?  # 2
printf '{"tool_input":{"file_path":"wiki/exemplo/teste.md"}}' | bun src/cli.ts hook proteger-raw; echo $?  # 0
printf '{"tool_name":"Bash","tool_input":{"command":"rm raw/a.md"}}' | bun src/cli.ts hook proteger-raw; echo $?  # 2
printf '{"tool_name":"Bash","tool_input":{"command":"cat raw/a.md"}}' | bun src/cli.ts hook proteger-raw; echo $?  # 0
```

### Ferramentas de edição de arquivo

O hook aceita mais de uma grafia de chave (`file_path`, `filePath`, `path`, …) e
procura em qualquer profundidade do payload, porque a decisão é sobre o caminho
e não sobre o formato de um agente específico. O componente `raw` é comparado
sem diferenciar maiúsculas e aceita `\`, `raw.` e `C:raw` (`estaEmRaw`, em
`src/lib/caminhos.ts`); `rawdata/` e `wiki/raw-notas.md` passam.

Se não houver como isolar o caminho, ele **falha fechado**: recusa em vez de
deixar passar. Vale para JSON ilegível (bloqueia sempre) e para JSON válido em
que nenhuma chave de caminho reconhecida aparece: é a forma do Codex CLI
(`apply_patch`), que leva o caminho alvo dentro do corpo do patch. Aí a decisão
passa a ser sobre o texto inteiro do payload — grosseira, podendo recusar demais,
que é o lado certo de errar num hook de proteção:

```bash
printf '{"tool_input":{"patch":"*** Update File: raw/exemplo/x.md"}}'  | bun src/cli.ts hook proteger-raw; echo $?  # 2
printf '{"tool_input":{"patch":"*** Update File: wiki/exemplo/x.md"}}' | bun src/cli.ts hook proteger-raw; echo $?  # 0
```

Ferramentas de leitura (`Read`, `read_file`, `view`, `glob`, `grep`, …) passam
mesmo apontando para `raw/`: ingerir uma fonte exige lê-la. Isto importa no
Copilot, cujo evento roda em toda chamada de ferramenta.

### Ferramenta de terminal

O terminal escreve em `raw/` sem passar pelas ferramentas de edição, então o
mesmo hook avalia o comando (`Bash` no Claude Code e no Codex, `run_shell_command`
no Gemini, `bash`/`powershell` no Copilot). **Bloqueia** quando o comando
escreve ou apaga algo em `raw/`: redirecionamento `>`/`>>`, `tee`, `mv`, `cp` com
destino em `raw/`, `rm`, `rmdir`, `sed -i`/`w`/`e`, `perl` (qualquer script), `truncate`, `touch`, `ln`,
`chmod`, `find -delete`/`-exec`, `git mv`, `git rm`, `git checkout`/`restore`/`clean`/`apply`
e os equivalentes de PowerShell (`Remove-Item`, `Set-Content`, …). **Libera**
leituras (`cat`, `rg`, `grep`, `ls`, `head`, `tail`, `wc`, `stat`, `diff`, `git log`,
`Get-Content`, …). Um verbo que o hook não conhece e que cita `raw/` é
bloqueado: o erro cai do lado seguro, ao custo de falso positivo. `cd raw`
seguido de um comando com caminho relativo conta como escrita em `raw/`.
Comando que não dá para ler (aspas abertas, `$(...)`, crase) bloqueia **só se
citar `raw/`**; sem citação, passa.

Limites, ditos de propósito: o hook não executa nem expande shell. Variável
(`d=raw; rm $d/a`), subshell que monte o caminho, script externo (`bash limpa.sh`,
`python apaga.py`) e `sed 'w raw/x'`/`perl -e` não são vistos. Quem precisa de
garantia contra um agente hostil tem de usar permissão de sistema de arquivos;
o hook cobre o erro do agente, não o adversário. Ver `docs/knowledge_base/governanca.md`.

### Como saber que o hook rodou — `ANVILORE_LOG_HOOK`

Bloquear e nunca ser chamado deixam **o mesmo disco**: nos dois casos o arquivo
não aparece em `raw/`. Quem afirma "o hook bloqueou" a partir de "o arquivo não
está lá" está inferindo, não medindo — e a diferença importa, porque um agente
que leu o `AGENTS.md` e se recusou sozinho produz exatamente a mesma ausência,
sem o hook ter rodado uma vez.

Por isso o subcomando aceita `ANVILORE_LOG_HOOK`. Quando essa variável aponta para
um arquivo, cada invocação deixa uma linha `<epoch>\t<veredito>\t<alvo>`, com
`BLOQUEADO` ou `PASSOU`:

```bash
export ANVILORE_LOG_HOOK=/tmp/rastro.log
printf '{"tool_input":{"file_path":"raw/exemplo/x.md"}}'  | bun src/cli.ts hook proteger-raw
printf '{"tool_input":{"file_path":"wiki/exemplo/x.md"}}' | bun src/cli.ts hook proteger-raw
cat "$ANVILORE_LOG_HOOK"
# 1790000000	BLOQUEADO	caminho dentro de raw/: raw/exemplo/x.md
# 1790000000	PASSOU	wiki/exemplo/x.md
```

Sem a variável, nada é escrito: isto é **affordance de verificação** para quem
testa, não instrumentação de produção. O rastro observa a decisão e não
participa dela — ligá-lo não muda código de saída nenhum, e falha ao escrever o
rastro nunca altera o veredito. É sobre essa linha, e não sobre a ausência de um
arquivo, que `tests/test-instalar-agente-real.sh` assenta a asserção de D5.

## As formas por agente

Este repositório versiona uma forma pronta (a de `hooks.json`) e **documenta** o
formato esperado das demais. Instalar cada uma na máquina de quem clona é outro
assunto, e ainda não está feito aqui.

| Agente | Arquivo de configuração | Evento | Estado |
|---|---|---|---|
| Claude Code | `hooks/hooks.json` (fundido no `.claude/settings.json` do projeto) | `PreToolUse`, matcher `Write\|Edit\|NotebookEdit\|Bash` | **versionado aqui**, instalado por `anvilore instalar` |
| Codex CLI | `.codex/config.toml` | `[[hooks.PreToolUse]]`, matcher `apply_patch\|Edit\|Write\|Bash` | instalado por `anvilore instalar` |
| Gemini CLI | `.gemini/settings.json` | `hooks.BeforeTool`, matcher `write_file\|replace\|run_shell_command` | instalado por `anvilore instalar` |
| Copilot CLI | `.github/copilot/settings.json` | `hooks.preToolUse` | instalado por `anvilore instalar` |

Cada forma abaixo traz a fonte da convenção. Formato sem referência é palpite, e
quem vier depois não tem como saber se pode confiar nele.

### Codex CLI — `.codex/config.toml`

```toml
[[hooks.PreToolUse]]
matcher = "apply_patch|Edit|Write|Bash"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "bun ./src/cli.ts hook proteger-raw || exit 2"
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
        "matcher": "write_file|replace|run_shell_command",
        "hooks": [
          { "name": "proteger-raw", "type": "command", "command": "bun ./src/cli.ts hook proteger-raw || exit 2" }
        ]
      }
    ]
  }
}
```

Fonte: <https://geminicli.com/docs/hooks/reference/> (acesso em 2026-09-22) para
o evento e a forma; <https://geminicli.com/docs/reference/tools/> (mesmo acesso)
para os nomes `write_file` e `replace` (escrita) e `run_shell_command` (terminal, com
`command` e `dir_path` em `tool_input`).

### Copilot CLI — `.github/copilot/settings.json`

```json
{
  "hooks": {
    "preToolUse": [
      { "type": "command", "bash": "bun ./src/cli.ts hook proteger-raw || exit 2" }
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
> Este evento roda em toda chamada de ferramenta (a forma instalada não usa
> `matcher`). `toolName` é `bash` ou `powershell` no terminal e `toolArgs` pode
> chegar como texto JSON; o hook decodifica antes de decidir. Como ele sai `0`
> quando o alvo não é de `raw/`, rodar sempre é inofensivo.

## O que está verificado, e o que não está

O que está provado por teste (`tests/hook-proteger-raw.test.ts`) é o **subcomando**: que
ele bloqueia `raw/`, que ele **não** bloqueia `wiki/` na mesma execução, que um
payload sem chave de caminho reconhecida citando `raw/` também é bloqueado (com
o controle fora de `raw/` passando na mesma execução), e que desativar a
condição de decisão faz o bloqueio desaparecer — sem essa última prova, o teste
não estaria medindo nada.

Instalar essas formas na máquina de quem clona é trabalho de `anvilore instalar`, e
`tests/instalar.test.ts` prova que cada uma chega ao disco no arquivo certo,
chamando o subcomando em vez de reimplementar a decisão.

**Só a forma do Claude Code foi exercitada de ponta a ponta com um agente de
verdade** — sessão real, skill invocada, escrita em `raw/` recusada, e a recusa
provada pelo rastro do próprio hook (`ANVILORE_LOG_HOOK`) em vez de inferida da
ausência do arquivo, com o contrato em prosa removido do destino de teste para
que o agente não tivesse motivo textual para se recusar antes de chamar a
ferramenta (ver `tests/test-instalar-agente-real.sh`). Codex, Gemini e Copilot estão instalados
na forma que a documentação oficial de cada um descreve, com a fonte citada
acima, mas **nenhum dos três foi executado**. É menos do que prova por execução,
e está dito aqui para não ser confundido com ela.

---

_Este diretório é obra derivada de [`wiki-wonka`](https://github.com/cooperacode/wiki-wonka)
(Coopera Code, licença MIT), traduzida para português do Brasil e adaptada.
Aviso de copyright original em `LICENSE`._
