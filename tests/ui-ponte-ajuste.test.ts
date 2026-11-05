import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  argumentosDoPapel,
  caminhoTemCaractereEspecialDeAjuste,
  MENSAGEM_ERRO_CARACTERE_ESPECIAL_AJUSTE,
  regraDeEdicao,
  regraDeEdicaoDeAjuste,
  regrasDeLeitura,
} from "../src/lib/ponte-claude-code";

describe("Ponte Claude Code — Ajuste restrito a uma página", () => {
  test("Dado um caminho de diretório Quando gero regra de edição Então inclui /**", () => {
    expect(regraDeEdicao("/v/wiki")).toBe("Edit(//v/wiki/**)");
    expect(regraDeEdicao("C:\\v\\wiki")).toBe("Edit(//C:/v/wiki/**)");
  });

  test("Dado um caminho de arquivo markdown Quando gero regra de edição Então não inclui /** e aponta para o arquivo exato", () => {
    expect(regraDeEdicao("/v/wiki/pessoal/concepts/segundo-cerebro.md")).toBe("Edit(//v/wiki/pessoal/concepts/segundo-cerebro.md)");
    expect(regraDeEdicao("C:\\v\\wiki\\pessoal\\concepts\\segundo-cerebro.md")).toBe("Edit(//C:/v/wiki/pessoal/concepts/segundo-cerebro.md)");
  });

  test("Dado raiz ou wiki contendo caracteres especiais (! e [) Quando gero regras de leitura e de edição geral Então não lança erro", () => {
    const raizEspecial = "/vault/Notas[2026]!";
    const wikiEspecial = "/vault/Notas[2026]!/wiki";
    // Leitura não lança
    expect(regrasDeLeitura(raizEspecial, wikiEspecial)).toEqual(["Read(//vault/Notas[2026]!/**)"]);
    // Edição geral de diretório não lança
    expect(regraDeEdicao(wikiEspecial)).toBe("Edit(//vault/Notas[2026]!/wiki/**)");
    // Papel leitor não lança
    expect(() => argumentosDoPapel({ papel: "leitor", mensagem: "Ler", raiz: raizEspecial, wiki: wikiEspecial })).not.toThrow();
    // Papel escritor de ingestão comum (sem pagina) não lança
    expect(() => argumentosDoPapel({ papel: "escritor", mensagem: "Escrever", raiz: raizEspecial, wiki: wikiEspecial, sessao: "sess-123" })).not.toThrow();
  });

  test("Dado um caminho de ajuste contendo metacaracteres (* ? [ ] { } ! ou \\) Quando tento gerar regra de ajuste Então lança erro explicativo", () => {
    for (const char of ["*", "?", "[", "]", "{", "}", "!"]) {
      const caminho = `/v/wiki/pessoal/concepts/nota-${char}.md`;
      expect(caminhoTemCaractereEspecialDeAjuste(caminho)).toBe(true);
      expect(() => regraDeEdicaoDeAjuste(caminho)).toThrow(MENSAGEM_ERRO_CARACTERE_ESPECIAL_AJUSTE);
    }
    const caminhoBackslash = "/v/wiki/pessoal/concepts/nota\\invalida.md";
    expect(caminhoTemCaractereEspecialDeAjuste(caminhoBackslash)).toBe(true);
    expect(() => regraDeEdicaoDeAjuste(caminhoBackslash)).toThrow(MENSAGEM_ERRO_CARACTERE_ESPECIAL_AJUSTE);
  });

  test("Dado o escritor de ajuste Quando a raiz do vault tem caractere especial Então argumentosDoPapel lança erro de ajuste", () => {
    expect(() => argumentosDoPapel({
      papel: "escritor",
      mensagem: "Ajuste.",
      raiz: "/vault/Notas[2026]!",
      wiki: "/vault/Notas[2026]!/wiki",
      pagina: "pessoal/concepts/seguro.md",
    })).toThrow(MENSAGEM_ERRO_CARACTERE_ESPECIAL_AJUSTE);
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
