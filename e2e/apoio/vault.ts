import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

export type Vault = {
  raiz: string;
  wiki: string;
  raw: string;
  fora: string;
  escrever(relativo: string, conteudo: string | Uint8Array): Promise<void>;
  ler(relativo: string): Promise<Buffer>;
  hash(relativo: string): Promise<string>;
  limparFora(): Promise<void>;
  remover(): Promise<void>;
};

export async function criarVault(): Promise<Vault> {
  const tmp = await realpath(tmpdir());
  const raiz = await mkdtemp(join(tmp, "anvilore-e2e-"));
  const wiki = join(raiz, "wiki");
  const raw = join(raiz, "raw");
  const fora = join(tmp, `anvilore-e2e-fora-${randomBytes(5).toString("hex")}`);
  await Promise.all([
    mkdir(join(wiki, "pessoal", "sources"), { recursive: true }),
    mkdir(join(wiki, "pessoal", "concepts"), { recursive: true }),
    mkdir(join(wiki, "trabalho", "sources"), { recursive: true }),
    mkdir(join(raw, "pessoal"), { recursive: true }),
    mkdir(fora, { recursive: true }),
    mkdir(join(raiz, ".anvilore"), { recursive: true }),
  ]);
  await writeFile(join(wiki, "index.md"), "# Índice\n");
  await writeFile(join(wiki, "pessoal", "index.md"), "# Pessoal\n\n- [[segundo-cerebro]]\n");
  await writeFile(join(wiki, "pessoal", "concepts", "segundo-cerebro.md"), [
    "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro", "tags: [teste]", "---", "", "Versão anterior da página.", "",
  ].join("\n"));
  await writeFile(join(raiz, ".anvilore", "identidade"), "human:teste\n");
  return {
    raiz, wiki, raw, fora,
    escrever: async (relativo, conteudo) => { const caminho = join(raiz, relativo); await mkdir(dirname(caminho), { recursive: true }); await writeFile(caminho, conteudo); },
    ler: relativo => readFile(join(raiz, relativo)),
    hash: async relativo => createHash("sha256").update(await readFile(join(raiz, relativo))).digest("hex"),
    limparFora: () => rm(fora, { recursive: true, force: true }),
    remover: async () => {
      const caminho = await realpath(raiz);
      if (!caminho.startsWith(`${tmp}${process.platform === "win32" ? "\\" : "/"}anvilore-e2e-`)) throw new Error(`Recusa limpar fora do vault descartável: ${caminho}`);
      await rm(caminho, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await rm(fora, { recursive: true, force: true });
    },
  };
}

export { instantaneo, mesmaArvore } from "./arvore";
