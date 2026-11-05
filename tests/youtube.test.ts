import { afterEach,expect,spyOn,test } from 'bun:test';
import { readFile,writeFile,stat,mkdtemp,rm,chmod,mkdir } from 'node:fs/promises';
import { tmpdir,homedir } from 'node:os';
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
for(const porArquivo of [false,true])test(`Dado yt-dlp falso e url-de=${porArquivo}, Quando capturar vídeo, Então grava transcrição e proveniência`,async()=>{
 const raiz=await wiki();const chamadas:string[][]=[];
 const ytDlp=async(args:string[])=>{chamadas.push(args);if(args.includes('-J'))return {codigo:0,saida:JSON.stringify({id:'abc123',title:'Uma referência',language:'pt',subtitles:{'pt-BR':[]}})};
 const pasta=dirname(args[args.indexOf('-o')+1]!);await writeFile(join(pasta,'abc123.pt-BR.json3'),JSON.stringify({events:[{segs:[{utf8:'Legenda integral'}]}]}));return {codigo:0,saida:''};};
 await writeFile(join(raiz,'url.txt'),' \r\n'+url+'\n ');await writeFile(join(raiz,'contexto.txt'),'legenda raw com ação\r\n');
 const s=await capturar(['video',...(porArquivo?['--url-de',join(raiz,'url.txt')]:[url]),'--contexto-de',join(raiz,'contexto.txt'),'--assunto','referencia'],raiz,{ytDlp,agora:()=>dataCaptura});expect(s.codigo).toBe(0);expect(s.linhas).toEqual(['raw/videos/2026-10-31-referencia.md']);
 const c=await lerCaptura(raiz,s.linhas[0]!);expect(c.meta).toMatchObject({titulo:'Uma referência',origem:url,contexto:'legenda raw com ação\r\n',idioma:'pt-BR',legenda_automatica:false,sha256:sha256(Buffer.from('Legenda integral')),metodo:'yt-dlp-json3'});expect(c.corpo.toString()).toBe('Legenda integral');expect(chamadas[1]).toContain('--write-subs');
 expect(await stat(dirname(chamadas[1]![chamadas[1]!.indexOf('-o')+1]!)).then(()=>true,()=>false)).toBe(false);
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

test('Dado yt-dlp.conf com --exec no cwd, Quando executarYtDlp roda, Então ignora a configuração externa e não executa o comando', async () => {
 const pasta = await mkdtemp(join(tmpdir(), 'anvilore-ytdlp-'));
 const canario = join(pasta, 'CANARIO_EXEC');
 const conf = join(pasta, 'yt-dlp.conf');
 await writeFile(conf, `--exec "pre_process:touch ${canario}"\n`);

 const fakeScript = join(pasta, 'fake-ytdlp.ts');
 await writeFile(fakeScript, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (!args.includes('--ignore-config') && !args.includes('--no-config')) {
 const c = join(process.cwd(), 'yt-dlp.conf');
 if (existsSync(c)) {
  const conteudo = readFileSync(c, 'utf8');
  const m = /--exec\\s+["']?pre_process:touch\\s+([^"'\\r\\n]+)["']?/.exec(conteudo);
  if (m && m[1]) {
   writeFileSync(m[1].trim(), 'canario');
  }
 }
}
process.exit(0);
`);
 const fakeBin = join(pasta, process.platform === 'win32' ? 'fake-ytdlp.cmd' : 'fake-ytdlp.sh');
 if (process.platform === 'win32') {
  await writeFile(fakeBin, `@echo off\r\nbun run "${fakeScript}" %*\r\n`);
 } else {
  await writeFile(fakeBin, `#!/bin/sh\nexec bun run "${fakeScript}" "$@"\n`);
  await chmod(fakeBin, 0o755);
 }
 const spy = spyOn(Bun, 'which').mockReturnValue(fakeBin);

 const cwdAnterior = process.cwd();
 process.chdir(pasta);
 try {
  const res = await executarYtDlp(['-s', '--', 'https://www.youtube.com/watch?v=exemplo']);
  expect(res.codigo).toBe(0);
  const executouCanario = await stat(canario).then(() => true, () => false);
  expect(executouCanario).toBe(false);
 } finally {
  process.chdir(cwdAnterior);
  spy.mockRestore();
  await rm(pasta, { recursive: true, force: true });
 }
});

const binReal = Bun.which('yt-dlp');
const temYtDlp = Boolean(binReal);

test.skipIf(!temYtDlp)('Dado yt-dlp real no PATH, Quando executar com configs em cwd, HOME ou --config-locations, Então ignora e não executa comandos', async () => {
 const pasta = await mkdtemp(join(tmpdir(), 'anvilore-ytdlp-real-'));
 const canCwd = join(pasta, 'CANARIO_CWD');
 const canLoc = join(pasta, 'CANARIO_LOC');

 const homeDir = homedir();
 const configDir = join(homeDir, '.config', 'yt-dlp');
 const configFile = join(configDir, 'config');
 const canHome = join(pasta, 'CANARIO_HOME');

 const extraConf = join(pasta, 'extra.conf');
 await writeFile(extraConf, `--exec "pre_process:touch ${canLoc}"\n`);
 await writeFile(join(pasta, 'yt-dlp.conf'), `--exec "pre_process:touch ${canCwd}"\n--config-locations "${extraConf}"\n`);

 await mkdir(configDir, { recursive: true });
 await writeFile(configFile, `--exec "pre_process:touch ${canHome}"\n`);

 const srv = Bun.serve({
  port: 0,
  fetch() {
   return new Response('<html><body><video src="test.mp4"></video></body></html>', {
    headers: { 'content-type': 'text/html' },
   });
  },
 });

 const cwdAnterior = process.cwd();
 process.chdir(pasta);
 try {
  const res = await executarYtDlp(['-s', '--', `http://127.0.0.1:${srv.port}/index.html`]);
  expect(res.codigo).toBe(0);
  expect(await stat(canCwd).then(() => true, () => false)).toBe(false);
  expect(await stat(canLoc).then(() => true, () => false)).toBe(false);
  expect(await stat(canHome).then(() => true, () => false)).toBe(false);
 } finally {
  process.chdir(cwdAnterior);
  srv.stop(true);
  await rm(configFile, { force: true });
  await rm(pasta, { recursive: true, force: true });
 }
});

test('Dado aviso de dependência, Quando compor relatório, Então o texto não duplica o prefixo AVISO',()=>{
 const spy=spyOn(Bun,'which').mockReturnValue(null);
 try {expect(avisoYtDlp('')).not.toStartWith('AVISO:');} finally {spy.mockRestore();}
});
test('Dado falas iguais em tempos diferentes, Quando converter JSON3, Então preserva cada ocorrência',()=>{
 const events=[0,2000].map(tStartMs=>({tStartMs,dDurationMs:1000,wWinId:0,segs:[{utf8:'Não.'}]}));
 expect(textoDoJson3({events})).toBe('Não.\nNão.');
});
test('Dado falas sem tempos, Quando converter JSON3, Então não presume duplicação técnica',()=>{
 expect(textoDoJson3({events:[{segs:[{utf8:'Sim.'}]},{segs:[{utf8:'Sim.'}]}]})).toBe('Sim.\nSim.');
});
test('Dado eventos com mesmo texto, Quando muda janela ou duração, Então preserva os eventos distintos',()=>{
 const evento={tStartMs:0,dDurationMs:1000,wWinId:0,segs:[{utf8:'Uma fala.'}]};
 expect(textoDoJson3({events:[evento,{...evento},{...evento,wWinId:1},{...evento,wWinId:1,dDurationMs:2000}]})).toBe('Uma fala.\nUma fala.\nUma fala.');
});
