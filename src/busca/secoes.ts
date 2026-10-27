import { linhasDe } from "../lib/frontmatter";

export type Aviso = "lacuna" | "contradicao";
export type Secao = {
  secao: string;
  nivel: number;
  linhaInicio: number;
  linhaFim: number;
  corpo: string;
  avisos: Aviso[];
};

type Heading = { indice: number; nivel: number; titulo: string };

function headingDaLinha(linha: string): Omit<Heading, "indice"> | null {
  const match = /^ {0,3}(#{1,4})[ \t]+(.+?)\s*$/.exec(linha);
  if (!match) return null;
  const titulo = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
  return titulo ? { nivel: (match[1] ?? "").length, titulo } : null;
}

function avisosDo(texto: string): Aviso[] {
  const avisos: Aviso[] = [];
  if (/>[ \t]*\[!gap\]/i.test(texto)) avisos.push("lacuna");
  if (/>[ \t]*\[!contradiction\]/i.test(texto)) avisos.push("contradicao");
  return avisos;
}

export function secoesDe(conteudo: string, tituloDaPagina: string): Secao[] {
  const linhas = linhasDe(conteudo);
  if (linhas.at(-1) === "") linhas.pop();
  let inicioCorpo = 0;
  if (linhas[0] === "---") {
    const fimFrontmatter = linhas.indexOf("---", 1);
    if (fimFrontmatter >= 0) inicioCorpo = fimFrontmatter + 1;
  }

  const headings: Heading[] = [];
  let cerca: { caractere: string; tamanho: number } | null = null;
  for (let indice = inicioCorpo; indice < linhas.length; indice++) {
    const linha = linhas[indice] ?? "";
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(linha)?.[1];
    if (cerca !== null) {
      const fecha = new RegExp(`^ {0,3}${cerca.caractere}{${cerca.tamanho},}\\s*$`).test(linha);
      if (fecha) cerca = null;
      continue;
    }
    if (fence) {
      cerca = { caractere: fence[0] ?? "`", tamanho: fence.length };
      continue;
    }
    const heading = headingDaLinha(linha);
    if (heading) headings.push({ indice, ...heading });
  }

  const secoes: Secao[] = [];
  const introducaoFim = headings[0]?.indice ?? linhas.length;
  const introducao = linhas.slice(inicioCorpo, introducaoFim);
  if (introducao.some((linha) => linha.trim() !== "")) {
    secoes.push({
      secao: tituloDaPagina,
      nivel: 0,
      linhaInicio: inicioCorpo + 1,
      linhaFim: Math.max(inicioCorpo + 1, introducaoFim),
      corpo: introducao.join("\n").normalize("NFC"),
      avisos: avisosDo(introducao.join("\n")),
    });
  }

  headings.forEach((heading, posicao) => {
    const proximo = headings[posicao + 1]?.indice ?? linhas.length;
    const corpoLinhas = linhas.slice(heading.indice + 1, proximo);
    const texto = corpoLinhas.join("\n").normalize("NFC");
    secoes.push({
      secao: heading.titulo.normalize("NFC"),
      nivel: heading.nivel,
      linhaInicio: heading.indice + 1,
      linhaFim: Math.max(heading.indice + 1, proximo),
      corpo: texto,
      avisos: avisosDo(texto),
    });
  });
  return secoes;
}
