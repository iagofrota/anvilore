import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { criarCenario as CriarCenario, Cenario } from "./apoio/instalar-sh";
import { criarChave } from "./apoio/kit-atualizavel";

// Estado das chaves fora do GitHub (PARECER-SOL-DECISOES-RELEASE.md §2), no instalar.sh: antes de aceitar a tag (instalação
// nova) e antes de delegar ao atualizador da pasta (reinstalação), o instalador consulta a lista do site e só vale a
// INTERSEÇÃO dela com as chaves embutidas. O build de teste leva a URL de loopback embutida (sem rede real).

const linux = process.platform === "linux";
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof CriarCenario>) { const c = await apoio!.criarCenario(...args); cenarios.push(c); return c; }
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);
const FP = (letra: string) => "SHA256:" + letra.repeat(43);
const FRASE = "não consegui conferir a lista atual de chaves";
const SEM_INSTALAR = (c: Cenario) => existe(c.pasta).then(feito => expect(feito).toBe(false));

test.skipIf(!linux)("Dado a chave embutida na lista do site, Quando instalo do zero, Então instala e a consulta pediu sem cache e uma vez só", async () => {
  const c = await novo({ agentes: ["claude"] });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim()).toBe(c.kit.commits["0.3.0"]!);
  const reqs = await c.servidor.requisicoes();
  expect(reqs).toEqual([{ rota: "/confianca.json", cacheControl: "no-cache", pragma: "no-cache" }]);
});

test.skipIf(!linux)("Dado a lista do site SEM a chave embutida (chave retirada), Quando instalo do zero, Então recusa antes de baixar e não cria a pasta", async () => {
  const c = await novo({ agentes: ["claude"], chavesDoSite: () => [FP("B")] });
  const r = c.rodar();
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("não inclui a chave de assinatura deste instalador");
  expect(r.tudo).not.toContain("Baixando");
  expect(r.tudo).not.toContain("Pronto");
  await SEM_INSTALAR(c);
  expect(await existe(join(c.home, ".anvilore-baixando.1"))).toBe(false);
});

test.skipIf(!linux)("Dado o site autorizando uma chave que NÃO está no instalador e a tag assinada por ela, Quando instalo, Então recusa: o site nunca acrescenta chave", async () => {
  const outra = await criarChave(await mkdtemp(join(tmpdir(), "anvilore-outra-")));
  const c = await novo({ agentes: ["claude"], chavesDoSite: kit => [kit, outra.fingerprint] });
  expect(c.kit.git(["-c", "gpg.format=ssh", "-c", `user.signingkey=${outra.chave}`, "tag", "-f", "-s", "v0.3.0", c.kit.commits["0.3.0"]!, "-m", "v0.3.0"]).codigo).toBe(0);
  const r = c.rodar();
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("assinatura inválida");
  await SEM_INSTALAR(c);
});

test.skipIf(!linux)("Dado um instalador com duas chaves embutidas e o site só com a outra, Quando a tag é da chave retirada, Então recusa a assinatura", async () => {
  const outra = await criarChave(await mkdtemp(join(tmpdir(), "anvilore-outra-")));
  const c = await novo({ agentes: ["claude"], assinantesEmbutidos: padrao => padrao + outra.assinantes, chavesDoSite: () => [outra.fingerprint] });
  const r = c.rodar();
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("assinatura inválida");
  await SEM_INSTALAR(c);
});

