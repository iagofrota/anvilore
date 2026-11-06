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

test('Dado tabela de endereços de uso especial da IANA e públicos comuns, Quando verificar enderecoProibido, Então bloqueia cada faixa especial e libera públicos', () => {
 const bloqueados = [
  '0.0.0.0', '0.4.5.6',
  '10.0.0.1', '10.255.255.254',
  '100.64.0.1', '100.100.100.200', '100.127.255.254',
  '127.0.0.1', '127.2.3.4',
  '169.254.1.2', '169.254.169.254',
  '172.16.0.1', '172.31.255.255',
  '192.0.0.1', '192.0.0.170', '192.0.2.1',
  '192.88.99.1',
  '192.168.0.1', '192.168.1.2',
  '198.18.0.1', '198.19.255.254',
  '198.51.100.1', '203.0.113.1',
  '224.0.0.1', '239.255.255.255',
  '240.0.0.1', '255.255.255.255',
  '::', '::1',
  '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:a00:1',
  '::10.0.0.1', '::a00:1', '::127.0.0.1',
  '64:ff9b::10.0.0.1', '64:ff9b::a00:1', '64:ff9b::127.0.0.1',
  '64:ff9b:1::1', '64:ff9b:1::ffff',
  '2002:a00:1::', '2002:7f00:1::', '2002:a9fe:a9fe::',
  '2001::1', '2001::1234',
  '2001:2::1', '2001:3::1',
  '2001:0:4136:e378:8000:63bf:f5ff:fffe',
  '2001:db8::1',
  '2001:20::1',
  '100::1',
  '3fff::1',
  '5f00::1',
  'fc00::1', 'fdff::1',
  'fe80::1', 'febf::1',
  'fec0::1', 'feff::1',
  'ff00::1', 'ff02::1',
  '::ffff:0:127.0.0.1', '::ffff:0:10.0.0.1', '::ffff:0:100.64.0.1'
 ];
 for (const ip of bloqueados) {
  expect(enderecoProibido(ip)).toBe(true);
 }

 const liberados = [
  '1.1.1.1', '8.8.8.8', '9.9.9.9',
  '100.128.0.1', '172.32.0.1', '192.169.0.1', '198.20.0.1',
  '2001:4860:4860::8888', '2606:4700:4700::1111', '2a00:1450:4001:828::200e',
  '64:ff9b::8.8.8.8', '64:ff9b::808:808',
  '2002:808:808::', '2002:101:101::',
  '::ffff:8.8.8.8', '::ffff:0:8.8.8.8', '::8.8.8.8'
 ];
 for (const ip of liberados) {
  expect(enderecoProibido(ip)).toBe(false);
 }
 expect(enderecoProibido('invalido')).toBe(true);
});

test('Dado resolução DNS para faixas internas especiais, Quando baixarPagina executa, Então recusa a conexão', async () => {
 for (const ip of ['100.100.100.200', '64:ff9b::a00:1', '2002:a00:1::', 'invalido']) {
  const p = await baixarPagina('http://exemplo.invalid/teste', { resolver: async () => [ip] });
  expect(p).toEqual({ motivo: 'o link aponta para um endereço local ou privado' });
 }
 const pInvalido = await baixarPagina('http://exemplo.invalid/teste', { teste: true, resolver: async () => ['invalido'] });
 expect(pInvalido).toEqual({ motivo: 'o link aponta para um endereço local ou privado' });
});
test('Dado loopback, Quando baixar sem teste, Então recusa e não conecta',async()=>{const u=servir(()=>{throw new Error('não deve conectar');});expect(await baixarPagina(u,{})).toHaveProperty('motivo');});
test('Dado IPv6 loopback ::1 com teste explícito, Quando baixarPagina resolve para ::1, Então não recusa por endereço local', async () => {
 const p = await baixarPagina('http://[::1]:9999/teste', { teste: true, tempoMs: 50, resolver: async () => ['::1'] });
 if ('motivo' in p) expect(p.motivo).not.toBe('o link aponta para um endereço local ou privado');
});
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
