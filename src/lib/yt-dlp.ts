export type ExecutarYtDlp = (args: string[]) => Promise<{ codigo: number; saida: string }>;
export function avisoYtDlp(path: string | undefined): string | undefined {
 if(Bun.which('yt-dlp',{PATH:path ?? ''}))return;
 const instalar=process.platform==='win32'?'winget install yt-dlp':process.platform==='darwin'?'brew install yt-dlp':'pipx install yt-dlp ou o pacote da distribuição';
 return `para capturar vídeos do YouTube, falta o yt-dlp (${instalar}).`;
}
export const executarYtDlp: ExecutarYtDlp = async args => {
 const bin=Bun.which('yt-dlp');if(!bin)return {codigo:127,saida:avisoYtDlp('')!};
 try {
  const p=Bun.spawn([bin,...args],{stdout:'pipe',stderr:'pipe'});
  const [saida,erro,codigo]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  return {codigo,saida:codigo===0 ? saida : erro};
 } catch {return {codigo:1,saida:'não foi possível executar o yt-dlp'};}
};
