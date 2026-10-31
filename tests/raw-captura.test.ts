import { afterEach, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agoraComOffset, gravarCaptura, montarMd, sha256, validarAssunto, validarSubpasta } from "../src/lib/raw-captura";
const temporarios: string[] = [];
const data = new Date(2026, 9, 31, 12, 30);
const bytes = new TextEncoder().encode('ação\r\n😀 sem fim');
async function raiz() { const p = await mkdtemp(join(tmpdir(), 'captura-')); temporarios.push(p); return p; }
afterEach(async () => { for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });
test('Dado texto, Quando capturar duas vezes, Então preserva bytes e usa -2', async () => {
  const p = await raiz();
  const a = await gravarCaptura(p, 'nota', undefined, 'ideia', [{ ext: 'md', bytes }], data);
  expect(a).toEqual(['raw/notas/2026-10-31-ideia.md']);
  const hash = sha256(await readFile(join(p, a[0]!)));
  const b = await gravarCaptura(p, 'nota', undefined, 'ideia', [{ ext: 'md', bytes }], data);
  expect(b).toEqual(['raw/notas/2026-10-31-ideia-2.md']);
  expect(await readFile(join(p, a[0]!))).toEqual(Buffer.from(bytes));
  expect(sha256(await readFile(join(p, a[0]!)))).toBe(hash);
  expect(await readdir(join(p, 'raw/notas'))).toHaveLength(2);
});
test('Dado html existente, Quando capturar par, Então sufixa o conjunto', async () => {
  const p = await raiz(); await mkdir(join(p, 'raw/sites'), {recursive:true});
  await writeFile(join(p, 'raw/sites/2026-10-31-x.html'), 'original');
  expect(await gravarCaptura(p, 'site', undefined, 'x', [{ext:'md',bytes},{ext:'html',bytes}], data)).toEqual(['raw/sites/2026-10-31-x-2.md','raw/sites/2026-10-31-x-2.html']);
});
test('Dado colisão entre escolha e link, Quando publicar primeiro arquivo, Então tenta -2 sem perda', async () => {
  const p = await raiz(); let vezes=0;
  const r = await gravarCaptura(p,'nota',undefined,'x',[{ext:'md',bytes}],data,{link:async (tmp,final) => {
    if (vezes++ === 0) await writeFile(final,'pessoa'); await link(tmp,final);
  }});
  expect(r[0]).toEndWith('-2.md'); expect(await readFile(join(p,'raw/notas/2026-10-31-x.md'),'utf8')).toBe('pessoa');
  expect(await readdir(join(p,'raw/notas'))).toHaveLength(2);
});
test('Dado colisão no segundo arquivo, Quando publicar par, Então mantém ambos e limpa temporário', async () => {
  const p=await raiz(); let vezes=0;
  await expect(gravarCaptura(p,'site',undefined,'x',[{ext:'md',bytes},{ext:'html',bytes}],data,{link:async (tmp,final)=>{
    if (++vezes===2) await writeFile(final,'pessoa'); await link(tmp,final);
  }})).rejects.toThrow('outro processo gravou ao mesmo tempo; nada foi sobrescrito');
  expect(await readdir(join(p,'raw/sites'))).toHaveLength(2);
  expect(await readFile(join(p,'raw/sites/2026-10-31-x.html'),'utf8')).toBe('pessoa');
});
test('Dado disco sem hardlink, Quando gravar, Então usa criação exclusiva e conserva original', async () => {
 const p=await raiz(); const deps={link:async()=>{throw Object.assign(new Error('sem suporte'),{code:'EPERM'});}};
 for(let i=0;i<2;i++) await gravarCaptura(p,'nota','Reuniões 2026','x',[{ext:'md',bytes}],data,deps);
 expect((await readdir(join(p,'raw/notas/Reuniões 2026'))).sort()).toEqual(['2026-10-31-x-2.md','2026-10-31-x.md']);
 expect(await readFile(join(p,'raw/notas/Reuniões 2026/2026-10-31-x.md'))).toEqual(Buffer.from(bytes));
});
test('Dado erro de link, Quando gravar, Então não deixa temporário',async()=>{
 const p=await raiz(); await expect(gravarCaptura(p,'nota',undefined,'x',[{ext:'md',bytes}],data,{link:async()=>{throw new Error('falhou');}})).rejects.toThrow('falhou');
 expect(await readdir(join(p,'raw/notas'))).toEqual([]);
});
test('Dado assunto e subpasta, Quando validar, Então recusa nomes fora do contrato',()=>{
 for(const s of ['Conversa','a--b','-a','a'.repeat(61),'']) expect(validarAssunto(s)).toBeString();
 expect(validarAssunto('conversa-com-joao')).toBeUndefined();
 for(const s of ['..','a/b','a\\b','RAW','.','']) expect(validarSubpasta(s)).toBeString();
 expect(validarSubpasta('Reuniões 2026')).toBeUndefined();
});
test('Dado proveniência, Quando montar Markdown, Então escapa YAML e preserva corpo CRLF',()=>{
 const md=montarMd({capturado_em:agoraComOffset(data),origem:'chat',tipo:'nota',contexto:'"a"\\b\nlinha',sha256:sha256(bytes),z:true,a:'extra'},bytes);
 const s=new TextDecoder().decode(md); expect(s).toContain('contexto: "\\"a\\"\\\\b\\nlinha"\n');
 expect(s.indexOf('a: "extra"')).toBeLessThan(s.indexOf('z: true'));
 expect(md.slice(md.length-bytes.length)).toEqual(bytes);
 expect(agoraComOffset(data)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
});
