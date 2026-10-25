import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { checarDocs, comandoChecarDocs } from "../src/comandos/checar-docs";
import { executar, subcomandos } from "../src/cli";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-docs-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function gravar(relativo: string, conteudo: string): void {
  const caminho = join(raiz, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

function kb(pagina: string, conteudo: string): void {
  gravar(`docs/knowledge_base/${pagina}`, conteudo);
}

describe("checarDocs: referências", () => {
  for (const [caso, entrada] of [
    ["M6 crase escapada", "\\`<!--\n[x](sonda.md)"],
    ["M7 cerca depois de comentário", "<!-- c --> ~~~\n[x](sonda.md)\n~~~"],
    ["M8 comentário em span multilinha", "`codigo\ntexto <!--`\n[x](sonda.md)"],
    ["M9 comentário inline sem fecho", "texto <!-- aberto\n[x](sonda.md)"],
    ["comentário inline só fecha em outro parágrafo", "texto <!-- aberto\n\n[x](sonda.md)\n-->"],
    ["comentário inline só fecha depois de cerca", "texto <!-- aberto\n~~~\ncódigo -->\n~~~\n[x](sonda.md)"],
  ]) {
    test(`Dado ${caso} Quando checo Então o link quebrado real reprova`, () => {
      kb("README.md", entrada!);
      const r = checarDocs(raiz);
      expect(r.ok).toBe(false);
      expect(r.problemas.join("\n")).toContain("sonda.md");
    });
  }
  for (const [caso, entrada] of [
    ["C09 crase sem par num item e outra no item seguinte", "- Rode `bun run checar antes do commit.\n- Veja [guia](sonda.md) e `src/x.ts`."],
    ["C10 crase sem par num item continuado", "- Rode `bun run checar\n  antes do commit.\n- Veja [guia](sonda.md) e `src/x.ts`."],
    ["item numerado com ponto", "1. Rode `bun x\n2. Veja [guia](sonda.md) e `y`."],
    ["item numerado com parêntese", "1) Rode `bun x\n2) Veja [guia](sonda.md) e `y`."],
    ["item com asterisco", "* Rode `bun x\n* Veja [guia](sonda.md) e `y`."],
    ["item com mais", "+ Rode `bun x\n+ Veja [guia](sonda.md) e `y`."],
    ["C12 comentário inline num item e fecho dois itens depois", "- nota <!-- revisar\n- Veja [guia](sonda.md)\n- fim -->"],
    ["C03 crase sem par antes de uma citação", "Rode `bun x\n> Veja [guia](sonda.md) e `y`."],
    ["C05 comentário inline antes de uma citação", "texto <!-- nota\n> Veja [guia](sonda.md)\n-->"],
    ["C02 crase sem par antes de um título ATX", "Rode `bun x\n## Seção [guia](sonda.md) e `y`"],
    ["C04 crase sem par antes de uma régua", "Rode `bun x\n***\n[guia](sonda.md) e `y`"],
    ["crase sem par antes de uma régua com hífens", "Rode `bun x\n---\n[guia](sonda.md) e `y`"],
    ["A17 comentário inline antes de um título", "texto <!-- nota\n# Seção [guia](sonda.md) -->"],
  ]) {
    test(`Dado ${caso} Quando checo Então o link quebrado real reprova`, () => {
      kb("README.md", entrada!);
      const r = checarDocs(raiz);
      expect(r.ok).toBe(false);
      expect(r.problemas.join("\n")).toContain("sonda.md");
    });
  }

  test("Dado A19 um '<' no meio de destino comum quebrado Quando checo Então reprova nomeando o alvo", () => {
    kb("README.md", "[x](quebr<ado.md)");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("quebr<ado.md");
  });

  for (const [caso, entrada] of [
    ["A04 texto de link em duas linhas de uma citação", "> [texto\n> longo](sonda.md)"],
    ["R11 citação dentro de citação", "> > [a\n> > b](sonda.md)"],
    ["R12 item dentro de citação continuado", "> - [a\n>   b](sonda.md)"],
    ["R01 crase sem par numa citação de várias linhas", "> veja `a\n> b` e [x](sonda.md) `c`"],
    ["R04 ano com ponto no começo da linha seguinte", "[ver o\n2024. relatorio](sonda.md)"],
    ["R06 número 2 com parêntese no começo da linha seguinte", "[ver\n2) b](sonda.md)"],
    ["R05 linha 2024. no meio de um code span", "veja `a\n2024. b` e [x](sonda.md) `c`"],
    ["lista numerada separada por linha em branco não vale para o parágrafo seguinte", "1. a\n\nveja `x\n2) b` e [guia](sonda.md) `c`"],
    ["item 2. depois de continuação de um item 1.", "1. Rode `x\n   continua\n2. Veja [guia](sonda.md) e `y`."],
  ]) {
    test(`Dado ${caso} Quando checo Então o link quebrado real reprova`, () => {
      kb("README.md", entrada!);
      const r = checarDocs(raiz);
      expect(r.ok).toBe(false);
      expect(r.problemas.join("\n")).toContain("sonda.md");
    });
  }

  for (const [caso, entrada] of [
    ["R14 comentário inline fechado dentro de uma citação", "> nota <!-- c\n> [x](nao-existe.md) -->"],
    ["R15 code span que atravessa linhas de uma citação", "> veja `a\n> [x](nao-existe.md) b` c"],
    ["R16 code span que atravessa uma linha 2024.", "ver `a\n2024. [x](nao-existe.md) b` c"],
  ]) {
    test(`Dado ${caso} Quando checo Então o link dentro do código ou comentário não é conferido`, () => {
      kb("README.md", entrada!);
      expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
    });
  }

  for (const [caso, entrada] of [
    ["crase com par na mesma linha de um item", "- Veja `a` e `b`\n- Outro item"],
    ["code span legítimo continuado com recuo", "- Rode `bun\n  run` antes\n- Outro"],
    ["hífen colado no texto não é item", "Rode `bun\n-x run` antes"],
    ["ano no começo da linha não é item", "Rode `bun\n2024x run` antes"],
  ]) {
    test(`Dado ${caso} Quando checo Então não reprova nem acusa link`, () => {
      kb("README.md", entrada!);
      expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
    });
  }

  test("Dado uma página que cita um arquivo inexistente, Quando checo, Então reprova nomeando a página e o arquivo", () => {
    kb("governanca.md", "# Governança\n\nVeja `src/nao-existe.ts`.\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("docs/knowledge_base/governanca.md");
    expect(r.problemas[0]).toContain("src/nao-existe.ts");
  });

  test("Dado uma menção entre crases a arquivo que existe na raiz, Quando checo, Então passa", () => {
    gravar("src/cli.ts", "");
    kb("README.md", "Veja `src/cli.ts` e `src/`.\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma menção entre crases, Quando checo, Então ela resolve a partir da raiz e não da página", () => {
    gravar("docs/knowledge_base/outra.md", "");
    kb("README.md", "Veja `outra.md` e `docs/knowledge_base/outra.md`.\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("`outra.md`");
  });

  test("Dado um link relativo quebrado, Quando checo, Então reprova nomeando a página e o alvo", () => {
    kb("README.md", "Leia [as decisões](decisoes.md).\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("docs/knowledge_base/README.md");
    expect(r.problemas[0]).toContain("decisoes.md");
  });

  test("Dado `<!--` entre crases numa linha e um link quebrado na seguinte, Quando checo, Então reprova apontando o link", () => {
    kb("README.md", "Use `<!--` para abrir comentário.\n[Quebrado](nao-existe-5.md)\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("nao-existe-5.md");
    expect(r.problemas[0]).toContain("(linha 2)");
  });

  test("Dado `<!--` no texto de informação de uma cerca e um link quebrado depois do bloco, Quando checo, Então reprova apontando o link", () => {
    kb("README.md", "```js <!--\ninterno\n```\n[Quebrado](nao-existe-6.md)\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("nao-existe-6.md");
    expect(r.problemas[0]).toContain("(linha 4)");
  });

  test("Dado um span de duas crases com crase e link dentro (reprodução do Codex), Quando checo, Então o exemplo inteiro é código e passa", () => {
    kb("README.md", "Exemplo: ``a `[example](missing.md)` b`` fim.\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado um span de duas crases que atravessa a linha com link dentro, Quando checo, Então o link não conta", () => {
    kb("README.md", "Exemplo: ``a `[x\ny](missing.md)` b`` fim.\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma menção a arquivo inexistente num span de duas crases, Quando checo, Então reprova", () => {
    kb("README.md", "Veja ``src/nao-existe-7.ts`` aqui.\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("src/nao-existe-7.ts");
  });

  test("Dado `<!-->` seguido de link quebrado na linha de baixo, Quando checo, Então reprova apontando o link", () => {
    kb("README.md", "Comentário vazio <!--> aqui.\n[Quebrado](nao-existe-8.md)\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("nao-existe-8.md");
  });

  test("Dado um link relativo, Quando checo, Então ele resolve a partir da página, mesmo numa subpasta", () => {
    gravar("README.md", "");
    kb("README.md", "Veja [a raiz](../../README.md).\n");
    kb("sub/pagina.md", "Veja [a raiz](../../../README.md) e [a irmã](../README.md).\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado um link cujo texto atravessa a linha, Quando o alvo não existe, Então reprova apontando a linha onde o link começa", () => {
    kb("README.md", "# T\n\nLeia [as decisões do\nprojeto](nao-existe-1.md) com calma.\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("docs/knowledge_base/README.md");
    expect(r.problemas[0]).toContain("nao-existe-1.md");
    expect(r.problemas[0]).toContain("linha 3");
  });

  test("Dado um link cujo texto atravessa a linha, Quando o alvo existe, Então passa", () => {
    kb("outra.md", "");
    kb("README.md", "Leia [as decisões do\nprojeto](outra.md).\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado um colchete aberto e uma linha em branco antes do link, Quando checo, Então o link não começa no colchete solto", () => {
    kb("README.md", "Sobrou um [colchete\n\nOutro parágrafo [x](nao-existe-2.md).\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("linha 3");
  });

  test("Dado um link com título entre aspas simples, Quando checo, Então só o alvo é conferido", () => {
    gravar("LICENSE", "");
    kb("README.md", "[a](../../LICENSE 'licença') [b](nao-existe-3.md 'título')\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("nao-existe-3.md");
  });

  test("Dado um link entre crases que atravessa a linha, Quando checo, Então ele não conta como link", () => {
    kb("README.md", "Escreva `[texto\nlongo](nao-existe-4.md)` assim.\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado um link que resolve para fora da raiz do repositório, Quando o arquivo existe na máquina, Então reprova nomeando a página e o alvo", () => {
    const fora = `externo-${process.pid}.md`;
    const caminhoFora = join(dirname(raiz), fora);
    writeFileSync(caminhoFora, "");
    try {
      kb("README.md", `[x](../../../${fora})\n`);
      const r = checarDocs(raiz);
      expect(r.ok).toBe(false);
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]).toContain("docs/knowledge_base/README.md");
      expect(r.problemas[0]).toContain(`../../../${fora}`);
      expect(r.problemas[0]).toContain("fora da raiz");
    } finally {
      rmSync(caminhoFora, { force: true });
    }
  });

  test("Dado uma menção entre crases que sai da raiz, Quando checo, Então reprova nomeando a página e o alvo", () => {
    const fora = `externo-mencao-${process.pid}.md`;
    const caminhoFora = join(dirname(raiz), fora);
    writeFileSync(caminhoFora, "");
    try {
      kb("README.md", `Veja \`../${fora}\`.\n`);
      const r = checarDocs(raiz);
      expect(r.ok).toBe(false);
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]).toContain("docs/knowledge_base/README.md");
      expect(r.problemas[0]).toContain(`../${fora}`);
      expect(r.problemas[0]).toContain("fora da raiz");
    } finally {
      rmSync(caminhoFora, { force: true });
    }
  });

  test("Dado um link que sobe da página e volta para dentro da raiz, Quando o arquivo existe, Então passa", () => {
    gravar("README.md", "");
    kb("README.md", `[x](../../../${basename(raiz)}/README.md)\n`);
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado a âncora depois do arquivo, Quando checo, Então a âncora é ignorada e o arquivo é conferido", () => {
    gravar("SCHEMA.md", "");
    kb("README.md", "[a](../../SCHEMA.md#tipos) e `SCHEMA.md#tipos`.\n[b](#nesta-pagina)\n[c](../../FALTA.md#x)\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("FALTA.md");
    expect(r.problemas[0]).not.toContain("#");
  });

  test("Dado URLs http, https e mailto, Quando checo, Então são ignoradas", () => {
    kb(
      "README.md",
      "[a](https://exemplo.com/x.md) [b](http://exemplo.com/y) [c](mailto:alguem@exemplo.com)\n`https://exemplo.com/a/b.md`\n",
    );
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado um bloco de código cercado com caminhos e links, Quando checo, Então o conteúdo do bloco é ignorado", () => {
    kb("README.md", "```bash\nbun src/nao-existe.ts\ncat `docs/fantasma.md` [x](tampouco.md)\n```\n\n~~~\n`src/outro.ts`\n~~~\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma cerca de 4 crases com 3 crases dentro e um link quebrado depois, Quando checo, Então o link fora do bloco reprova", () => {
    kb("README.md", "# Controle\n````markdown\n```\n````\n[x](inexistente.md)\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("inexistente.md");
  });

  test("Dado uma cerca de 4 tils com 3 tils dentro e um link quebrado depois, Quando checo, Então o link fora do bloco reprova", () => {
    kb("README.md", "~~~~\n~~~\n~~~~\n[x](inexistente.md)\n");
    expect(checarDocs(raiz).ok).toBe(false);
  });

  test("Dado um link quebrado dentro de cerca de 4 crases com 3 crases no meio, Quando checo, Então ele segue ignorado", () => {
    kb("README.md", "````markdown\n```\n[x](inexistente.md)\n```\n````\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado um fechamento com texto depois, Quando checo, Então a cerca continua aberta e o link seguinte é ignorado", () => {
    kb("README.md", "```\n``` texto\n[x](inexistente.md)\n```\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma menção que não parece caminho, Quando checo, Então é ignorada", () => {
    kb(
      "README.md",
      [
        "`bun run checar`",
        "`src/lib/*.ts`",
        "`wiki/<área>/index.md`",
        "`ANVILORE_LOG_HOOK`",
        "`Bun.YAML`",
        "`checarDocs(raiz)`",
        "`Write|Edit`",
        "`AAAA-MM-DD`",
        "",
      ].join("\n"),
    );
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma menção só com extensão de arquivo, Quando o arquivo não existe, Então reprova", () => {
    kb("README.md", "Veja `FALTA.md` e `faltando.json`.\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(2);
  });

  test("Dado uma página em CRLF e com BOM, Quando checo, Então a leitura é a mesma da página em LF", () => {
    kb("README.md", "﻿# T\r\n\r\nVeja `src/falta.ts`.\r\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("src/falta.ts");
  });

  test("Dado a mesma referência quebrada duas vezes na página, Quando checo, Então é apontada uma vez", () => {
    kb("README.md", "`src/falta.ts` e de novo `src/falta.ts`.\n");
    expect(checarDocs(raiz).problemas).toHaveLength(1);
  });

  test("Dado um link com título entre aspas, Quando checo, Então só o alvo é conferido", () => {
    gravar("LICENSE", "");
    kb("README.md", '[a](../../LICENSE "licença")\n');
    expect(checarDocs(raiz).ok).toBe(true);
  });

  test("Dado um alvo com escape de URL, Quando checo, Então ele é decodificado antes de conferir", () => {
    gravar("com espaço.md", "");
    kb("README.md", "[a](../../com%20espaço.md)\n");
    expect(checarDocs(raiz).ok).toBe(true);
  });

  test("Dado um escape de URL malformado, Quando checo, Então o alvo é conferido como foi escrito", () => {
    gravar("a%ZZ.md", "");
    kb("README.md", "[a](../../a%ZZ.md) [b](../../b%ZZ.md)\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("b%ZZ.md");
  });

  test("Dado páginas sem nenhum problema, Quando checo, Então passa", () => {
    kb("README.md", "# Nada a conferir\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });
});

describe("checarDocs: R48, escapes na sintaxe de link", () => {
  test("Dado um colchete de abertura escapado Quando checo Então o exemplo literal não é um link quebrado", () => {
    kb("README.md", String.raw`\[exemplo](missing.md)`);
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado barras pares e ímpares antes do colchete Quando checo Então só os pares abrem links reais", () => {
    kb("README.md", String.raw`\\[x](nao-existe.md)` + "\n" + String.raw`\\\[literal](missing.md)`);
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("nao-existe.md");
    expect(r.problemas[0]).toContain("linha 1");
  });

  test("Dado abertura escapada antes de link real aninhado Quando checo Então confere o link e conserva sua linha", () => {
    kb("README.md", String.raw`\[a [b](nao-existe.md)` + "\n\n" + String.raw`\[a` + "\n[b](outro-ausente.md)\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(2);
    expect(r.problemas[0]).toContain("nao-existe.md");
    expect(r.problemas[0]).toContain("linha 1");
    expect(r.problemas[1]).toContain("outro-ausente.md");
    expect(r.problemas[1]).toContain("linha 4");
  });

  test("Dado colchete de fechamento escapado no texto Quando checo Então confere o destino ausente e aceita o existente", () => {
    kb("existe.md", "# Existe\n");
    kb("README.md", String.raw`[a\]b](nao-existe.md) [a\]b](existe.md)`);
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("nao-existe.md");
    kb("README.md", String.raw`[a\]b](existe.md)`);
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado parêntese escapado no destino Quando checo Então resolve o nome completo e aponta só o arquivo ausente", () => {
    kb("a)b.md", "# Existe\n");
    kb("README.md", String.raw`[x](a\)b.md) [y](outro\)ausente.md)`);
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("outro)ausente.md");
    kb("README.md", String.raw`[x](a\)b.md)`);
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado imagem com abertura escapada e exclamação literal Quando checo Então ignora a imagem literal e confere o link real", () => {
    kb("README.md", String.raw`!\[x](missing.png)`);
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
    kb("README.md", String.raw`\![x](nao-existe.md)`);
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("nao-existe.md");
  });
});

describe("checarDocs: links inline CommonMark", () => {
  const casos = [
    ["parênteses balanceados", "[Guide](guide(v2).md)", "guide(v2).md"],
    ["ângulos e espaço", "[x](<meu arquivo.md>)", "meu arquivo.md"],
    ["título duplo", '[x](alvo.md "título")', "alvo.md"],
    ["título simples", "[x](alvo.md 'título')", "alvo.md"],
    ["título entre parênteses", "[x](alvo.md (título))", "alvo.md"],
    ["colchetes balanceados", "[a [b] c](d.md)", "d.md"],
    ["imagem", "![alt](x.png)", "x.png"],
    ["destino e título em outras linhas", '[x](\nalvo.md\n"título"\n)', "alvo.md"],
    ["título com escape", String.raw`[x](alvo.md "um \"título\"")`, "alvo.md"],
  ] as const;
  for (const [caso, texto, alvo] of casos) {
    test(`Dado ${caso} Quando o alvo existe Então o link aprova sem truncar o destino`, () => {
      gravar(`docs/knowledge_base/${alvo}`, "");
      kb("README.md", texto);
      expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
    });
    test(`Dado ${caso} Quando o alvo falta Então o link reprova pelo destino completo`, () => {
      kb("README.md", texto);
      const r = checarDocs(raiz);
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]).toContain(`link para ${alvo} quebrado (linha 1)`);
    });
    test(`Dado ${caso} com alvo existente Quando há link quebrado ao lado Então a sonda reprova`, () => {
      gravar(`docs/knowledge_base/${alvo}`, "");
      kb("README.md", `${texto}\n[sonda](sonda.md)`);
      expect(checarDocs(raiz).problemas).toEqual([
        `docs/knowledge_base/README.md: link para sonda.md quebrado (linha ${texto.split("\n").length + 1})`,
      ]);
    });
  }
  for (const texto of [
    "[x](a(b.md)", "[x](<sem-fecho.md)",
    "[x](<a\nb.md>)", '[x](alvo.md "título sem fecho)', "[x](alvo.md (título (aninhado)))",
    "[x](alvo.md lixo)", "[x](\n\nalvo.md)", "[x\n\ny](alvo.md)",
  ]) {
    test(`Dado sintaxe inválida ${JSON.stringify(texto)} Quando checo Então ela é texto e a sonda real reprova`, () => {
      kb("README.md", `${texto}\n\n[sonda](sonda.md)`);
      const r = checarDocs(raiz);
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]).toContain("link para sonda.md quebrado");
    });
  }
});

describe("checarDocs: referências CommonMark", () => {
  for (const uso of ["[x][ref]", "[ref][]", "[ref]", "![x][ref]", "![ref][]", "![ref]"]) {
    test(`Dado ${uso} antes da definição Quando o alvo falta Então reprova na linha do uso`, () => {
      kb("README.md", `${uso}\n\n[ref]: ausente.md "título"`);
      expect(checarDocs(raiz).problemas).toEqual([
        "docs/knowledge_base/README.md: link para ausente.md quebrado (linha 1)",
      ]);
    });
    test(`Dado ${uso} antes da definição Quando o alvo existe e há sonda Então reprova só a sonda`, () => {
      kb("existe.md", "");
      kb("README.md", `${uso} [sonda](sonda.md)\n\n[ref]: existe.md 'título'`);
      expect(checarDocs(raiz).problemas).toEqual([
        "docs/knowledge_base/README.md: link para sonda.md quebrado (linha 1)",
      ]);
    });
  }
  for (const definicao of [
    "[ref]: ausente.md", "  [ref]: <meu arquivo.md> (título)",
    '[ref]:\n  ausente.md\n  "título"', "[ref]: guide(v2).md 'título'",
  ]) {
    test(`Dado definição sem uso ${JSON.stringify(definicao)} Quando checo Então seu destino é conferido`, () => {
      kb("README.md", definicao);
      const r = checarDocs(raiz);
      expect(r.ok).toBe(false);
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]).toContain("linha 1");
    });
  }
  test("Dado rótulos com caixa e espaços diferentes Quando uso referência multilinha Então resolve a definição normalizada", () => {
    kb("README.md", "[x][  REF\n  A ]\n\n[ref a]: ausente.md");
    expect(checarDocs(raiz).problemas[0]).toContain("ausente.md quebrado (linha 1)");
  });
  test("Dado definição repetida Quando uso a referência Então a primeira vence e a segunda também é conferida", () => {
    kb("existe.md", "");
    kb("README.md", "[x]\n\n[x]: existe.md\n[x]: ausente.md");
    expect(checarDocs(raiz).problemas).toEqual([
      "docs/knowledge_base/README.md: link para ausente.md quebrado (linha 4)",
    ]);
  });
  test("Dado referências indefinidas e definições em código Quando checo Então não inventa links", () => {
    kb("README.md", "[x][ref] [x][] [x]\n\n`[ref]: ausente.md`\n\n```\n[x]: ausente.md\n```");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });
});

describe("checarDocs: a própria knowledge base", () => {
  test("Dado um repositório sem docs/knowledge_base, Quando checo, Então reprova e não imprime PASS calado", () => {
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("docs/knowledge_base");
  });

  test("Dado um repositório sem docs/knowledge_base, Quando checo, Então a mensagem traz o cwd e manda rodar na raiz do repositório", () => {
    const texto = checarDocs(raiz).problemas.join("\n");
    expect(texto).toContain(process.cwd());
    expect(texto).toContain("rode na raiz do repositório");
  });

  test("Dado uma pasta chamada x.md na knowledge base, Quando checo, Então ela é ignorada e nada lança exceção", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base", "x.md"), { recursive: true });
    kb("README.md", "# Ok\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado docs/knowledge_base existente e sem páginas, Quando checo, Então reprova", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base"), { recursive: true });
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("nenhuma página");
  });

  test("Dado docs/knowledge_base como arquivo, Quando checo, Então reprova", () => {
    gravar("docs/knowledge_base", "isto é um arquivo");
    expect(checarDocs(raiz).ok).toBe(false);
  });

  test("Dado a raiz real do repositório, Quando checo, Então não há nenhum problema", () => {
    const real = checarDocs(join(import.meta.dir, ".."));
    expect(real.problemas).toEqual([]);
    expect(real.ok).toBe(true);
  });
});

describe("comandoChecarDocs", () => {
  function capturar<T>(corpo: () => Promise<T>) {
    const saida: string[] = [];
    const erro: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...a) => {
      saida.push(a.join(" "));
    });
    const err = spyOn(console, "error").mockImplementation((...a) => {
      erro.push(a.join(" "));
    });
    return corpo()
      .then((codigo) => ({ codigo, saida, erro }))
      .finally(() => {
        log.mockRestore();
        err.mockRestore();
      });
  }

  test("Dado uma knowledge base consistente, Quando rodo o subcomando, Então o código é 0", async () => {
    kb("README.md", "# Ok\n");
    const r = await capturar(() => comandoChecarDocs([], raiz));
    expect(r.codigo).toBe(0);
    expect(r.saida.join("\n")).toContain("docs/knowledge_base");
  });

  test("Dado uma referência quebrada, Quando rodo o subcomando, Então o código é 1 e cada problema vai para o stderr", async () => {
    kb("README.md", "`src/falta.ts`\n[x](falta.md)\n");
    const r = await capturar(() => comandoChecarDocs([], raiz));
    expect(r.codigo).toBe(1);
    expect(r.erro).toHaveLength(2);
    expect(r.saida).toEqual([]);
  });

  test("Dado um argumento qualquer, Quando rodo o subcomando, Então recusa com o uso no stderr e código 2, sem conferir a KB", async () => {
    kb("README.md", "`src/falta.ts`\n");
    const r = await capturar(() => comandoChecarDocs(["qualquer-coisa"], raiz));
    expect(r.codigo).toBe(2);
    expect(r.saida).toEqual([]);
    expect(r.erro.join("\n")).toContain("Uso: anvilore checar-docs");
    expect(r.erro.join("\n")).not.toContain("src/falta.ts");
  });

  test("Dado o subcomando checar-docs, Quando consulto a tabela da CLI, Então ele está registrado e roda", async () => {
    expect(Object.keys(subcomandos)).toContain("checar-docs");
    const r = await capturar(() => executar(["checar-docs"]));
    expect(r.codigo).toBe(0);
  });
});

describe("checarDocs: definições de referência com crases nos títulos", () => {
  test("Dado crases em títulos de definições separadas Quando a do meio aponta para arquivo ausente Então reprova nomeando o ausente", () => {
    gravar("docs/knowledge_base/exists.md", "ok");
    kb("README.md", '[a]: exists.md "Use `code"\n[b]: missing.md\n[c]: exists.md "code`"\n');
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("missing.md");
  });
  test("Dado as mesmas definições com todos os alvos existentes Quando checo Então aprova", () => {
    gravar("docs/knowledge_base/exists.md", "ok");
    gravar("docs/knowledge_base/present.md", "ok");
    kb("README.md", '[a]: exists.md "Use `code"\n[b]: present.md\n[c]: exists.md "code`"\n');
    expect(checarDocs(raiz).ok).toBe(true);
  });
});
