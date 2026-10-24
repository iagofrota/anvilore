---
generated: 2026-10-24
---

# Contribuindo

Como rodar, testar e entregar uma mudança no Anvilore. Quem só **mantém uma wiki** não precisa
desta página.

## Rodar e testar

```bash
bun install
bun run checar
```

- `bun install` instala só dependências de desenvolvimento (`package.json`). O `bun.lock` é
  versionado, e o CI usa `bun install --frozen-lockfile`.
- `bun run checar` roda `tsc --noEmit` e `bun test --coverage` (script `checar` em
  `package.json`). A cobertura mínima é 80% no geral (`bunfig.toml`). A meta de 95% em validação e
  proteção de `raw/`, declarada pelo dono do projeto, ainda não tem trava por arquivo (veja
  [governanca.md](governanca.md)).
- O Bun usado no CI vem do campo `packageManager` de `package.json`.
- Para conferir esta pasta: `bun src/cli.ts checar-docs`. Para simular a trava de release:
  `bun src/cli.ts checar-release 0.1.0`.
- Os testes antigos em bash continuam em `tests/test-*.sh`, para o código que ainda é bash. Rode
  cada um com `bash tests/test-validar-wiki.sh`, por exemplo. O alvo deles é Linux: o instalador
  declara isso (`instalar.sh`, linhas 21 e 22) e `tests/test-instalar.sh` confere que o `--help`
  diz Linux e não promete Windows nem macOS (linhas 96 a 107).

O CI roda `bun run checar` e `checar-docs` em Ubuntu, Windows e macOS a cada push e pull request
(`.github/workflows/ci.yml`). Uma mudança que passa só no seu sistema não está pronta.

## Testes primeiro, com cenários em gherkin

- Escreva o teste antes do código e veja-o falhar.
- O nome do teste é o cenário: `Dado ... Quando ... Então ...`. Não há cucumber nem biblioteca de
  gherkin. Exemplo real: `tests/checar-docs.test.ts`.
- Todo módulo de `src/` é importado por `tests/cobertura.test.ts` para entrar na cobertura. Por
  isso importar um módulo não pode ter efeito colateral: o `import.meta.main` em `src/cli.ts` é o
  modelo.
- Uma peça portada de bash ou Python não pode se comportar diferente da original: mesmos códigos
  de saída e mesmas mensagens que os testes antigos conferem.
- Nunca pule uma checagem em silêncio. Dependência ausente, YAML inválido ou diretório
  inexistente reprova ou avisa; não vira "PASS".

## Adicionar um subcomando

1. Escreva o teste em `tests/`.
2. Crie o módulo em `src/comandos/`, exportando a função do comando.
3. Registre-o na tabela de `src/cli.ts`.
4. Se ele deve rodar no CI, acrescente a etapa em `.github/workflows/ci.yml`.

## CHANGELOG a cada mudança

Toda mudança acrescenta uma linha em `[Unreleased]` do `CHANGELOG.md`, no momento em que é feita, em
linguagem simples (quem lê é o gestor, não só o programador; decisão do dono do projeto em
2026-10-23). O formato é o Keep a Changelog, com
Versionamento Semântico.

## Knowledge base junto com o código

- Mudou um comportamento: atualize a página correspondente no mesmo momento.
- Cada página cita os arquivos que sustentam o que diz. Para apontar uma linha, escreva "linha N"
  no texto, fora das crases, porque o `checar-docs` confere que o arquivo existe, e um arquivo com
  o número da linha colado ao nome não existe.
- Prefira a âncora estável a "linha N": o nome da função, o título da seção, a chave do campo.
  Linha envelhece a cada edição do arquivo citado, e o `CHANGELOG.md` muda a cada tarefa; cite-o
  pelo título da seção. Quem muda um arquivo que alguma página cita por linha reconfere a citação
  (`sed -n` na linha) no mesmo commit.
