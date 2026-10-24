import { describe, expect, test } from "bun:test";
import { acharLinks } from "../src/lib/markdown";

describe("acharLinks: precedência e limites do CommonMark", () => {
  // Casos derivados das seções 4.7 e 6.3–6.4: https://spec.commonmark.org/0.31.2/
  const casos: [string, string, string[]][] = [
    ["link interno", "[a [b](interno.md) c](externo.md)", ["interno.md"]],
    ["imagem dentro de link", "[a ![b](imagem.png) c](externo.md)", ["externo.md", "imagem.png"]],
    ["imagem com barras pares dentro de link", String.raw`[a \\![b](imagem.png) c](externo.md)`, ["externo.md", "imagem.png"]],
    ["exclamação escapada dentro de link", String.raw`[a \![b](interno.md) c](externo.md)`, ["interno.md"]],
    ["colchete dentro de code span do texto", "[a `]` b](alvo.md)", ["alvo.md"]],
    ["destinos vazios", "[a]() [b](<>)", ["", ""]],
    ["destino com espaço escapado inválido", String.raw`[a](a\ b.md)`, []],
    ["destino angular com escapes", String.raw`[a](<a\>b.md>)`, ["a>b.md"]],
    ["título com parêntese escapado", String.raw`[a](a.md (t\)ítulo))`, ["a.md"]],
    ["quebra de parágrafo dentro do título", '[a](a.md "t\n\nítulo")', []],
    ["texto depois do fechamento", "[a](a.md)resto)", ["a.md"]],
    ["crase no destino", "[a](a`b`.md)", ["a`b`.md"]],
    ["barra não escapando letra", String.raw`[a](a\b.md)`, [String.raw`a\b.md`]],
    ["controle no destino", "[a](a\x00b.md)", []],
  ];
  for (const [caso, texto, alvos] of casos) {
    test(`Dado ${caso} Quando reconheço links Então extraio somente os destinos reais`, () => {
      expect(acharLinks(texto).map((l) => l.alvo)).toEqual(alvos);
    });
  }

  const referencias: [string, string, string[]][] = [
    ["definição depois de parágrafo sem separação", "[x]\n[x]: ausente.md", []],
    ["definição depois de título", "# [x]\n[x]: alvo.md", ["alvo.md", "alvo.md"]],
    ["referência cheia antes da curta", "[a][b]\n\n[a]: a.md\n[b]: b.md", ["b.md", "a.md", "b.md"]],
    ["referência cheia indefinida", "[a][b]\n\n[a]: a.md", ["a.md"]],
    ["referência encadeada", "[a][b][c]\n\n[a]: a.md\n[c]: c.md", ["c.md", "a.md", "c.md"]],
    ["link inline antes da referência", "[a](inline.md)\n\n[a]: ref.md", ["inline.md", "ref.md"]],
    ["referência depois de inline inválido", "[a](não é link)\n\n[a]: ref.md", ["ref.md", "ref.md"]],
    ["rótulo com colchete escapado", String.raw`[x][ref\[]` + "\n\n" + String.raw`[ref\[]: alvo.md`, ["alvo.md", "alvo.md"]],
    ["rótulo Unicode", "[STRASSE]\n\n[Straße]: alvo.md", ["alvo.md", "alvo.md"]],
    ["rótulo vazio", "[]: ausente.md", []],
    ["rótulo com colchetes", "[a[b]]: ausente.md", []],
    ["rótulo longo demais", `[${"a".repeat(1000)}]: ausente.md`, []],
    ["rótulo no limite", `[${"a".repeat(999)}]: alvo.md`, ["alvo.md"]],
    ["definição sem destino", "[a]:", []],
    ["definição com destino vazio angular", "[a]: <>", [""]],
    ["definição com destino inválido", "[a]: a(b.md", []],
    ["definição com título inválido na mesma linha", '[a]: a.md "sem fecho', []],
    ["definição com lixo após título", '[a]: a.md "título" lixo', []],
    ["título inválido na próxima linha", '[a]: a.md\n"título" lixo', ["a.md"]],
    ["definição indentada demais", "    [a]: ausente.md", []],
  ];
  for (const [caso, texto, alvos] of referencias) {
    test(`Dado ${caso} Quando reconheço referências Então respeito precedência e validade das definições`, () => {
      expect(acharLinks(texto).map((l) => l.alvo)).toEqual(alvos);
    });
  }
});
