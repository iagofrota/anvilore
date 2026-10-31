import { baixarPagina } from "../lib/baixar-pagina";
import { alternativaMarkdown, decodificar, extrairTexto, MIN_CARACTERES } from "../lib/extrair-texto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ehYoutube, escolherLegenda, textoDoJson3 } from "../lib/youtube";
import { executarYtDlp, type ExecutarYtDlp } from "../lib/yt-dlp";
import { parseArgs } from "node:util";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { estaEmRaw } from "../lib/caminhos";
import { agoraComOffset, gravarCaptura, montarMd, sha256, validarAssunto, validarSubpasta } from "../lib/raw-captura";
export type Saida = { codigo: 0 | 1 | 2; linhas: string[]; erro?: string };
export type Dependencias = { baixar: typeof baixarPagina; ytDlp: ExecutarYtDlp; agora: () => Date };
export const EXTENSOES_IMAGEM = ["png","jpg","jpeg","gif","webp","heic","heif","bmp","tif","tiff"];
const falha = (codigo: 1 | 2, erro: string): Saida => ({ codigo, linhas: [], erro });
export async function lerForaDeRaw(p: string, raiz: string): Promise<{caminho:string;bytes:Uint8Array}> {
 const caminho = resolve(raiz,p);
 if (estaEmRaw(caminho) || estaEmRaw(await realpath(caminho))) throw new Error("a fonte já está em raw/: use-a diretamente na ingestão");
 return {caminho,bytes:await readFile(caminho)};
}
export async function capturar(args: string[], raiz: string, deps: Partial<Dependencias> = {}): Promise<Saida> {
 let v; let pos;
 try {
  const parsed = parseArgs({args,allowPositionals:true,options:{de:{type:"string"},html:{type:"string"},assunto:{type:"string"},"contexto-de":{type:"string"},"url-de":{type:"string"},subpasta:{type:"string"},metodo:{type:"string"},teste:{type:"boolean"}}});
  v=parsed.values;pos=parsed.positionals;
 } catch { return falha(2,"argumentos inválidos para capturar"); }
 try { if (!(await stat(join(raiz,"raw"))).isDirectory()) throw new Error(); }
 catch { return falha(2,"rode na pasta da wiki: raw/ não existe aqui"); }
 const erro = validarAssunto(v.assunto ?? "") ?? (v.subpasta === undefined ? undefined : validarSubpasta(v.subpasta));
 if(erro) return falha(2,erro);
 const assunto=v.assunto!; const data=(deps.agora ?? (()=>new Date()))();
 const comando=pos[0];let fonte=pos[1];let contexto:string|undefined;
 try {
  if(v["contexto-de"]!==undefined) contexto=new TextDecoder("utf-8",{fatal:true}).decode((await lerForaDeRaw(v["contexto-de"],raiz)).bytes);
  if(v["url-de"]!==undefined) {
   if(!["link","video"].includes(comando ?? "") || pos.length!==1) return falha(2,"use uma URL posicional ou --url-de, nunca os dois juntos");
   fonte=new TextDecoder("utf-8",{fatal:true}).decode((await lerForaDeRaw(v["url-de"],raiz)).bytes).replace(/^[ \r\n]+|[ \r\n]+$/g,"");
   pos=[comando!,fonte];
  }
 } catch(e) {return falha(2,`não foi possível ler a entrada: ${(e as Error).message}`);}

 if(comando === "video" || (comando === "link" && fonte && ehYoutube(fonte))) {
  if(!fonte || pos.length !== 2 || !ehYoutube(fonte))return falha(2,"informe um link de vídeo do YouTube");
  const executar=deps.ytDlp ?? executarYtDlp;
  const pasta=await mkdtemp(join(tmpdir(),"anvilore-legenda-"));
  try {
   const metadados=await executar(["-J","--skip-download","--",fonte]);
   if(metadados.codigo!==0)return falha(1,metadados.codigo===127 ? metadados.saida : "não foi possível consultar as legendas do vídeo");
   const meta=JSON.parse(metadados.saida);const legenda=escolherLegenda(meta);
   if(!legenda)return falha(1,"o vídeo não tem legenda");
   const r=await executar(["--skip-download",legenda.automatica?"--write-auto-subs":"--write-subs","--sub-langs",legenda.idioma,"--sub-format","json3","-o",join(pasta,"%(id)s"),"--",fonte]);
   if(r.codigo!==0)return falha(1,"não foi possível baixar a legenda integral do vídeo");
   const arquivo=(await readdir(pasta)).find(n=>n.endsWith(`.${legenda.idioma}.json3`));
   if(!arquivo)return falha(1,"a legenda integral não foi recebida");
   const texto=textoDoJson3(JSON.parse(await readFile(join(pasta,arquivo),"utf8")));
   if(!texto)return falha(1,"a legenda do vídeo está vazia");
   const bytes=new TextEncoder().encode(texto);
   const md=montarMd({capturado_em:agoraComOffset(data),origem:fonte,tipo:"video",contexto:contexto,sha256:sha256(bytes),metodo:"yt-dlp-json3",titulo:typeof meta.title === "string" ? meta.title : undefined,idioma:legenda.idioma,legenda_automatica:legenda.automatica},bytes);
   return {codigo:0,linhas:await gravarCaptura(raiz,"video",v.subpasta,assunto,[{ext:"md",bytes:md}],data)};
  } catch {return falha(1,"não foi possível capturar a legenda integral do vídeo");}
  finally {await rm(pasta,{recursive:true,force:true});}
 }
 if(comando === "link") {
  if (!fonte || pos.length !== 2 || (v.metodo !== undefined && v.metodo !== "navegador")) return falha(2,"informe o link e um método de captura válido");
  try { if(!["http:","https:"].includes(new URL(fonte).protocol)) return falha(2,"informe um link http ou https"); } catch {return falha(2,"informe um link válido");}
  let corpo:Uint8Array; let html:Uint8Array|undefined; let titulo:string|undefined; let metodo:string;
  if(v.metodo === "navegador") {
   if(!v.de) return falha(2,"informe o arquivo com o texto integral do navegador");
   try {corpo=(await lerForaDeRaw(v.de,raiz)).bytes;html=v.html ? (await lerForaDeRaw(v.html,raiz)).bytes : undefined;}
   catch(e) {return falha(2,(e as Error).message);}
   metodo="navegador";
  } else {
   if(v.de || v.html) return falha(2,"arquivos de navegador exigem --metodo navegador");
   const baixar=deps.baixar ?? baixarPagina;
   try {
    const p=await baixar(fonte,{teste:v.teste});if("motivo" in p)return falha(1,p.motivo);
    if(p.tipo === "text/plain" || p.tipo === "text/markdown") {corpo=new TextEncoder().encode(decodificar(p));metodo="texto-do-site";}
    else {
     html=p.bytes;const textoHtml=decodificar(p);const extraido=extrairTexto(textoHtml,p.urlFinal);titulo=extraido.titulo;
     const alternativa=alternativaMarkdown(textoHtml,p.urlFinal);
     if(alternativa) {
      const a=await baixar(alternativa,{teste:v.teste});if("motivo"in a)return falha(1,a.motivo);
      if(!["text/plain","text/markdown"].includes(a.tipo))return falha(1,"a versão Markdown do site não é um texto integral");
      corpo=new TextEncoder().encode(decodificar(a));metodo="markdown-do-site";
     } else {corpo=new TextEncoder().encode(extraido.markdown);metodo="extracao";}
    }
   } catch {return falha(1,"não foi possível extrair o texto integral da página");}
  }
  if(new TextDecoder().decode(corpo).trim().length < MIN_CARACTERES) return falha(1,"a página parece vazia ou depende de JavaScript");
  const md=montarMd({capturado_em:agoraComOffset(data),origem:fonte,tipo:"site",contexto:contexto,sha256:sha256(html ?? corpo),metodo,titulo},corpo);
  try {return {codigo:0,linhas:await gravarCaptura(raiz,"site",v.subpasta,assunto,[{ext:"md",bytes:md},...(html ? [{ext:"html",bytes:html}] : [])],data)};}
  catch(e){return falha(1,`não foi possível guardar a captura: ${(e as Error).message}`);}
 }
 if(comando!=="nota" && comando!=="arquivo") return falha(2,"tipo de captura desconhecido");
 if ((comando === "nota" && (!v.de || pos.length !== 1)) || (comando === "arquivo" && (!fonte || pos.length !== 2))) return falha(2,"informe a fonte da captura");
 let entrada;
 try { entrada=await lerForaDeRaw(comando === "nota" ? v.de! : fonte!,raiz); }
 catch(e) { return falha(2,(e as Error).message); }
 const ext=extname(entrada.caminho).slice(1).toLowerCase();
 if(comando === "arquivo" && !/^[a-z0-9]+$/.test(ext)) return falha(2,"extensão do arquivo não suportada");
 const tipo=comando === "nota" ? "nota" : EXTENSOES_IMAGEM.includes(ext) ? "imagem" : "arquivo";
 const corpo=comando === "nota" ? entrada.bytes : new TextEncoder().encode(contexto ?? "");
 const md=montarMd({capturado_em:agoraComOffset(data),origem:comando === "nota" ? "chat" : entrada.caminho,tipo,contexto:contexto,sha256:sha256(entrada.bytes)},corpo);
 try {
  const arquivos=[{ext:"md",bytes:md},...(comando === "nota" ? [] : [{ext:ext === "md" ? "original.md" : ext,bytes:entrada.bytes}])];
  return {codigo:0,linhas:await gravarCaptura(raiz,tipo,v.subpasta,assunto,arquivos,data)};
 } catch(e) { return falha(1,`não foi possível guardar a captura: ${(e as Error).message}`); }
}
export async function comandoCapturar(args: string[]): Promise<number> {
 const r=await capturar(args,process.cwd()); for(const l of r.linhas) console.log(l); if(r.erro) console.error(r.erro);return r.codigo;
}
