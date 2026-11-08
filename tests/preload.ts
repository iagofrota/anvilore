// Preload global para testes do Anvilore
// Suprime janelas e diálogos gráficos no desktop em qualquer execução de teste (local ou CI)
delete process.env.DISPLAY;
delete process.env.WAYLAND_DISPLAY;
process.env.ANVILORE_SEM_DIALOGO = "1";

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isola o estado e a runtime dos testes em diretório temporário próprio (Item C).
// Preserva HOME para testes que dependem de configurações e caminhos sob o usuário.
const testStateBase = mkdtempSync(join(tmpdir(), "anvilore-test-state-"));
process.env.XDG_RUNTIME_DIR = join(testStateBase, "run");
process.env.XDG_STATE_HOME = join(testStateBase, "state");
mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
mkdirSync(process.env.XDG_STATE_HOME, { recursive: true, mode: 0o700 });
