import { NodeHtmlMarkdown } from "node-html-markdown";
import type { Pagina } from "./baixar-pagina";
export const MIN_CARACTERES = 200;
export function decodificar(p: Pagina): string {
 let charset=p.charset;
 if(!charset && ['text/html','application/xhtml+xml'].includes(p.tipo)) {
  const inicio=new TextDecoder('latin1').decode(p.bytes.subarray(0,4096));
  new HTMLRewriter().on('meta',{element(e){
   if(charset) return;
   charset=e.getAttribute('charset') ?? (e.getAttribute('http-equiv')?.toLowerCase()==='content-type' ? /charset\s*=\s*["']?([^\s;"']+)/i.exec(e.getAttribute('content')??'')?.[1] : undefined);
  }}).transform(inicio);
 }
 return new TextDecoder(charset ?? 'utf-8').decode(p.bytes);
}
export function alternativaMarkdown(html: string, base: string): string | undefined {
 let url:string|undefined;
 new HTMLRewriter().on('link',{element(e){
  if(url || !e.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('alternate') || e.getAttribute('type')?.toLowerCase()!=='text/markdown')return;
  const href=e.getAttribute('href');if(href)try{url=new URL(href,base).href;}catch{}
 }}).transform(html);
 return url;
}
export function extrairTexto(html: string, url: string): { titulo: string; markdown: string } {
 let titulo=''; let markdown='';
 // O tradutor público fornece a árvore já analisada; não depende de DOM do navegador.
 NodeHtmlMarkdown.translate(`<anvilore-captura>${html}</anvilore-captura>`,{}, {'ANVILORE-CAPTURA':({node})=>{
  titulo=node.querySelector('title')?.textContent.trim() ?? node.querySelector('h1')?.textContent.trim() ?? '';
  for(const el of node.querySelectorAll('script,style,nav,header,footer,aside,form,noscript')) el.remove();
  const principal=node.querySelector('article') ?? node.querySelector('main') ?? node.querySelector('[role="main"]') ?? node.querySelector('body') ?? node;
  for(const el of principal.querySelectorAll('a[href],img[src]')) {
   const atributo=el.tagName.toLowerCase()==='a'?'href':'src';const valor=el.getAttribute(atributo);if(valor)try{el.setAttribute(atributo,new URL(valor,url).href);}catch{}
  }
  markdown=NodeHtmlMarkdown.translate(principal.outerHTML,{preferNativeParser:false});
  return {content:'',recurse:false};
 }});
 return {titulo,markdown};
}
