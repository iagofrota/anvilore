import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const raiz = resolve(import.meta.dir, "..");
const saida = resolve(raiz, "src/ui/public");
await rm(saida, { recursive: true, force: true });
await mkdir(resolve(saida, "assets"), { recursive: true });
const compilacao = await Bun.build({
  entrypoints: [resolve(raiz, "ui/web/main.tsx")],
  outdir: resolve(saida, "assets"),
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  naming: { entry: "[name].[ext]", asset: "[name].[ext]" },
});
if (!compilacao.success) throw new AggregateError(compilacao.logs, "Não foi possível compilar a interface web.");
const html = await readFile(resolve(raiz, "ui/web/index.html"), "utf8");
await writeFile(resolve(saida, "index.html"), html);
console.log("Interface compilada em src/ui/public/.");
