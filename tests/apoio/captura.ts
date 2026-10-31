import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const dataCaptura = new Date(2026,9,31,12,30);
export async function wikiCaptura() {
 const raiz=await mkdtemp(join(tmpdir(),'wiki-captura-')); await mkdir(join(raiz,'raw'));
 return {raiz, limpar:()=>rm(raiz,{recursive:true,force:true})};
}
export async function lerCaptura(raiz:string,caminho:string) {
 const bytes=await readFile(join(raiz,caminho)); const fim=bytes.indexOf('\n---\n',4)+5;
 return {meta:Bun.YAML.parse(bytes.subarray(4,fim-5).toString()) as Record<string,unknown>, corpo:bytes.subarray(fim)};
}
