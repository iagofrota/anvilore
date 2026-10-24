import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PASTA_DA_KB, listarPaginasDaKb } from "../src/lib/knowledge-base";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-kb-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

// Só a falta de privilégio/recurso para criar link simbólico (Windows comum) justifica pular o
// teste; qualquer outro erro sobe e reprova.
const FALTA_DE_RECURSO = new Set(["EPERM", "ENOSYS", "EACCES"]);

function motivoSemSymlink(criar: () => void): string | null {
  try {
    criar();
    return null;
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo !== undefined && FALTA_DE_RECURSO.has(codigo)) return codigo;
    throw erro;
  }
}

const sonda = mkdtempSync(join(tmpdir(), "anvilore-sonda-symlink-"));
const semSymlink = motivoSemSymlink(() => symlinkSync(join(sonda, "alvo"), join(sonda, "elo")));
rmSync(sonda, { recursive: true, force: true });
if (semSymlink !== null) {
  console.warn(`PULADO: link simbólico indisponível neste ambiente (${semSymlink}); o teste do link quebrado não roda`);
}

function gravar(relativo: string, conteudo = ""): void {
  const caminho = join(raiz, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

describe("listarPaginasDaKb", () => {
  test("Dado uma knowledge base com páginas, Quando listo, Então devolve só as .md em ordem, com barra normal, e nenhum problema", () => {
    gravar("docs/knowledge_base/b.md");
    gravar("docs/knowledge_base/a.md");
    gravar("docs/knowledge_base/sub/fundo.md");
    gravar("docs/knowledge_base/MAIUSCULA.MD");
    gravar("docs/knowledge_base/nota.txt");
    expect(listarPaginasDaKb(raiz)).toEqual({
      paginas: ["MAIUSCULA.MD", "a.md", "b.md", "sub/fundo.md"],
      problemas: [],
    });
  });

  test("Dado que docs/knowledge_base não existe, Quando listo, Então reprova com a pasta, a raiz procurada, o cwd e a dica de rodar na raiz", () => {
    const r = listarPaginasDaKb(raiz);
    expect(r.paginas).toEqual([]);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain(`${PASTA_DA_KB} não existe`);
    expect(r.problemas[0]).toContain(raiz);
    expect(r.problemas[0]).toContain(process.cwd());
    expect(r.problemas[0]).toContain("rode na raiz do repositório");
  });

  test("Dado docs/knowledge_base como arquivo, Quando listo, Então reprova dizendo que não é uma pasta", () => {
    gravar("docs/knowledge_base", "isto é um arquivo");
    const r = listarPaginasDaKb(raiz);
    expect(r.paginas).toEqual([]);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("não é uma pasta");
    expect(r.problemas[0]).toContain("rode na raiz do repositório");
  });

  test("Dado docs/knowledge_base existente e vazia, Quando listo, Então reprova dizendo que não há nenhuma página .md", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base"), { recursive: true });
    const r = listarPaginasDaKb(raiz);
    expect(r.paginas).toEqual([]);
    expect(r.problemas).toEqual([`${PASTA_DA_KB} não tem nenhuma página .md`]);
  });

  test("Dado uma pasta só com arquivos que não são .md, Quando listo, Então reprova por não ter página", () => {
    gravar("docs/knowledge_base/nota.txt");
    expect(listarPaginasDaKb(raiz).problemas.join("\n")).toContain("nenhuma página");
  });

  test("Dado uma pasta chamada x.md, Quando listo, Então ela não conta como página e nada lança exceção", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base", "x.md"), { recursive: true });
    gravar("docs/knowledge_base/real.md");
    expect(listarPaginasDaKb(raiz)).toEqual({ paginas: ["real.md"], problemas: [] });
  });

  test("Dado só uma pasta x.md, Quando listo, Então reprova por não ter página", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base", "x.md"), { recursive: true });
    const r = listarPaginasDaKb(raiz);
    expect(r.paginas).toEqual([]);
    expect(r.problemas.join("\n")).toContain("nenhuma página");
  });

  test.skipIf(semSymlink !== null)(
    "Dado um link simbólico quebrado terminado em .md, Quando listo, Então ele não conta como página e nada lança exceção",
    () => {
      gravar("docs/knowledge_base/real.md");
      symlinkSync(join(raiz, "nao-existe-alvo"), join(raiz, "docs", "knowledge_base", "quebrado.md"));
      expect(listarPaginasDaKb(raiz)).toEqual({ paginas: ["real.md"], problemas: [] });
    },
  );
});

describe("motivoSemSymlink", () => {
  test.each(["EPERM", "ENOSYS", "EACCES"])(
    "Dado que criar o link falha com %s, Quando sondo, Então devolve o código e o teste pode ser pulado",
    (codigo) => {
      const falha = () => {
        throw Object.assign(new Error("sem privilégio"), { code: codigo });
      };
      expect(motivoSemSymlink(falha)).toBe(codigo);
    },
  );

  test("Dado que criar o link falha com um erro inesperado, Quando sondo, Então o erro sobe e reprova", () => {
    const falha = () => {
      throw Object.assign(new Error("disco com defeito"), { code: "EIO" });
    };
    expect(() => motivoSemSymlink(falha)).toThrow("disco com defeito");
  });

  test("Dado um erro sem código, Quando sondo, Então o erro sobe", () => {
    expect(() =>
      motivoSemSymlink(() => {
        throw new Error("qualquer");
      }),
    ).toThrow("qualquer");
  });

  test("Dado que criar o link funciona, Quando sondo, Então não há motivo para pular", () => {
    expect(motivoSemSymlink(() => {})).toBeNull();
  });
});