const FALHAS: [string, (c: Cenario) => Promise<void>][] = [
  ["redirecionamento 302 para um documento válido", c => c.servidor.status(302)],
  ["HTTP 404", c => c.servidor.status(404)],
  ["HTTP 500", c => c.servidor.status(500)],
  ["JSON inválido", c => c.servidor.publicar("{")],
  ["campo extra", c => c.servidor.publicar({ formato: 1, chaves: [FP("A")], versaoMinima: "0.0.0", extra: true })],
  ["formato 2", c => c.servidor.publicar({ formato: 2, chaves: [FP("A")], versaoMinima: "0.0.0" })],
  ["chaves vazia", c => c.servidor.publicar({ formato: 1, chaves: [], versaoMinima: "0.0.0" })],
  ["chave repetida", c => c.servidor.publicar({ formato: 1, chaves: [FP("A"), FP("A")], versaoMinima: "0.0.0" })],
  ["fingerprint com espaço no meio", c => c.servidor.publicar(`{"formato":1,"chaves":["SHA256:${"A".repeat(20)} ${"A".repeat(23)}"],"versaoMinima":"0.0.0"}`)],
  ["versaoMinima com pré-release", c => c.servidor.publicar({ formato: 1, chaves: [FP("A")], versaoMinima: "0.3.0-rc.1" })],
  ["versaoMinima com número de 10 dígitos", c => c.servidor.publicar({ formato: 1, chaves: [FP("A")], versaoMinima: "1234567890.0.0" })],
  // Nome repetido: a lista é a autoridade de revogação, então um documento ambíguo falha fechado (igual ao atualizador).
  ["chaves repetida como propriedade (a última com a chave do kit)", async c => c.servidor.publicar(`{"formato":1,"chaves":["${FP("B")}"],"chaves":["${c.kit.fingerprint}"],"versaoMinima":"0.0.0"}`)],
  ["chaves repetida como propriedade (a primeira com a chave do kit)", async c => c.servidor.publicar(`{"chaves":["${c.kit.fingerprint}"],"formato":1,"chaves":["${FP("B")}"],"versaoMinima":"0.0.0"}`)],
  ["formato repetido", async c => c.servidor.publicar(`{"formato":1,"formato":1,"chaves":["${c.kit.fingerprint}"],"versaoMinima":"0.0.0"}`)],
  ["versaoMinima repetida", async c => c.servidor.publicar(`{"formato":1,"chaves":["${c.kit.fingerprint}"],"versaoMinima":"0.0.0","versaoMinima":"0.0.0"}`)],
  ["documento maior que 64 KiB", c => c.servidor.publicar(`{"formato":1,"chaves":["${FP("A")}"],"versaoMinima":"0.0.0"}${" ".repeat(70 * 1024)}`)],
];
for (const [caso, preparar] of FALHAS) {
  test.skipIf(!linux)(`Dado ${caso}, Quando instalo do zero ou reinstalo, Então recusa com a mensagem simples e nada muda`, async () => {
    const c = await novo({ agentes: ["claude"] });
    await preparar(c);
    const r = c.rodar();
    expect(r.codigo, r.tudo).not.toBe(0);
    expect(r.tudo).toContain(FRASE);
    expect(r.tudo).toContain(c.servidor.url);
    expect(r.tudo).toContain("nada mudou");
    await SEM_INSTALAR(c);
    // Reinstalação sobre uma instalação boa: a recusa também vem antes de executar o atualizador da pasta.
    await c.servidor.publicar({ formato: 1, chaves: [c.kit.fingerprint], versaoMinima: "0.0.0" });
    await c.servidor.status(undefined);
    expect(c.rodar().codigo).toBe(0);
    const cabeca = c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim();
    const chamadas = (await c.chamadas()).length;
    await preparar(c);
    const de_novo = c.rodar({ STUB_ATUALIZAR_CODIGO: "0" });
    expect(de_novo.codigo, de_novo.tudo).not.toBe(0);
    expect(de_novo.tudo).toContain(FRASE);
    expect((await c.chamadas()).length).toBe(chamadas);
    expect(c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim()).toBe(cabeca);
  });
}

test.skipIf(!linux)("Dado o servidor do site fora do ar, Quando instalo, Então recusa com a mensagem simples e não cria a pasta", async () => {
  const c = await novo({ agentes: ["claude"] });
  await c.servidor.parar();
  const r = c.rodar();
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain(FRASE);
  await SEM_INSTALAR(c);
});

test.skipIf(!linux)("Dado a versaoMinima do site acima da tag, Quando instalo, Então recusa antes de baixar; igual à tag, instala", async () => {
  const c = await novo({ agentes: ["claude"] });
  await c.servidor.publicar({ formato: 1, chaves: [c.kit.fingerprint], versaoMinima: "0.3.1" });
  const r = c.rodar();
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("exige a versão 0.3.1");
  expect(r.tudo).not.toContain("Baixando");
  await SEM_INSTALAR(c);
  await c.servidor.publicar({ formato: 1, chaves: [c.kit.fingerprint], versaoMinima: "0.3.0" });
  expect(c.rodar().codigo).toBe(0);
});

