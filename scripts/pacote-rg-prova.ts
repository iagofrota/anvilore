import { createHash } from "node:crypto";

// Artefatos e SHA-256 publicados em https://api.github.com/repos/BurntSushi/ripgrep/releases/tags/15.1.0.
// Só para o ensaio do CI: nenhuma dependência/instalação do produto é alterada.
export function pacoteDoRg(sistema: string = process.platform, arch: string = process.arch) {
  const pacotes: Record<string, [string, string]> = {
    "linux/x64": ["x86_64-unknown-linux-musl.tar.gz", "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599"],
    "darwin/arm64": ["aarch64-apple-darwin.tar.gz", "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715"],
    "darwin/x64": ["x86_64-apple-darwin.tar.gz", "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882"],
    "win32/x64": ["x86_64-pc-windows-msvc.zip", "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a"],
  };
  const pacote = pacotes[`${sistema}/${arch}`];
  if (!pacote) throw new Error(`sistema não suportado pelo ensaio: ${sistema}/${arch}`);
  const arquivo = `ripgrep-15.1.0-${pacote[0]}`;
  return { arquivo, pasta: arquivo.replace(/\.(tar\.gz|zip)$/, ""), sha256: pacote[1], url: `https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/${arquivo}` };
}

export function conferirHash(bytes: Uint8Array, esperado: string) {
  if (createHash("sha256").update(bytes).digest("hex") !== esperado) throw new Error("SHA-256 do rg temporário não confere");
}
