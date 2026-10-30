import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { criarCenario as CriarCenario, Cenario } from "./apoio/instalar-sh";

// Achado P1 do Codex (PR #34), conferido no Linux: a pasta de passagem do download nunca pode apagar algo que já existia.
// O instalar.sh a nomeia com o PID e a cria com mkdir (que falha se existir), sem `rm -rf` antes.

const linux = process.platform === "linux";
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof CriarCenario>) { const c = await apoio!.criarCenario(...args); cenarios.push(c); return c; }
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);

test("Dado instalar.sh, Quando leio passo_baixar_kit, Então a pasta de passagem é criada com mkdir e nada é apagado antes do clone", () => {
  const sh = readFileSync(join(import.meta.dir, "..", "instalador/instalar.sh"), "utf8");
  const corpo = /passo_baixar_kit\(\) \{[\s\S]*?\n\}\n/.exec(sh)?.[0] ?? "";
  expect(corpo).not.toBe("");
  const antesDoClone = corpo.slice(0, corpo.indexOf("clone --quiet"));
  expect(antesDoClone).not.toMatch(/rm -rf "\$CLONE_TMP"/);
  expect(antesDoClone).toMatch(/mkdir "\$tmp"/);
});

test.skipIf(!linux)("Dado uma pasta .anvilore-baixando.* que já existe ao lado do destino, Quando instalo (do zero), Então ela continua intacta e a instalação termina", async () => {
  const c = await novo({ agentes: ["claude"] });
  const dono = join(c.home, ".anvilore-baixando.1");
  await mkdir(dono, { recursive: true });
  await writeFile(join(dono, "do-usuario.txt"), "não apague\n");
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await readFile(join(dono, "do-usuario.txt"), "utf8")).toBe("não apague\n");
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
});
