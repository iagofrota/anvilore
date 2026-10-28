// Eventos do `claude -p --output-format stream-json --verbose` no formato visto na prova da ponte
// (Claude Code 2.1.311): hooks antes do `init`, `rate_limit_event` no meio, `result` sempre por último.
export const SESSAO = "5f0c1d2e-0000-4000-8000-000000000001";

export function antesDoInit(): unknown[] {
  return [
    { type: "system", subtype: "hook_started", hook_name: "SessionStart:startup", session_id: SESSAO },
    { type: "system", subtype: "hook_response", hook_name: "SessionStart:startup", output: "", session_id: SESSAO },
  ];
}

export function init(extra: Record<string, unknown> = {}): unknown {
  return {
    type: "system", subtype: "init", session_id: SESSAO, cwd: "/tmp/vault", model: "claude-haiku-4-5",
    permissionMode: "dontAsk", apiKeySource: "none", claude_code_version: "2.1.311", tools: ["Read", "Grep", "Glob"], ...extra,
  };
}

export function limite(): unknown {
  return { type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1793300000, rateLimitType: "five_hour" }, session_id: SESSAO };
}

export function usoDeFerramenta(id: string, nome: string, entrada: Record<string, unknown>, texto?: string): unknown {
  return {
    type: "assistant", parent_tool_use_id: null, session_id: SESSAO,
    message: { role: "assistant", content: [...(texto ? [{ type: "text", text: texto }] : []), { type: "tool_use", id, name: nome, input: entrada }] },
  };
}

export function resultadoDeFerramenta(id: string, conteudo: string, erro = false): unknown {
  return {
    type: "user", parent_tool_use_id: null, session_id: SESSAO,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: conteudo, is_error: erro }] },
  };
}

export function textoDoAssistente(texto: string): unknown {
  return { type: "assistant", parent_tool_use_id: null, session_id: SESSAO, message: { role: "assistant", content: [{ type: "text", text: texto }] } };
}

export function resultado(extra: Record<string, unknown> = {}): unknown {
  return {
    type: "result", subtype: "success", is_error: false, num_turns: 2, result: "pronto", session_id: SESSAO,
    total_cost_usd: 0.005, permission_denials: [], terminal_reason: "completed", ...extra,
  };
}
