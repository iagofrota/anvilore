import { afterEach,expect,test } from 'bun:test';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { capturar } from '../src/comandos/capturar';
import { sha256 } from '../src/lib/raw-captura';
import { dataCaptura,lerCaptura,wikiCaptura } from './apoio/captura';
const limpezas:Array<()=>Promise<void>>=[];const servidores:ReturnType<typeof Bun.serve>[]=[];
afterEach(async()=>{for(const s of servidores.splice(0))s.stop(true);for(const f of limpezas.splice(0))await f();});
async function wiki(){const w=await wikiCaptura();limpezas.push(w.limpar);return w.raiz;}
function servir(fetch:(r:Request)=>Response){const s=Bun.serve({port:0,hostname:'127.0.0.1',fetch});servidores.push(s);return `http://127.0.0.1:${s.port}/artigo`;}
const deps={agora:()=>dataCaptura};
test('Dado HTML original, Quando capturar link, Então guarda HTML exato e hash de proveniência',async()=>{
 const r=await wiki();const html=await readFile(join(import.meta.dir,'fixtures/captura/artigo.html'));const url=servir(()=>new Response(html,{headers:{'content-type':'text/html'}}));
 const s=await capturar(['link',url,'--assunto','artigo','--teste'],r,deps);expect(s.codigo).toBe(0);expect(s.linhas).toEqual(['raw/sites/2026-10-31-artigo.md','raw/sites/2026-10-31-artigo.html']);
 expect(await readFile(join(r,s.linhas[1]!))).toEqual(html);expect((await lerCaptura(r,s.linhas[0]!)).meta).toMatchObject({sha256:sha256(html),metodo:'extracao',origem:url});
 expect((await capturar(['link',url,'--assunto','negado'],r,deps)).codigo).toBe(1);
});
test('Dado alternate markdown, Quando capturar, Então prefere texto oficial e guarda HTML original',async()=>{
 const r=await wiki();const texto='# Oficial\r\n'+ 'conteúdo original '.repeat(20);const html='<html><head><link rel="alternate" type="text/markdown" href="/oficial.md"></head><body>curto</body></html>';
 const url=servir(req=>new Response(req.url.endsWith('.md')?texto:html,{headers:{'content-type':req.url.endsWith('.md')?'text/markdown':'text/html'}}));
 const s=await capturar(['link',url,'--assunto','oficial','--teste'],r,deps);expect(s.codigo).toBe(0);const c=await lerCaptura(r,s.linhas[0]!);expect(c.corpo.toString()).toBe(texto);expect(c.meta.metodo).toBe('markdown-do-site');expect(await readFile(join(r,s.linhas[1]!),'utf8')).toBe(html);
});
for(const tipo of ['text/plain','text/markdown'])test(`Dado ${tipo}, Quando capturar, Então mantém bytes e dispensa HTML`,async()=>{
 const r=await wiki();const texto='ação\r\n'+'texto '.repeat(50);const url=servir(()=>new Response(texto,{headers:{'content-type':tipo}}));const s=await capturar(['link',url,'--assunto','texto','--teste'],r,deps);expect(s.codigo).toBe(0);expect(s.linhas.length).toBe(1);const c=await lerCaptura(r,s.linhas[0]!);expect(c.corpo.toString()).toBe(texto);expect(c.meta.metodo).toBe('texto-do-site');
});
test('Dado página vazia, Quando capturar, Então para sem gravar',async()=>{const r=await wiki();const url=servir(()=>new Response('<p>vazia</p>',{headers:{'content-type':'text/html'}}));const s=await capturar(['link',url,'--assunto','vazia','--teste'],r,deps);expect(s.codigo).toBe(1);expect(s.erro).toContain('a página parece vazia ou depende de JavaScript');expect(s.linhas).toEqual([]);});
for(const html of [false,true])test(`Dado navegador com HTML=${html}, Quando capturar, Então mantém bytes e método`,async()=>{
 const r=await wiki();const texto=Buffer.from('navegador\r\n'+'texto '.repeat(50));const original=Buffer.from('<html>renderizado</html>');await writeFile(join(r,'texto.tmp'),texto);await writeFile(join(r,'html.tmp'),original);
 const s=await capturar(['link','https://e.test/artigo','--metodo','navegador','--de',join(r,'texto.tmp'),...(html?['--html',join(r,'html.tmp')]:[]),'--assunto','navegador'],r,deps);
 expect(s.codigo).toBe(0);const c=await lerCaptura(r,s.linhas[0]!);expect(c.corpo).toEqual(texto);expect(c.meta).toMatchObject({metodo:'navegador',sha256:sha256(html?original:texto)});expect(s.linhas.length).toBe(html?2:1);
});

test('Dado URL e contexto em arquivos, Quando capturar link, Então preserva contexto e tira só espaços e quebras da URL',async()=>{
 const r=await wiki();const url='https://exemplo.com/raw/artigo';const contexto='  foto raw do evento\r\n"ação" 😀  ';
 await writeFile(join(r,'url.txt'),' \r\n'+url+'\n ');await writeFile(join(r,'contexto.txt'),contexto);
 const vistas:string[]=[];const baixar=async(u:string)=>{vistas.push(u);return{urlFinal:u,status:200,tipo:'text/plain',bytes:Buffer.from('Fonte integral '.repeat(30))};};
 const s=await capturar(['link','--url-de',join(r,'url.txt'),'--contexto-de',join(r,'contexto.txt'),'--assunto','referencia'],r,{...deps,baixar});
 expect(s.codigo).toBe(0);expect(vistas).toEqual([url]);expect((await lerCaptura(r,s.linhas[0]!)).meta).toMatchObject({origem:url,contexto});
});
for(const tipo of ['link','video'])test(`Dado URL posicional junto com url-de, Quando capturar ${tipo}, Então sai 2`,async()=>{
 const r=await wiki();await writeFile(join(r,'url.txt'),'https://exemplo.com/raw/artigo');
 expect((await capturar([tipo,'https://exemplo.com','--url-de',join(r,'url.txt'),'--assunto','x'],r,deps)).codigo).toBe(2);
});
test('Dado url-de dentro de raw, Quando capturar, Então sai 2',async()=>{
 const r=await wiki();await writeFile(join(r,'raw/url.txt'),'https://exemplo.com');
 expect((await capturar(['link','--url-de',join(r,'raw/url.txt'),'--assunto','x'],r,deps)).codigo).toBe(2);
});