test.skipIf(!linux)("Dado variáveis de ambiente que parecem apontar a URL ou o proxy de teste, Quando instalo, Então a URL embutida é a única consultada", async () => {
  const c = await novo({ agentes: ["claude"] });
  const morta = "http://127.0.0.1:9/confianca.json";
  const r = c.rodar({ ANVILORE_URL_CONFIANCA: morta, ANVILORE_CONFIANCA_URL: morta, URL_CONFIANCA: morta, ANVILORE_CONFIANCA: morta });
  expect(r.codigo, r.tudo).toBe(0);
  expect((await c.servidor.requisicoes()).length).toBe(1);
});

test.skipIf(!linux)("Dado a reinstalação com a chave na lista, Quando rodo de novo, Então delega ao atualizador entregando só as linhas permitidas", async () => {
  const outra = await criarChave(await mkdtemp(join(tmpdir(), "anvilore-outra-")));
  const c = await novo({ agentes: ["claude"], assinantesEmbutidos: padrao => padrao + outra.assinantes });
  expect(c.rodar().codigo).toBe(0);
  const r = c.rodar({ STUB_ATUALIZAR_CODIGO: "0" });
  expect(r.codigo, r.tudo).toBe(0);
  const entregas = (await readFile(join(c.pasta, ".anvilore/atualizar-entrega.log"), "utf8")).trim().split("\n").map(l => JSON.parse(l) as { conteudo: string });
  // Só a linha da chave que o site ainda autoriza (a do kit); a outra, embutida no instalador, ficou de fora.
  expect(entregas.at(-1)!.conteudo).toBe(`${c.assinantes.split("\n")[0]}\n`);
  expect(entregas.at(-1)!.conteudo).not.toContain(outra.assinantes.trim().split(" ")[3]!);
});

test.skipIf(!linux)("Dado a reinstalação com a lista sem a chave embutida, Quando rodo, Então recusa antes de executar a pasta, e depois que o site volta a listá-la, segue (revogação nova reconhecida)", async () => {
  const c = await novo({ agentes: ["claude"] });
  expect(c.rodar().codigo).toBe(0);
  const cabeca = c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim();
  const chamadas = (await c.chamadas()).length;
  await c.servidor.publicar({ formato: 1, chaves: [FP("C")], versaoMinima: "0.0.0" });
  const r = c.rodar({ STUB_ATUALIZAR_CODIGO: "0" });
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("não inclui a chave de assinatura deste instalador");
  expect((await c.chamadas()).length).toBe(chamadas);
  expect(c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim()).toBe(cabeca);
  await c.servidor.publicar({ formato: 1, chaves: [c.kit.fingerprint], versaoMinima: "0.0.0" });
  expect(c.rodar({ STUB_ATUALIZAR_CODIGO: "0" }).codigo).toBe(0);
});

test.skipIf(!linux)("Dado uma pasta anterior à base mínima e o site fora do ar, Quando reinstalo, Então vale a mensagem da base mínima e o site nem é consultado (a base vem antes)", async () => {
  const c = await novo({ agentes: ["claude"] });
  expect(c.rodar().codigo).toBe(0);
  const antiga = join(c.pai, "antiga");
  await cp(c.pasta, antiga, { recursive: true, verbatimSymlinks: true });
  await writeFile(join(antiga, "package.json"), JSON.stringify({ name: "anvilore", version: "0.2.0" }));
  await c.servidor.status(500);
  const antes = (await c.servidor.requisicoes()).length;
  const r = c.rodar({ ANVILORE_PASTA: antiga });
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("anterior à primeira versão assinada");
  expect(r.tudo).not.toContain(FRASE);
  expect((await c.servidor.requisicoes()).length).toBe(antes);
});

