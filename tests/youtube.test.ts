import { afterEach,expect,spyOn,test } from 'bun:test';
import { readFile,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { ehYoutube,escolherLegenda,textoDoJson3 } from '../src/lib/youtube';
import { avisoYtDlp,executarYtDlp } from '../src/lib/yt-dlp';
import { capturar } from '../src/comandos/capturar';
import { sha256 } from '../src/lib/raw-captura';
import { dataCaptura,lerCaptura,wikiCaptura } from './apoio/captura';
const limpezas:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of limpezas.splice(0))await f();});
async function wiki(){const w=await wikiCaptura();limpezas.push(w.limpar);return w.raiz;}
const url='https://www.youtube.com/watch?v=abc123';
test('Dado URLs YouTube, Quando reconhecer, Então aceita só formas de vídeo',()=>{
 for(const u of [url,'https://youtu.be/abc123','https://youtube.com/shorts/abc123','https://m.youtube.com/watch?v=abc123'])expect(ehYoutube(u)).toBe(true);
 for(const u of ['https://vimeo.com/123','https://youtube.com/channel/abc','https://youtube.com.evil.test/watch?v=x','inválida'])expect(ehYoutube(u)).toBe(false);
});
test('Dado legendas, Quando escolher, Então prefere humana por idioma e aceita variantes',()=>{
 expect(escolherLegenda({language:'es',subtitles:{es:[],pt:[],en:[]}})).toEqual({idioma:'es',automatica:false});
 expect(escolherLegenda({language:'es',subtitles:{'pt-BR':[],en:[]},automatic_captions:{es:[]}})).toEqual({idioma:'pt-BR',automatica:false});
 expect(escolherLegenda({subtitles:{en:[]}})).toEqual({idioma:'en',automatica:false});
 expect(escolherLegenda({language:'fr',automatic_captions:{fr:[],pt:[]}})).toEqual({idioma:'fr',automatica:true});
 expect(escolherLegenda({automatic_captions:{pt:[]}})).toEqual({idioma:'pt',automatica:true});
 expect(escolherLegenda({})).toBeUndefined();
});
test('Dado json3 com repetições e eventos vazios, Quando converter, Então junta eventos sem duplicatas',async()=>{
 const json=JSON.parse(await readFile(join(import.meta.dir,'fixtures/captura/legenda.json3'),'utf8'));expect(textoDoJson3(json)).toBe('Olá mundo\nSegunda linha\nTerceira ação');expect(textoDoJson3(null)).toBe('');
});
test('Dado yt-dlp falso, Quando capturar vídeo, Então grava transcrição e proveniência',async()=>{
 const raiz=await wiki();const chamadas:string[][]=[];
 const ytDlp=async(args:string[])=>{chamadas.push(args);if(args.includes('-J'))return {codigo:0,saida:JSON.stringify({id:'abc123',title:'Uma referência',language:'pt',subtitles:{'pt-BR':[]}})};
 const pasta=dirname(args[args.indexOf('-o')+1]!);await writeFile(join(pasta,'abc123.pt-BR.json3'),JSON.stringify({events:[{segs:[{utf8:'Legenda integral'}]}]}));return {codigo:0,saida:''};};
 const s=await capturar(['video',url,'--assunto','referencia'],raiz,{ytDlp,agora:()=>dataCaptura});expect(s.codigo).toBe(0);expect(s.linhas).toEqual(['raw/videos/2026-10-31-referencia.md']);
 const c=await lerCaptura(raiz,s.linhas[0]!);expect(c.meta).toMatchObject({titulo:'Uma referência',origem:url,idioma:'pt-BR',legenda_automatica:false,sha256:sha256(Buffer.from('Legenda integral')),metodo:'yt-dlp-json3'});expect(c.corpo.toString()).toBe('Legenda integral');expect(chamadas[1]).toContain('--write-subs');
 expect(await Bun.file(dirname(chamadas[1]![chamadas[1]!.indexOf('-o')+1]!)).exists()).toBe(false);
});
test('Dado vídeo sem legenda, Quando capturar, Então para',async()=>{
 const s=await capturar(['video',url,'--assunto','sem-legenda'],await wiki(),{ytDlp:async()=>({codigo:0,saida:'{}'})});expect(s.codigo).toBe(1);expect(s.erro).toContain('o vídeo não tem legenda');
});
test('Dado yt-dlp ausente, Quando capturar, Então orienta instalação do sistema',async()=>{
 const spy=spyOn(Bun,'which').mockReturnValue(null);try{const s=await capturar(['video',url,'--assunto','sem-programa'],await wiki());expect(s.codigo).toBe(1);expect(s.erro).toContain(process.platform==='win32'?'winget install yt-dlp':process.platform==='darwin'?'brew install yt-dlp':'pipx install yt-dlp');expect((await executarYtDlp([])).codigo).not.toBe(0);expect(avisoYtDlp('')).toContain('yt-dlp');}finally{spy.mockRestore();}
});
test('Dado executor com programa local, Quando executar, Então drena stdout e stderr e propaga código',async()=>{
 const spy=spyOn(Bun,'which').mockReturnValue(process.execPath);
 try {
  expect(await executarYtDlp(['-e',"process.stdout.write('legenda teste')"])).toEqual({codigo:0,saida:'legenda teste'});
  expect(await executarYtDlp(['-e',"process.stderr.write('falha teste');process.exit(7)"])).toEqual({codigo:7,saida:'falha teste'});
 } finally {spy.mockRestore();}
});

test('Dado aviso de dependência, Quando compor relatório, Então o texto não duplica o prefixo AVISO',()=>{
 const spy=spyOn(Bun,'which').mockReturnValue(null);
 try {expect(avisoYtDlp('')).not.toStartWith('AVISO:');} finally {spy.mockRestore();}
});
