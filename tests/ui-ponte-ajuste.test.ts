import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { argumentosDoPapel, regraDeEdicao } from "../src/lib/ponte-claude-code";

describe("Ponte Claude Code — Ajuste restrito a uma página", () => {
  test("Dado um caminho de diretório Quando gero regra de edição Então inclui /**", () => {
    expect(regraDeEdicao("/v/wiki")).toBe("Edit(//v/wiki/**)");
    expect(regraDeEdicao("C:\\v\\wiki")).toBe("Edit(//C:/v/wiki/**)");
  });

  test("Dado um caminho de arquivo markdown Quando gero regra de edição Então não inclui /** e aponta para o arquivo exato", () => {
    expect(regraDeEdicao("/v/wiki/pessoal/concepts/segundo-cerebro.md")).toBe("Edit(//v/wiki/pessoal/concepts/segundo-cerebro.md)");
    expect(regraDeEdicao("C:\\v\\wiki\\pessoal\\concepts\\segundo-cerebro.md")).toBe("Edit(//C:/v/wiki/pessoal/concepts/segundo-cerebro.md)");
  });

  test("Dado o escritor de ajuste com página definida Quando monto os argumentos Então não exige sessão e restringe edição só àquela página", () => {
    const args = argumentosDoPapel({
      papel: "escritor",
      mensagem: "Ajuste.",
      raiz: "/v",
      wiki: "/v/wiki",
      pagina: "pessoal/concepts/segundo-cerebro.md",
    });

    const inicioAllowed = args.indexOf("--allowedTools") + 1;
    const fimAllowed = args.findIndex((arg, i) => i >= inicioAllowed && arg.startsWith("--"));
    const allowed = args.slice(inicioAllowed, fimAllowed < 0 ? undefined : fimAllowed);

    // Permite leitura da raiz e wiki
    expect(allowed).toContain("Read(//v/**)");
    // Permite edição SOMENTE da página alvo
    expect(allowed).toContain("Edit(//v/wiki/pessoal/concepts/segundo-cerebro.md)");
    // NÃO permite edição da wiki inteira
    expect(allowed).not.toContain("Edit(//v/wiki/**)");

    // Disallowed tools proíbe raw e Bash
    const inicioDisallowed = args.indexOf("--disallowedTools") + 1;
    const fimDisallowed = args.findIndex((arg, i) => i >= inicioDisallowed && arg.startsWith("--"));
    const disallowed = args.slice(inicioDisallowed, fimDisallowed < 0 ? undefined : fimDisallowed);
    expect(disallowed).toEqual(["Edit(//v/raw/**)", "Bash"]);

    // Sem sessão não tem --resume
    expect(args).not.toContain("--resume");
  });
});
