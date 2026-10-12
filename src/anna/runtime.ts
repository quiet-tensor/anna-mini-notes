import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import type { AnnaRpcError, AnnaRuntime } from "./types";

/**
 * Perform the host handshake (window.hello) once and share the instance.
 * Requires the page to be loaded by an Anna host (`anna-app dev` or the
 * production dashboard) — it reads `?wid=…&t=…` from the iframe URL.
 */
let connecting: Promise<AnnaRuntime> | null = null;

export function connectAnna(): Promise<AnnaRuntime> {
  if (!connecting) connecting = AnnaAppRuntime.connect() as Promise<AnnaRuntime>;
  return connecting;
}

/** Render any runtime / JSON-RPC error as "[code] message". */
export function describeError(err: unknown): string {
  const e = err as AnnaRpcError | undefined;
  if (!e) return "unknown error";
  const details = (e.details ?? {}) as Record<string, unknown>;
  // Executa JSON-RPC errors are relayed by the host; prefer the numeric
  // JSON-RPC code when the host passes it through in details.
  const rpcCode = details.code ?? details.rpc_code ?? (details.error as Record<string, unknown> | undefined)?.code;
  const code = rpcCode ?? e.code ?? "error";
  const message = e.message || String(err);
  return message.startsWith(`[${code}]`) ? message : `[${code}] ${message}`;
}
