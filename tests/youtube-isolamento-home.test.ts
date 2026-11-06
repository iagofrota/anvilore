import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executarYtDlp } from "../src/lib/yt-dlp";

// P1 do Codex no PR #63 (S4):
// O teste do yt-dlp real nunca pode gravar ou apagar ~/.config/yt-dlp/config real (homedir()).
// Deve usar mkdtemp isolado para HOME, XDG_CONFIG_HOME e APPDATA passados ao subprocesso.
const fonteYoutube = await readFile(join(import.meta.dir, "youtube.test.ts"), "utf8");

test("Dado tests/youtube.test.ts, Quando procuro homedir para escrita de config, Então não usa homedir()", () => {
  expect(fonteYoutube).not.toMatch(/homedir\(/);
});

test.skipIf(!Bun.which("yt-dlp"))("Dado execução de yt-dlp com HOME configurado no ambiente, Quando executa, Então o arquivo sob o HOME do processo de teste não é criado nem alterado", async () => {
  const homeProcessoFalso = await mkdtemp(join(tmpdir(), "anvilore-proc-home-"));
  const canarioProcesso = join(homeProcessoFalso, ".config", "yt-dlp", "config");
  await mkdir(dirname(canarioProcesso), { recursive: true });
  await writeFile(canarioProcesso, "# config original do processo\n");
  const conteudoOriginal = await readFile(canarioProcesso, "utf8");

  const homeSubprocesso = await mkdtemp(join(tmpdir(), "anvilore-subproc-home-"));
  try {
    const res = await (executarYtDlp as any)(["--version"], {
      env: {
        HOME: homeSubprocesso,
        XDG_CONFIG_HOME: join(homeSubprocesso, ".config"),
        APPDATA: join(homeSubprocesso, "AppData", "Roaming"),
      },
    });
    expect(res.codigo).toBe(0);
    expect(await stat(canarioProcesso).then(() => true, () => false)).toBe(true);
    expect(await readFile(canarioProcesso, "utf8")).toBe(conteudoOriginal);
  } finally {
    await rm(homeProcessoFalso, { recursive: true, force: true });
    await rm(homeSubprocesso, { recursive: true, force: true });
  }
});
