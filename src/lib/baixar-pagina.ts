import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export const LIMITE_BYTES = 10 * 1024 * 1024;
export const TEMPO_MS = 30_000;
export const MAX_REDIRECIONAMENTOS = 5;
export type Pagina = { urlFinal: string; status: number; tipo: string; charset?: string; bytes: Uint8Array };
export type FalhaCaptura = { motivo: string };
function normalizarIp(ip: string): string {
 try { return new URL(`http://[${ip.replace(/^\[|\]$/g, "")}]`).hostname.slice(1,-1); } catch { return ip; }
}
function ipv4(ip: string): string {
 const n=normalizarIp(ip);
 const m=/^::ffff:([a-f\d]+):([a-f\d]+)$/i.exec(n);
 if(!m) return n;
 const a=parseInt(m[1]!,16),b=parseInt(m[2]!,16); return `${a>>8}.${a&255}.${b>>8}.${b&255}`;
}
export function enderecoProibido(ip: string): boolean {
 const n=ipv4(ip);
 if(isIP(n)===4) {const [a,b]=n.split('.').map(Number);return a===0 || a===127 || a===10 || (a===172 && b!>=16 && b!<=31) || (a===192 && b===168) || (a===169 && b===254);}
 if(isIP(n)!==6) return true;
 const inicio=parseInt(n.split(':')[0]||'0',16);
 return n==='::' || n==='::1' || (inicio&0xfe00)===0xfc00 || (inicio&0xffc0)===0xfe80;
}
function loopback(ip: string): boolean {const n=ipv4(ip);return n==='::1' || (isIP(n)===4 && n.startsWith('127.'));}
type Opcoes = { teste?: boolean; resolver?: (host:string)=>Promise<string[]>; tempoMs?: number };
export async function baixarPagina(url: string, opcoes: Opcoes): Promise<Pagina | FalhaCaptura> {
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),opcoes.tempoMs ?? TEMPO_MS);
 const resolver=opcoes.resolver ?? (async (host:string)=>(await lookup(host,{all:true})).map(x=>x.address));
 async function executar():Promise<Pagina|FalhaCaptura> {
  let atual=new URL(url);
  for(let salto=0;;salto++) {
   if(controller.signal.aborted) throw new Error('tempo');
   if(!['http:','https:'].includes(atual.protocol)) return {motivo:'a captura aceita apenas links http ou https'};
   const host=atual.hostname.replace(/^\[|\]$/g,'');
   const ips=await resolver(host);
   if(!ips.length || ips.some(ip=>enderecoProibido(ip) && !(opcoes.teste && loopback(ip)))) return {motivo:'o link aponta para um endereço local ou privado'};
   if(controller.signal.aborted) throw new Error('tempo');
   // Há uma janela de DNS rebinding entre esta resolução e a conexão do fetch.
   const resposta=await fetch(atual,{redirect:'manual',signal:controller.signal});
   if([301,302,303,307,308].includes(resposta.status)) {
    await resposta.body?.cancel();
    if(salto>=MAX_REDIRECIONAMENTOS) return {motivo:'a página redirecionou vezes demais'};
    const destino=resposta.headers.get('location');if(!destino) return {motivo:'a página redirecionou sem indicar o destino'};
    atual=new URL(destino,atual);continue;
   }
   if(!resposta.ok) {await resposta.body?.cancel();return {motivo:`a página respondeu com status ${resposta.status}`};}
   const ct=resposta.headers.get('content-type') ?? '';const tipo=ct.split(';')[0]!.trim().toLowerCase();
   if(!['text/html','application/xhtml+xml','text/plain','text/markdown'].includes(tipo)) {await resposta.body?.cancel();return {motivo:'não é uma página de texto'};}
   const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(ct)?.[1];
   const reader=resposta.body?.getReader(); const partes:Uint8Array[]=[];let tamanho=0;
   if(reader) try {
    for(;;) { const {value,done}=await reader.read();if(done)break;tamanho+=value.length;
     if(tamanho>LIMITE_BYTES) {await reader.cancel();return {motivo:'página grande demais; a captura ficaria cortada'};}partes.push(value);
    }
   } finally {reader.releaseLock();}
   const bytes=new Uint8Array(tamanho);let offset=0;for(const parte of partes){bytes.set(parte,offset);offset+=parte.length;}
   return {urlFinal:atual.href,status:resposta.status,tipo,charset,bytes};
  }
 }
 try {
  return await Promise.race([executar(),new Promise<FalhaCaptura>(resolve=>controller.signal.addEventListener('abort',()=>resolve({motivo:'o tempo para baixar a página esgotou'}),{once:true}))]);
 } catch {return {motivo:controller.signal.aborted?'o tempo para baixar a página esgotou':'não foi possível baixar a página'};}
 finally {clearTimeout(timer);}
}
