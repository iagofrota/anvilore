// Pré-requisito da skill query; a falta dele é aviso, não falha da instalação/travas.
// Comandos conferidos no README oficial do ripgrep e nos catálogos Winget/Homebrew.
export function avisoRg(path: string | undefined): string | undefined {
  if (Bun.which("rg", { PATH: path ?? "" })) return undefined;
  const obter = process.platform === "win32" ? "Windows: winget install BurntSushi.ripgrep.MSVC"
    : process.platform === "darwin" ? "macOS: brew install ripgrep"
    : "Linux: instale o pacote ripgrep pelo gerenciador de pacotes da sua distribuição";
  return `a skill query depende do ripgrep (rg), ausente do PATH. ${obter}. O Anvilore não instala essa ferramenta.`;
}
