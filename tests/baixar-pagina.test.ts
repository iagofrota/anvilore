import { afterEach, expect, test } from 'bun:test';
import { baixarPagina, enderecoProibido, LIMITE_BYTES } from '../src/lib/baixar-pagina';
const servidores:ReturnType<typeof Bun.serve>[]=[];
function servir(fetch:(r:Request)=>Response|Promise<Response>){const s=Bun.serve({port:0,hostname:'127.0.0.1',fetch});servidores.push(s);return `http://127.0.0.1:${s.port}`;}
afterEach(()=>{for(const s of servidores.splice(0)) s.stop(true);});
test('Dado esquemas não HTTP, Quando baixar, Então recusa',async()=>{for(const u of ['file:///etc/passwd','ftp://exemplo.com','data:text/plain,a','javascript:alert(1)','inválida']) expect(await baixarPagina(u,{})).toHaveProperty('motivo');});
test('Dado IPs, Quando validar, Então recusa todas as faixas internas e mapeadas',()=>{
 for(const ip of ['127.2.3.4','10.4.5.6','172.16.0.1','172.31.255.255','192.168.1.2','169.254.1.2','0.4.5.6','::','::1','fc00::1','fdff::1','fe80::1','febf::1','::ffff:127.0.0.1','::ffff:7f00:1']) expect(enderecoProibido(ip)).toBe(true);
 for(const ip of ['8.8.8.8','2001:4860::8888','172.32.0.1','192.169.0.1']) expect(enderecoProibido(ip)).toBe(false);
});
test('Dado loopback, Quando baixar sem teste, Então recusa e não conecta',async()=>{const u=servir(()=>{throw new Error('não deve conectar');});expect(await baixarPagina(u,{})).toHaveProperty('motivo');});
test('Dado servidor local e teste explícito, Quando baixar, Então retorna bytes e charset',async()=>{
 const u=servir(()=>new Response('ação',{headers:{'Content-Type':'text/html; charset=UTF-8'}}));const p=await baixarPagina(u,{teste:true});expect(p).toMatchObject({status:200,tipo:'text/html',charset:'UTF-8',urlFinal:u+'/'});if('bytes'in p)expect(new TextDecoder().decode(p.bytes)).toBe('ação');
});
test('Dado redirect privado mesmo em teste, Quando resolver, Então recusa',async()=>{
 const u=servir(()=>Response.redirect('http://interno.exemplo/a',302));const p=await baixarPagina(u,{teste:true,resolver:async h=>h==='127.0.0.1'?['127.0.0.1']:['8.8.8.8','10.0.0.5']});expect(p).toHaveProperty('motivo');
});
test('Dado mais de cinco redirects, Quando baixar, Então recusa',async()=>{const u=servir(r=>Response.redirect(new URL('/'+(Number(new URL(r.url).pathname.slice(1)||0)+1),r.url).href,302));expect(await baixarPagina(u,{teste:true})).toHaveProperty('motivo');});
for(const status of [404,500]) test(`Dado HTTP ${status}, Quando baixar, Então informa status`,async()=>{const u=servir(()=>new Response('erro',{status}));const p=await baixarPagina(u,{teste:true});expect('motivo'in p&&p.motivo).toContain(String(status));});
for(const tipo of ['application/pdf','image/png']) test(`Dado ${tipo}, Quando baixar, Então recusa binário`,async()=>{const u=servir(()=>new Response('binário',{headers:{'content-type':tipo}}));expect(await baixarPagina(u,{teste:true})).toEqual({motivo:'não é uma página de texto'});});
test('Dado corpo acima de 10MB, Quando baixar, Então cancela sem truncar',async()=>{const u=servir(()=>new Response('x'.repeat(LIMITE_BYTES+1),{headers:{'content-type':'text/plain'}}));expect(await baixarPagina(u,{teste:true})).toEqual({motivo:'página grande demais; a captura ficaria cortada'});});
test('Dado servidor sem resposta, Quando esgotar tempo, Então recusa',async()=>{const u=servir(()=>new Promise(()=>{}));const p=await baixarPagina(u,{teste:true,tempoMs:30});expect('motivo'in p&&p.motivo).toContain('tempo');});
