export function ehYoutube(url: string): boolean {
 try {
  const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return false;
  if(u.hostname==='youtu.be')return /^\/[^/]+\/?$/.test(u.pathname);
  if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname))return false;
  return (u.pathname==='/watch' && !!u.searchParams.get('v')) || /^\/shorts\/[^/]+\/?$/.test(u.pathname);
 } catch {return false;}
}
export function escolherLegenda(meta: { language?: string; subtitles?: Record<string,unknown>; automatic_captions?: Record<string,unknown> }): {idioma:string;automatica:boolean}|undefined {
 const idiomas=[...new Set([meta.language,'pt','en'].filter((s):s is string=>typeof s==='string' && s.length>0))];
 for(const [legendas,automatica] of [[meta.subtitles,false],[meta.automatic_captions,true]] as const) {
  for(const idioma of idiomas) {
   const encontrado=Object.keys(legendas??{}).find(k=>k===idioma) ?? Object.keys(legendas??{}).sort().find(k=>k.toLowerCase().split('-')[0]===idioma.toLowerCase().split('-')[0]);
   if(encontrado)return {idioma:encontrado,automatica};
  }
 }
}
export function textoDoJson3(json: unknown): string {
 if(!json || typeof json!=='object' || !('events'in json) || !Array.isArray(json.events))return '';
 const linhas:string[]=[];let anterior:string|undefined;
 for(const evento of json.events) {
  if(!evento || !Array.isArray(evento.segs))continue;
  const linha=evento.segs.map((s:unknown)=>s && typeof s==='object' && 'utf8'in s && typeof s.utf8==='string' ? s.utf8 : '').join('').trim();
  if(!linha)continue;
  const tempos=[evento.tStartMs,evento.dDurationMs,evento.wWinId];
  const conhecida=typeof evento.tStartMs==='number' && Number.isFinite(evento.tStartMs)
   && tempos.slice(1).every(v=>v===undefined || (typeof v==='number' && Number.isFinite(v)));
  const assinatura=conhecida ? JSON.stringify([...tempos,linha]) : undefined;
  if(assinatura===undefined || assinatura!==anterior)linhas.push(linha);
  anterior=assinatura;
 }
 return linhas.join('\n');
}
