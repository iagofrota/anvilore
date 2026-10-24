---
generated: 2026-10-24
---

# Plataformas

**Alvo:** Linux, Windows nativo e macOS, os três obrigatórios. É decisão do dono do projeto em
2026-10-23. O estado de hoje é mais estreito, e esta página separa o que já está tratado no código
do que ainda é só hipótese.

## Estado de hoje

- O `README.md` ainda diz que o suporte é só Linux. O hook declara "Alvo declarado: Linux"
  (`hooks/proteger-raw.sh`, linha 19) e o instalador avisa que os caminhos, os links simbólicos e o
  `PATH` assumem Linux (`instalar.sh`, linha 22).
- Os scripts atuais dependem de `jq`, `python3` e de utilitários de shell
  (`hooks/proteger-raw.sh`, linhas 64 a 72; `instalar.sh`, linhas 167 e 201). Eles somem com o porte
  para TypeScript.
- Os testes antigos são scripts bash (`tests/test-*.sh`) e o `--help` do instalador declara Linux
  (`tests/test-instalar.sh`, linhas 96 a 107). Eles não são o que roda no CI de hoje.
- O que já roda nos três sistemas é a parte nova: o CI executa `bun run checar` em Ubuntu, Windows e
  macOS (`.github/workflows/ci.yml`, matriz `os`).
- O `.gitattributes` fixa `eol=lf` para texto, Markdown e TypeScript, para o checkout no Windows
  não trazer CRLF.

## Riscos: hipóteses até o CI provar

Nada abaixo foi observado em Windows ou macOS. O dono do projeto não tinha máquina desses sistemas
nem CI neles quando o risco foi levantado. Cada item diz o que a biblioteca em `src/lib/` já trata.
"Trata" quer dizer que há código e teste; só a execução nos três sistemas confirma.

### Windows

| Risco | O que a biblioteca já trata | Falta |
|---|---|---|
| Fim de linha CRLF (checkout no Windows) | `normalizarFimDeLinha` (`src/lib/caminhos.ts`) e `linhasDe` (`src/lib/frontmatter.ts`) leem CRLF como LF. Teste: `tests/lib-frontmatter.test.ts`. | Os scripts em bash e Python ainda não usam a biblioteca. |
| BOM no início do arquivo | `linhasDe` tira o BOM antes de procurar o frontmatter. | Idem. |
| Caminho com barra invertida, `raw.`, `raw ` ou unidade `C:` | `estaEmRaw` (`src/lib/caminhos.ts`) separa por barra, barra invertida e `:`, tira ponto e espaço do fim e ignora a caixa. Teste: `tests/lib-caminhos.test.ts`. | O hook em TypeScript ainda não existe; o hook ativo é `hooks/proteger-raw.sh`. Falta também resolver o caminho e o link simbólico antes de comparar. |
| Links simbólicos | Nada. `instalar.sh` liga cada skill com `ln -s` (linha 158). | No Windows, link simbólico costuma exigir modo desenvolvedor ou administrador. Uma junção do NTFS provavelmente dispensa o privilégio. A decisão ainda não foi tomada. Se for preciso copiar, o instalador deve avisar de forma explícita, nunca cair para cópia calada. |
| Dependências do sistema (`jq`, `python3`, `awk`, `mktemp`, `readlink`) | Somem com o porte. | O `git` continua necessário; o diagnóstico de ambiente ainda não existe. |
| Latência do hook | Nada medido. | O hook roda a cada gravação do agente. Um processo Bun novo por gravação precisa de latência aceitável: **medir antes de declarar**. |

### macOS

| Risco | O que a biblioteca já trata | Falta |
|---|---|---|
| Maiúsculas e minúsculas: o disco padrão não diferencia Pagina.md de pagina.md | `chaveDeNome` (`src/lib/caminhos.ts`) compara em minúsculas. | O validador em TypeScript, que apontaria o conflito por caixa, ainda não foi portado. |
| Nome de arquivo com acento decomposto (`e` mais acento no lugar de `é`) | `chaveDeNome` normaliza para NFC antes de comparar. `slugDe` (`src/lib/frontmatter.ts`) tira a extensão do nome. | Idem. |

A função `estaEmRaw` (`src/lib/caminhos.ts`), que o futuro hook em TypeScript vai usar, ignora a
caixa, porque no macOS e no Windows Raw/a.md é a mesma pasta `raw/`. Com ela, no Linux uma pasta
chamada Raw seria bloqueada (falha fechada, de propósito). O hook **ativo**,
`hooks/proteger-raw.sh`, diferencia a caixa (linha 29): hoje Raw/a.md passa por ele. Veja
[governanca.md](governanca.md).

## O que esta página não afirma

- Que o CI esteja verde nos três sistemas. Quem quiser afirmar isso precisa olhar a execução.
- Qualquer número de latência.
- Que o instalador funcione fora do Linux.

Quando o CI rodar e provar ou desmentir cada risco, ajuste a linha correspondente e peça a revisão
por pessoa (veja [contribuindo.md](contribuindo.md)).

Contexto da escolha de plataforma: [decisoes.md](decisoes.md).