- Link relativo (`[texto](pagina.md)`) resolve a partir da página. Menção entre crases resolve a
  partir da raiz do repositório e só conta quando parece caminho: sem espaço, sem `*`, `<` ou `>`,
  que não seja URL, e que contenha `/` ou termine em extensão de arquivo conhecida. A âncora
  (`#...`) é descartada, e blocos de código cercados são ignorados. Link e menção que resolvem
  para fora da raiz do repositório reprovam, mesmo que o arquivo exista na máquina. O texto de um
  link pode atravessar linhas; o problema aponta a linha onde o link começa. Veja o código em
  `src/comandos/checar-docs.ts`.
- **Nome hipotético ou relativo a outra pasta, entre crases, reprova como falso positivo.** Se a
  menção parece caminho e não existe a partir da raiz, o `checar-docs` não sabe que era um
  exemplo ou que o arquivo mora em outra pasta. Há duas saídas: escrever o caminho a partir da raiz
  (com a pasta, em vez do nome solto do arquivo, como `docs/knowledge_base/decisoes.md`) ou escrever o nome sem crases.
- **O que o `checar-docs` não confere** (não é suportado hoje; não conte com ele): link de
  referência (`[texto][ref]` com `[ref]: alvo`), alvo entre `<...>` (`<a b.md>`), texto de link
  com colchete dentro (`[a [b] c](x.md)`), e menção a dotfile ou a nome sem extensão e sem barra
  (`.gitignore`, `LICENSE`). Para esses, a conferência é da revisão por pessoa. Uma extensão fora da
  lista fechada de `src/comandos/checar-docs.ts` também não conta.
- Um agente pode redigir a página, com `generated: AAAA-MM-DD` no cabeçalho. **Só uma pessoa
  acrescenta `verified: AAAA-MM-DD`**, depois de ler a página e conferir os arquivos citados.
  Agente nenhum deve pôr esse campo.
- Páginas sobre código que ainda vai ser substituído não se escrevem. Elas nascem quando o código
  novo é integrado.

## Como a release é travada

1. A seção `## [x.y.z]` do `CHANGELOG.md` precisa existir e ter pelo menos um item entregue.
2. Toda página de `docs/knowledge_base/` precisa de `verified: AAAA-MM-DD`.
3. `bun src/cli.ts checar-release x.y.z` confere os dois pontos
   (`src/comandos/checar-release.ts`). O CI o roda só quando a tag de versão é criada
   (`.github/workflows/ci.yml`, última etapa).

A trava roda depois que a tag existe, então ela sinaliza mas não impede. Por isso o procedimento
tem esta ordem:

1. Passe o conteúdo de `[Unreleased]` para a seção `## [x.y.z] - AAAA-MM-DD` do `CHANGELOG.md`, com
   o que foi entregue e o que não foi resolvido, e deixe `[Unreleased]` vazio acima dela.
2. Rode `bun run checar` e `bun src/cli.ts checar-docs`. Os dois devem sair com 0.
3. Rode `bun src/cli.ts checar-release x.y.z` **na sua máquina, antes de criar a tag**. Ele deve
   sair com 0. Se reprovar, corrija antes de seguir; não crie a tag para ver o que o CI diz.
4. Só então peça a aprovação do dono do projeto. A tag e a release saem apenas com o "sim"
   explícito dele.

A seção `[0.1.0]` já está preenchida. Enquanto nenhuma página desta pasta tiver sido revisada por
pessoa, `checar-release 0.1.0` reprova, e o motivo é só a falta de `verified`. Isso é o
comportamento esperado, e não deve ser contornado acrescentando `verified` sem revisão.

**Publicar exige aprovação explícita do dono do projeto, a cada vez** (decisão do dono do projeto
em 2026-10-23): criar tag, publicar pacote, abrir release no GitHub e enviar mudança de workflow.
Preparar a release é trabalho do contribuidor; publicá-la, não.