test.skipIf(!linux)("Dado a pasta instalada abaixo da versaoMinima do site, Quando reinstalo, Então recusa antes de executar qualquer coisa dela; na versão mínima ou acima, segue", async () => {
  const c = await novo({ agentes: ["claude"] });
  expect(c.rodar().codigo).toBe(0);
  const cabeca = c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim();
  const chamadas = (await c.chamadas()).length;
  await c.servidor.publicar({ formato: 1, chaves: [c.kit.fingerprint], versaoMinima: "0.3.1" });
  const r = c.rodar({ STUB_ATUALIZAR_CODIGO: "0" });
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("versão 0.3.0");
  expect(r.tudo).toContain("exige a versão 0.3.1");
  expect(r.tudo).toContain("não executei nada dela");
  expect(r.tudo).not.toContain("Pronto");
  expect((await c.chamadas()).length).toBe(chamadas);
  expect(c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim()).toBe(cabeca);
  await c.servidor.publicar({ formato: 1, chaves: [c.kit.fingerprint], versaoMinima: "0.3.0" });
  expect(c.rodar({ STUB_ATUALIZAR_CODIGO: "0" }).codigo).toBe(0);
});

test.skipIf(!linux)("Dado um instalador sem a URL embutida, ou com http fora de loopback, Quando rodo, Então recusa antes de qualquer passo", async () => {
  const c = await novo({ agentes: ["claude"] });
  const original = await readFile(c.script, "utf8");
  for (const [nome, corpo] of [["vazia", "  :\n"], ["http", "  cat <<'ANVILORE_FIM_URL_CONFIANCA'\nhttp://anvilore.iagofrota.com.br/confianca.json\nANVILORE_FIM_URL_CONFIANCA\n"], ["com espaço", "  cat <<'ANVILORE_FIM_URL_CONFIANCA'\nhttps://exemplo.com/a b\nANVILORE_FIM_URL_CONFIANCA\n"]] as const) {
    const script = join(c.pai, `sem-url-${nome}.sh`);
    await writeFile(script, original.replace(/(# >>> ANVILORE:URL_CONFIANCA[^\n]*\nurl_confianca_embutida\(\) \{\n)[\s\S]*?(\}\n# <<< ANVILORE:URL_CONFIANCA)/, (_m, a, b) => `${a}${corpo}${b}`));
    const r = c.rodar({}, [], script);
    expect(r.codigo, `${nome}: ${r.tudo}`).not.toBe(0);
    expect(r.tudo, nome).toContain("lista atual de chaves");
    expect(r.tudo, nome).toContain("instalar.sh da release");
    await SEM_INSTALAR(c);
  }
});

test.skipIf(!linux)("Dado o modelo do repositório, Quando leio o instalar.sh, Então a consulta usa curl com https, sem redirecionamento, com limites e não lê o ambiente", async () => {
  const texto = await readFile(join(apoio!.raizDoRepo, "instalador/instalar.sh"), "utf8");
  const corpo = /\nconsultar_confianca\(\) \{[\s\S]*?\n\}\n/.exec(texto)?.[0] ?? "";
  expect(corpo).not.toBe("");
  expect(corpo).toContain("--max-redirs 0");
  expect(corpo).toContain("--max-time 15");
  expect(corpo).toContain("--max-filesize 65536");
  expect(corpo).toMatch(/Cache-Control: no-cache/);
  expect(corpo).toMatch(/Pragma: no-cache/);
  expect(corpo).toMatch(/--proto "=\$proto"/);
  expect(corpo).not.toMatch(/\$\{?ANVILORE_/);
  // A ordem de principal(): base mínima (sem executar a pasta) antes da consulta, que vem antes de delegar ao atualizador.
  const passo = /\npasso_atualizar_existente\(\) \{[\s\S]*?\n\}\n/.exec(texto)?.[0] ?? "";
  expect(passo.indexOf("conferir_estado_das_chaves")).toBeGreaterThan(-1);
  expect(passo.indexOf("conferir_estado_das_chaves")).toBeLessThan(passo.indexOf("src/cli.ts atualizar"));
  expect(texto.indexOf("passo_conferir_base_minima; passo_atualizar_existente")).toBeGreaterThan(-1);
});
