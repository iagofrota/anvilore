import { afterEach, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { capturar } from '../src/comandos/capturar';
import { sha256 } from '../src/lib/raw-captura';
import { subcomandos } from '../src/cli';
import { dataCaptura, lerCaptura, wikiCaptura } from './apoio/captura';
const limpezas:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const f of limpezas.splice(0)) await f();});
async function wiki(){const w=await wikiCaptura();limpezas.push(w.limpar);return w.raiz;}
const deps={agora:()=>dataCaptura};
test('Dado nota CRLF com emoji, Quando capturar, Então preserva corpo, contexto e sha256',async()=>{
 const r=await wiki(); const texto=Buffer.from('Olá\r\n😀 sem fim'); await writeFile(join(r,'nota.txt'),texto);
 const s=await capturar(['nota','--de',join(r,'nota.txt'),'--assunto','ideia','--contexto',' "negócio"\n fim '],r,deps);
 expect(s.codigo).toBe(0); expect(s.linhas).toEqual(['raw/notas/2026-10-31-ideia.md']);
 const {meta,corpo}=await lerCaptura(r,s.linhas[0]!); expect(corpo).toEqual(texto);
 expect(meta).toMatchObject({tipo:'nota',origem:'chat',contexto:' "negócio"\n fim ',sha256:sha256(texto)});
});
for(const [arquivo,pasta,tipo] of [['print.PNG','imagens','imagem'],['Relatório final.PDF','arquivos','arquivo']]) {
 test(`Dado ${arquivo}, Quando capturar arquivo, Então copia binário e cria contexto irmão`,async()=>{
 const r=await wiki();await mkdir(join(r,'Área de Trabalho'));const origem=join(r,'Área de Trabalho',arquivo!);
 const bytes=Buffer.from([0,255,13,10,42]);await writeFile(origem,bytes);
 const s=await capturar(['arquivo',origem,'--assunto','referencia'],r,deps);
 expect(s.codigo).toBe(0); expect(s.linhas[0]).toBe(`raw/${pasta}/2026-10-31-referencia.md`);
 const {meta,corpo}=await lerCaptura(r,s.linhas[0]!);expect(meta).toMatchObject({tipo,origem,sha256:sha256(bytes)});expect(corpo.length).toBe(0);
 expect(await readFile(join(r,s.linhas[1]!))).toEqual(bytes);expect(await readFile(origem)).toEqual(bytes);
 });
}
test('Dado entrada raw, Quando capturar nota, Então sai 2 sem gravar',async()=>{
 const r=await wiki();await writeFile(join(r,'raw/x.md'),'x');const s=await capturar(['nota','--de',join(r,'raw/x.md'),'--assunto','y'],r,deps);expect(s.codigo).toBe(2);
});
test('Dado raiz sem raw, Quando capturar, Então orienta pasta da wiki',async()=>{
 const r=await wiki();const s=await capturar(['nota','--de','x','--assunto','y'],join(r,'inexistente'),deps);expect(s.codigo).toBe(2);expect(s.erro).toContain('rode na pasta da wiki');
});
for(const args of [[],['desconhecido'],['nota','--assunto','Conversa'],['nota','--assunto','x','--subpasta','..'],['nota','--assunto','x'],['arquivo','--assunto','x'],['nota','--de','x','--assunto','x','--desconhecido']]) {
 test(`Dado uso inválido ${args.join(' ')}, Quando capturar, Então sai 2`,async()=>{expect((await capturar(args,await wiki(),deps)).codigo).toBe(2);});
}
test('Dado CLI, Quando listar comandos, Então inclui capturar',()=>{expect(subcomandos.capturar).toBeFunction();});
for(const existente of ['md','original.md']) test(`Dado Markdown e colisão em .${existente}, Quando capturar arquivo, Então preserva original e sufixa o par`,async()=>{
 const r=await wiki();const texto=Buffer.from('---\r\ntitle: "Original"\r\n---\r\n# Ação 😀 sem fim');
 const origem=join(r,'Referência.MD');await writeFile(origem,texto);await mkdir(join(r,'raw/arquivos'),{recursive:true});
 const anterior=join(r,`raw/arquivos/2026-10-31-referencia.${existente}`);await writeFile(anterior,'conteúdo anterior');
 const s=await capturar(['arquivo',origem,'--assunto','referencia','--contexto','Contexto literal'],r,deps);
 expect(s.codigo).toBe(0);expect(s.linhas).toEqual(['raw/arquivos/2026-10-31-referencia-2.md','raw/arquivos/2026-10-31-referencia-2.original.md']);
 expect(await readFile(join(r,s.linhas[1]!))).toEqual(texto);expect(await readFile(origem)).toEqual(texto);expect(await readFile(anterior,'utf8')).toBe('conteúdo anterior');
 const c=await lerCaptura(r,s.linhas[0]!);expect(c.meta).toMatchObject({tipo:'arquivo',origem,sha256:sha256(texto)});expect(c.corpo.toString()).toBe('Contexto literal');
});
