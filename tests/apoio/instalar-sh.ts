import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { embutirInstalador } from "../../scripts/embutir-instalador";
import { criarKit, type Kit } from "./kit-atualizavel";

// Cenário descartável para o instalar.sh: HOME vazio, PATH só com as ferramentas que o teste escolhe, kit de mentira
// num repositório local com tag SSH assinada por chave descartável e downloads de dependência por file://.
// Nada aqui toca no HOME real, na rede (exceto o teste do kit real) nem em chave de verdade.

export const raizDoRepo = resolve(import.meta.dir, "../..");
export const BUN_REAL = process.execPath;
export const VERSAO_BUN = Bun.version;

// As ferramentas que o instalar.sh usa. Fora desta lista nada existe no PATH do teste (nem rg, nem bun, nem sudo).
const FERRAMENTAS = ["git", "curl", "unzip", "tar", "gzip", "ssh-keygen", "sha256sum", "sort", "sed", "awk", "grep", "head", "tail", "tr", "cat", "cp", "mv", "rm", "mkdir",
  "rmdir", "ls", "id", "date", "uname", "mktemp", "dirname", "basename", "chmod", "ln", "env", "bash", "sh", "readlink", "wc", "touch", "cut", "tee", "sleep", "find", "xargs", "diff", "test", "true", "false"];

export function sha256(dados: Uint8Array | string) { return createHash("sha256").update(dados).digest("hex"); }

export const STUB_CLI = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [comando, ...resto] = process.argv.slice(2);
mkdirSync(".anvilore", { recursive: true });
appendFileSync(".anvilore/chamadas.log", [comando, ...resto].join(" ") + "\\n");
const agentes = ["claude", "codex", "gemini", "copilot"].filter(a => Bun.which(a) !== null);
if (comando === "instalar") {
  const codigo = Number(process.env.STUB_INSTALAR_CODIGO ?? 0);
  if (resto.includes("--auto-commit")) writeFileSync("anvilore.toml", "[hooks]\\nauto_commit = true\\n");
  for (const a of agentes) { mkdirSync("." + a, { recursive: true }); writeFileSync(join("." + a, "hook.json"), "{}\\n"); }
  console.log("anvilore — instalação");
  if (agentes.length) console.log("instalados: " + agentes.join(", "));
  if (codigo) console.log("ERRO: falha simulada");
  process.exit(codigo);
}
if (comando === "doctor") {
  const ok = agentes.length > 0 && existsSync(".claude/hook.json") === agentes.includes("claude");
  console.log(ok ? "doctor: tudo ligado" : "doctor: nenhum agente com a trava");
  process.exit(ok ? 0 : 1);
}
if (comando === "init") { for (const a of (resto[1] ?? "").split(",")) mkdirSync(join("wiki", a), { recursive: true }); process.exit(0); }
if (comando === "atualizar") {
  // Registra como o instalador entregou as chaves: pela opção (com o conteúdo do arquivo) e/ou pela variável de ambiente.
  const i = resto.indexOf("--assinantes-do-instalador");
  const arquivo = i >= 0 ? resto[i + 1] : undefined;
  appendFileSync(".anvilore/atualizar-entrega.log", JSON.stringify({ variavel: process.env.ANVILORE_ASSINANTES_DO_INSTALADOR ?? null, arquivo: arquivo ?? null, conteudo: arquivo && existsSync(arquivo) ? readFileSync(arquivo, "utf8") : null }) + "\\n");
  const codigo = Number(process.env.STUB_ATUALIZAR_CODIGO ?? 1);
  // 2 = o atualizador antigo da pasta, que não conhece a opção e responde com o uso.
  if (codigo === 2) { console.error("Uso: anvilore atualizar [--verificar | --voltar | --estado]"); process.exit(2); }
  if (codigo === 0) { console.log("Anvilore já está atualizado."); process.exit(0); }
  console.error("atualizar: clone não gerenciado: exige origin oficial"); process.exit(1);
}
if (comando === "hook") process.exit(2);
process.exit(64);
`;

export type Entradas = { versao?: string; semRg?: boolean; rgCorrompido?: boolean; bunCorrompido?: boolean };

// Dependências falsas com o formato do manifesto real: Bun que repassa para o Bun do teste e rg que só imprime a versão.
export async function criarDependencias(pasta: string, o: Entradas = {}) {
  const dl = join(pasta, "downloads");
  await mkdir(join(dl, "bun-pacote/bun-linux-x64"), { recursive: true });
  await writeFile(join(dl, "bun-pacote/bun-linux-x64/bun"), `#!/bin/sh\nexec ${BUN_REAL} "$@"\n`, { mode: 0o755 });
  const zipBun = join(dl, "bun-linux-x64.zip");
  const zp = Bun.spawnSync(["python3", "-I", "-m", "zipfile", "-c", zipBun, "bun-linux-x64"], { cwd: join(dl, "bun-pacote"), stdout: "pipe", stderr: "pipe" });
  if (zp.exitCode !== 0) throw new Error(`zip falhou: ${zp.stderr.toString()}`);
  await mkdir(join(dl, "rg-pacote/ripgrep-15.2.0-x/"), { recursive: true });
  await writeFile(join(dl, "rg-pacote/ripgrep-15.2.0-x/rg"), "#!/bin/sh\necho ripgrep falso 15.2.0\n", { mode: 0o755 });
  const tgz = join(dl, "ripgrep-15.2.0.tar.gz");
  const tp = Bun.spawnSync(["tar", "-czf", tgz, "-C", join(dl, "rg-pacote"), "ripgrep-15.2.0-x"]);
  if (tp.exitCode !== 0) throw new Error("tar falhou");
  const hashBun = o.bunCorrompido ? "0".repeat(64) : sha256(await readFile(zipBun));
  const hashRg = o.rgCorrompido ? "0".repeat(64) : sha256(await readFile(tgz));
  const bun = `{ "arquivo": "bun-linux-x64.zip", "url": "file://${zipBun}", "sha256": "${hashBun}", "formato": "zip", "executavel": "bun-linux-x64/bun" }`;
  const rg = `{ "arquivo": "ripgrep-15.2.0.tar.gz", "url": "file://${tgz}", "sha256": "${hashRg}", "formato": "tar.gz", "executavel": "ripgrep-15.2.0-x/rg" }`;
  const manifesto = `{
  "formato": 1,
  "dependencias": {
    "bun": {
      "versao": "${o.versao ?? VERSAO_BUN}",
      "plataformas": {
        "linux-x64": ${bun},
        "linux-arm64": ${bun}
      }
    },
    "rg": {
      "versao": "15.2.0",
      "plataformas": {
${o.semRg ? "" : `        "linux-x64": ${rg},\n        "linux-arm64": ${rg}\n`}      }
    }
  }
}
`;
  return manifesto;
}

