import { expect,test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { alternativaMarkdown,decodificar,extrairTexto } from '../src/lib/extrair-texto';
const fixture=(nome:string)=>readFile(join(import.meta.dir,'fixtures/captura',nome));
test('Dado artigo, Quando extrair, Então mantém título, parágrafos, tabela e código sem navegação',async()=>{
 const html=(await fixture('artigo.html')).toString();const r=extrairTexto(html,'https://exemplo.com/artigo');
 expect(r.titulo).toBe('Artigo completo');for(const t of ['# Conhecimento preservado','Primeiro parágrafo','Segundo parágrafo','| Item','Integral','```ts','const prova','https://exemplo.com/referencia'])expect(r.markdown).toContain(t);
 for(const t of ['MENU DESCARTÁVEL','RODAPÉ','SEGREDO_SCRIPT','INVISIVEL','LATERAL','FORMULÁRIO','SEM JS'])expect(r.markdown).not.toContain(t);
 expect(extrairTexto(html,'https://exemplo.com/artigo')).toEqual(r);
});
test('Dado charset em header ou meta, Quando decodificar, Então preserva acentos',async()=>{
 for(const [nome,charset]of [['latin1.html','ISO-8859-1'],['meta-charset.html',undefined]]) expect(decodificar({bytes:await fixture(nome!),charset,tipo:'text/html',status:200,urlFinal:'https://e.test'})).toContain('ação');
 expect(decodificar({bytes:Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><p>ação</p>','latin1'),tipo:'text/html',status:200,urlFinal:'https://e.test'})).toContain('ação');
});
test('Dado alternate markdown relativo, Quando procurar, Então resolve URL',()=>{
 expect(alternativaMarkdown('<link href="./artigo.md" type="text/markdown" rel="alternate">','https://e.test/pagina')).toBe('https://e.test/artigo.md');
 expect(alternativaMarkdown('<p>sem alternativa</p>','https://e.test')).toBeUndefined();
});
for(const html of ['<main><p>principal</p></main>','<div role="main">principal</div>','<body>principal</body>','<p>principal</p>'])test(`Dado fallback ${html}, Quando extrair, Então mantém conteúdo`,()=>expect(extrairTexto(html,'https://e.test').markdown).toContain('principal'));
test('Dado header dentro do artigo, Quando extrair corpo longo, Então preserva título, resumo, autoria e data',async()=>{
 const html=(await fixture('cabecalho-artigo.html')).toString();const r=extrairTexto(html,'https://e.test/artigo');
 for(const trecho of ['# Título dentro do artigo','Resumo introdutório que faz parte da fonte.','Autoria: Ana Exemplo','Publicado em 31/10/2026','O corpo tem informação suficiente']) expect(r.markdown).toContain(trecho);
 for(const trecho of ['CABEÇALHO DO SITE','MENU GLOBAL','RODAPÉ DO SITE']) expect(r.markdown).not.toContain(trecho);
});
