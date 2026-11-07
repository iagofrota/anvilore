// Preload global para testes do Anvilore
// Suprime janelas e diálogos gráficos no desktop em qualquer execução de teste (local ou CI)
delete process.env.DISPLAY;
delete process.env.WAYLAND_DISPLAY;
process.env.ANVILORE_SEM_DIALOGO = "1";