export type Cenario = Awaited<ReturnType<typeof criarCenario>>;

export async function criarCenario(opcoes: { agentes?: string[]; comBun?: boolean; entradas?: Entradas; versoes?: string[]; kitReal?: boolean; assinar?: boolean } = {}) {
  const pai = await mkdtemp(join(tmpdir(), "anvilore-sh-"));
  const home = join(pai, "home"), bin = join(pai, "bin"), tmp = join(pai, "tmp");
  await mkdir(home); await mkdir(bin); await mkdir(tmp);
  for (const nome of FERRAMENTAS) { const caminho = Bun.which(nome); if (caminho) await symlink(caminho, join(bin, nome)).catch(() => {}); }
  if (opcoes.comBun ?? true) await symlink(BUN_REAL, join(bin, "bun"));
  for (const a of opcoes.agentes ?? ["claude"]) await writeFile(join(bin, a), "#!/bin/sh\necho agente falso\n", { mode: 0o755 });

  const versoes = opcoes.versoes ?? ["0.3.0"];
  let kit: Kit;
  if (opcoes.kitReal) throw new Error("use criarKitReal");
  kit = await criarKit(versoes.map(versao => ({
    versao,
    arquivos: { "src/cli.ts": STUB_CLI, "AGENTS.md": "contrato\n", "bun.lock": null },
  })));
  const assinantes = (await readFile(join(kit.raiz, "seguranca/assinantes"), "utf8"));
  const manifesto = await criarDependencias(pai, opcoes.entradas);
  const modelo = await readFile(join(raizDoRepo, "instalador/instalar.sh"), "utf8");
  const script = join(pai, "instalar.sh");
  await writeFile(script, embutirInstalador(modelo, manifesto, assinantes), { mode: 0o755 });

  const env = (extra: Record<string, string> = {}): Record<string, string> => ({
    HOME: home, TMPDIR: tmp, LANG: "C.UTF-8", PATH: bin,
    ANVILORE_SEM_PERGUNTAS: "1", ANVILORE_ORIGEM: kit.raiz,
    GIT_CONFIG_GLOBAL: join(pai, "gitconfig-vazio"), GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  });
  const rodar = (extra: Record<string, string> = {}, args: string[] = [], quem = script) => {
    const p = Bun.spawnSync(["bash", quem, ...args], { env: env(extra), stdin: "ignore", stdout: "pipe", stderr: "pipe", cwd: pai });
    return { codigo: p.exitCode, saida: p.stdout.toString(), erro: p.stderr.toString(), tudo: `${p.stdout.toString()}${p.stderr.toString()}` };
  };
  const pasta = join(home, "Anvilore");
  return {
    pai, home, bin, tmp, kit, script, pasta, manifesto, assinantes, modelo, env, rodar,
    log: () => readFile(join(pasta, ".anvilore/instalacao.log"), "utf8"),
    estado: async () => JSON.parse(await readFile(join(pasta, ".anvilore/atualizacao.json"), "utf8")) as Record<string, unknown>,
    chamadas: async () => (await readFile(join(pasta, ".anvilore/chamadas.log"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean),
    comando: async (nome: string, conteudo: string) => { await rm(join(bin, nome), { force: true }); await writeFile(join(bin, nome), conteudo, { mode: 0o755 }); await chmod(join(bin, nome), 0o755); },
    limpar: async () => { await kit.limpar(); await rm(pai, { recursive: true, force: true }); },
  };
}
