import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { criarCenario, raizDoRepo, type Cenario } from "./apoio/instalar-sh";
import { embutirInstalador } from "../scripts/embutir-instalador";

// As funções do instalar.sh sem rodar a instalação (ANVILORE_INSTALAR_CARREGAR=1 só define as funções), a descoberta
// da versão pelo GitHub (com `curl` de mentira), a pasta padrão e as respostas por /dev/tty num pseudoterminal.

const linux = process.platform === "linux";
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof criarCenario>) { const c = await criarCenario(...args); cenarios.push(c); return c; }
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);

function funcao(c: Cenario, corpo: string, extra: Record<string, string> = {}) {
  const p = Bun.spawnSync(["bash", "-c", `source "${c.script}"; ${corpo}`], { env: c.env({ ANVILORE_INSTALAR_CARREGAR: "1", ...extra }), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { codigo: p.exitCode, saida: p.stdout.toString().trim(), erro: p.stderr.toString().trim() };
}

test.skipIf(!linux)("Dado o manifesto real embutido, Quando o awk lê cada campo, Então bate com o JSON de instalador/dependencias.json", async () => {
  const c = await novo();
  const real = await readFile(join(raizDoRepo, "instalador/dependencias.json"), "utf8");
  const script = join(c.pai, "real.sh");
  await writeFile(script, embutirInstalador(c.modelo, real, c.assinantes));
  const m = JSON.parse(real) as { dependencias: Record<string, { versao: string; plataformas: Record<string, Record<string, string | number>> }> };
  const lidos: string[] = [], esperados: string[] = [];
  for (const [dep, d] of Object.entries(m.dependencias)) {
    lidos.push(`${dep}/-/versao=${funcaoNoScript(c, script, `manifesto_campo ${dep} - versao`)}`); esperados.push(`${dep}/-/versao=${d.versao}`);
    for (const [plat, e] of Object.entries(d.plataformas)) {
      for (const campo of ["arquivo", "url", "sha256", "formato", "executavel"]) {
        lidos.push(`${dep}/${plat}/${campo}=${funcaoNoScript(c, script, `manifesto_campo ${dep} ${plat} ${campo}`)}`);
        esperados.push(`${dep}/${plat}/${campo}=${e[campo]}`);
      }
    }
  }
  expect(lidos).toEqual(esperados);
  expect(funcaoNoScript(c, script, "manifesto_campo bun linux-mips url")).toBe("");
  expect(funcaoNoScript(c, script, "manifesto_campo rg windows-x64-baseline url")).toBe("");
  expect(funcaoNoScript(c, script, "manifesto_campo bun linux-x64 inexistente")).toBe("");
  expect(funcaoNoScript(c, script, "manifesto_campo ninguem linux-x64 url")).toBe("");
});
function funcaoNoScript(c: Cenario, script: string, corpo: string) {
  const p = Bun.spawnSync(["bash", "-c", `source "${script}"; ${corpo}`], { env: c.env({ ANVILORE_INSTALAR_CARREGAR: "1" }), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString().trim();
}

test.skipIf(!linux)("Dado versões do Bun, Quando comparo, Então 1.10 > 1.4, o igual vale e o sufixo de canary é ignorado", async () => {
  const c = await novo();
  const maiorOuIgual = (a: string, b: string) => funcao(c, `versao_maior_ou_igual "${a}" "${b}"`).codigo === 0;
  expect(maiorOuIgual("1.4.1", "1.4.1")).toBe(true);
  expect(maiorOuIgual("1.10.0", "1.4.1")).toBe(true);
  expect(maiorOuIgual("1.4.2-canary.3+abc", "1.4.1")).toBe(true);
  expect(maiorOuIgual("1.4.0", "1.4.1")).toBe(false);
  expect(maiorOuIgual("0.9.9", "1.0.0")).toBe(false);
});

const CURL_FALSO = (reais: string) => `#!/bin/sh
case "$*" in
  *api.github.com*) [ -n "$FALSO_API" ] && { printf '{\\n  "tag_name": "%s",\\n  "draft": false\\n}\\n' "$FALSO_API"; exit 0; }; exit 22 ;;
  *releases/latest*) [ -n "$FALSO_LOCATION" ] && { printf '%s' "$FALSO_LOCATION"; exit 0; }; exit 22 ;;
  *) exec ${reais} "$@" ;;
esac
`;

test.skipIf(!linux)("Dado o redirecionamento de releases/latest, Quando descubro a versão, Então usa a tag dele; sem ele, cai para a API; sem os dois, falha com mensagem simples", async () => {
  const c = await novo();
  await c.comando("curl", CURL_FALSO(Bun.which("curl")!));
  const sem = { ANVILORE_ORIGEM: "" };
  const a = funcao(c, "resolver_tag; echo $TAG", { ...sem, FALSO_LOCATION: "https://github.com/iagofrota/anvilore/releases/tag/v0.4.1" });
  expect(a.saida).toBe("v0.4.1");
  const b = funcao(c, "resolver_tag; echo $TAG", { ...sem, FALSO_API: "v0.5.0" });
  expect(b.saida).toBe("v0.5.0");
  const ruim = funcao(c, "resolver_tag; echo $TAG", { ...sem, FALSO_LOCATION: "https://github.com/iagofrota/anvilore/releases/tag/v1;rm -rf" });
  expect(ruim.codigo).toBe(1);
  const nenhum = funcao(c, "resolver_tag; echo $TAG", sem);
  expect(nenhum.codigo).toBe(1);
  expect(nenhum.erro).toContain("não consegui descobrir qual é a última versão");
  const outroDestino = funcao(c, "resolver_tag; echo $TAG", { ...sem, FALSO_LOCATION: "https://exemplo.com/login" });
  expect(outroDestino.codigo).toBe(1);
  const explicita = funcao(c, "resolver_tag; echo $TAG", { ...sem, ANVILORE_VERSAO: "0.7.2" });
  expect(explicita.saida).toBe("v0.7.2");
});

test.skipIf(!linux)("Dado um repositório com várias tags, Quando instalo de ANVILORE_ORIGEM, Então escolhe a maior versão estável e ignora pré-release", async () => {
  const c = await novo({ versoes: ["0.3.0", "0.10.0", "0.9.0"] });
  c.kit.ok(["tag", "v0.11.0-rc.1"]);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Anvilore v0.10.0");
  expect(c.kit.git(["-C", c.pasta, "describe", "--tags", "--exact-match", "HEAD"]).saida.trim()).toBe("v0.10.0");
  expect((await c.estado()).versaoInstalada).toBe("0.10.0");
});

test.skipIf(!linux)("Dado a origem oficial (sem ANVILORE_ORIGEM), Quando instalo, Então descobre a tag pelo redirecionamento e deixa o origin oficial para o atualizador", async () => {
  const c = await novo();
  await c.comando("curl", CURL_FALSO(Bun.which("curl")!));
  const r = c.rodar({
    ANVILORE_ORIGEM: "", FALSO_LOCATION: "https://github.com/iagofrota/anvilore/releases/tag/v0.3.0",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${c.kit.raiz}.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/iagofrota/anvilore.git",
  });
  expect(r.codigo, r.tudo).toBe(0);
  const url = Bun.spawnSync(["git", "-C", c.pasta, "config", "--get", "remote.origin.url"], { stdout: "pipe" }).stdout.toString().trim();
  expect(url).toBe("https://github.com/iagofrota/anvilore.git");
  expect(r.saida).toContain("Anvilore v0.3.0");
});

// ---- respostas por /dev/tty ----------------------------------------------------------------------------------------

const PTY = `
import json, os, pty, select, sys, time
cfg = json.loads(os.environ["PTY_CFG"])
pid, fd = pty.fork()
if pid == 0:
    os.execvpe("bash", ["bash", "-c", 'cat "$0" | bash', cfg["script"]], os.environ)
saida = b""
respondidas = set()
fim = time.time() + 90
while time.time() < fim:
    pronto, _, _ = select.select([fd], [], [], 0.2)
    if pronto:
        try:
            dados = os.read(fd, 4096)
        except OSError:
            break
        if not dados:
            break
        saida += dados
        texto = saida.decode("utf8", "replace")
        for i, (gatilho, resposta) in enumerate(cfg["respostas"]):
            if i not in respondidas and gatilho in texto:
                respondidas.add(i)
                os.write(fd, (resposta + "\\n").encode())
_, estado = os.waitpid(pid, 0)
print(json.dumps({"saida": saida.decode("utf8", "replace"), "codigo": os.waitstatus_to_exitcode(estado)}))
`;
function noPty(c: Cenario, respostas: [string, string][], extra: Record<string, string> = {}) {
  const env = { ...c.env(extra), PTY_CFG: JSON.stringify({ script: c.script, respostas }) };
  delete (env as Record<string, string | undefined>).ANVILORE_SEM_PERGUNTAS;
  const p = Bun.spawnSync([Bun.which("python3")!, "-I", "-c", PTY], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`pty falhou: ${p.stderr.toString()}`);
  return JSON.parse(p.stdout.toString()) as { saida: string; codigo: number };
}

test.skipIf(!linux || !Bun.which("python3"))("Dado curl | bash num terminal, Quando o instalador pergunta, Então lê a resposta de /dev/tty, mostra o resumo e espera Enter antes de fechar", async () => {
  const c = await novo({ agentes: [] });
  const r = noPty(c, [["[S/n]", "n"], ["Pressione Enter", ""]], { ANVILORE_ESPERAR_ENTER: "1" });
  expect(r.codigo, r.saida).toBe(0);
  expect(r.saida).toContain("Quer que eu instale o Claude Code agora");
  expect(r.saida).toContain("Instalação parcial");
  expect(r.saida.indexOf("Instalação parcial")).toBeLessThan(r.saida.indexOf("Pressione Enter"));
  expect(await readFile(join(c.pasta, ".anvilore/instalacao.log"), "utf8")).toMatch(/pergunta: Quer que eu instale o Claude Code.*→ 'n'/);
});

test.skipIf(!linux || !Bun.which("python3"))("Dado a pasta padrão ocupada, Quando a pessoa digita outro nome no terminal, Então instala nessa pasta", async () => {
  const c = await novo();
  await mkdir(c.pasta);
  await writeFile(join(c.pasta, "meu.txt"), "meu\n");
  const outra = join(c.pai, "Escolhida");
  const r = noPty(c, [["Em qual pasta instalo?", outra]]);
  expect(r.codigo, r.saida).toBe(0);
  expect(await existe(join(outra, "src/cli.ts"))).toBe(true);
  expect(await readFile(join(c.pasta, "meu.txt"), "utf8")).toBe("meu\n");
});

test.skipIf(!linux || !Bun.which("python3"))("Dado git ausente, Quando a pessoa recusa o sudo no terminal, Então para sem instalar nada", async () => {
  const c = await novo();
  Bun.spawnSync(["rm", "-f", join(c.bin, "git")]);
  await c.comando("sudo", '#!/bin/sh\necho sudo-nao-devia-rodar >&2\nexit 1\n');
  await c.comando("apt-get", "#!/bin/sh\nexit 0\n");
  const r = noPty(c, [["[S/n]", "n"]]);
  expect(r.codigo).toBe(1);
  expect(r.saida).toContain("sem git não dá para instalar o Anvilore");
  expect(r.saida).not.toContain("sudo-nao-devia-rodar");
});
