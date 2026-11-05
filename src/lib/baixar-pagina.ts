import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export const LIMITE_BYTES = 10 * 1024 * 1024;
export const TEMPO_MS = 30_000;
export const MAX_REDIRECIONAMENTOS = 5;
export type Pagina = { urlFinal: string; status: number; tipo: string; charset?: string; bytes: Uint8Array };
export type FalhaCaptura = { motivo: string };
function parseIpv6(ip: string): number[] | null {
 try {
  const n = new URL(`http://[${ip.replace(/^\[|\]$/g, "")}]`).hostname.slice(1, -1);
  const partes = n.split("::");
  if (partes.length > 2) return null;
  const antes = partes[0] ? partes[0].split(":").map(h => parseInt(h, 16)) : [];
  const depois = partes.length === 2 && partes[1] ? partes[1].split(":").map(h => parseInt(h, 16)) : [];
  const faltam = 8 - (antes.length + depois.length);
  if (faltam < 0) return null;
  return [...antes, ...Array(faltam).fill(0), ...depois];
 } catch { return null; }
}
function ipv4Proibido(ip: string): boolean {
 if (isIP(ip) !== 4) return true;
 const [a, b, c, d] = ip.split('.').map(Number);
 if (a === undefined || b === undefined || c === undefined || d === undefined) return true;
 if (a === 0 || a === 10 || a === 127) return true;
 if (a === 100 && b >= 64 && b <= 127) return true;
 if (a === 169 && b === 254) return true;
 if (a === 172 && b >= 16 && b <= 31) return true;
 if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
 if (a === 192 && b === 88 && c === 99) return true;
 if (a === 192 && b === 168) return true;
 if (a === 198 && (b === 18 || b === 19)) return true;
 if (a === 198 && b === 51 && c === 100) return true;
 if (a === 203 && b === 0 && c === 113) return true;
 if (a >= 224) return true;
 return false;
}
function extrairIpv4(ip: string, h: number[] | null): string | null {
 if (isIP(ip) === 4) return ip;
 if (!h) return null;
 if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
  return `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
 }
 if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
  return `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
 }
 if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
  return `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
 }
 if (h[0] === 0x2002) {
  return `${h[1]! >> 8}.${h[1]! & 255}.${h[2]! >> 8}.${h[2]! & 255}`;
 }
 return null;
}
export function enderecoProibido(ip: string): boolean {
 const h = parseIpv6(ip);
 const v4 = extrairIpv4(ip, h);
 if (v4) return ipv4Proibido(v4);
 if (!h) return true;
 if (h.every(x => x === 0)) return true;
 if (h.slice(0, 7).every(x => x === 0) && h[7] === 1) return true;
 if ((h[0]! & 0xfe00) === 0xfc00) return true;
 if ((h[0]! & 0xffc0) === 0xfe80) return true;
 if ((h[0]! & 0xffc0) === 0xfec0) return true;
 if ((h[0]! & 0xff00) === 0xff00) return true;
 if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true;
 if (h[0] === 0x2001 && h[1] === 0) return true;
 if (h[0] === 0x2001 && h[1] === 0xdb8) return true;
 if (h[0] === 0x2001 && ((h[1]! & 0xfff0) === 0x10 || (h[1]! & 0xfff0) === 0x20)) return true;
 if (h[0] === 0x100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;
 return false;
}
function loopback(ip: string): boolean {
 const h = parseIpv6(ip);
 const v4 = extrairIpv4(ip, h);
 if (v4) return v4.startsWith("127.");
 if (!h) return false;
 return h.slice(0, 7).every(x => x === 0) && h[7] === 1;
}
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
