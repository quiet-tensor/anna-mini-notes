import { SUMMARIZE_METHOD, SUMMARIZE_TIMEOUT_MS, TOOL_ID } from "../config";
import type { AnnaRuntime } from "../anna/types";
import type { Note } from "../notes/model";
import { traced } from "../ui/activity-log";

export interface SummaryResult {
  summary: string;
  model: string | null;
  noteCount: number;
  invokeId: string | null;
  samplingRequestId: string | null;
}

interface ToolData {
  summary?: unknown;
  note_count?: unknown;
  sampling?: { model?: unknown; invoke_id?: unknown; request_id?: unknown };
}

/**
 * The host may hand back the tool's `data` directly, or wrapped in the
 * Executa InvokeResult ({ success, data }) and/or an outer { result }.
 */
function unwrapToolData(raw: unknown): ToolData {
  let cur = raw as Record<string, unknown> | null;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    if (typeof cur.summary === "string") return cur as ToolData;
    if (cur.success === false) throw new Error(String(cur.error ?? "tool reported failure"));
    cur = (cur.data ?? cur.result ?? null) as Record<string, unknown> | null;
  }
  throw new Error("tool response did not contain a summary");
}

/**
 * Ask the bundled Executa to summarize. The Executa asks the host LLM via
 * reverse sampling/createMessage — this function never produces summary
 * text itself; it only relays what the tool returned.
 */
export async function summarizeNotes(anna: AnnaRuntime, notes: readonly Note[]): Promise<SummaryResult> {
  const args = {
    notes: notes.map((n) => ({ seq: n.seq, content: n.content, created_at: n.createdAt })),
  };
  const raw = await traced("anna.tools.invoke", `${TOOL_ID} · ${SUMMARIZE_METHOD} (${notes.length} notes)`, () =>
    anna.tools.invoke({ tool_id: TOOL_ID, method: SUMMARIZE_METHOD, args, timeoutMs: SUMMARIZE_TIMEOUT_MS }),
  );
  const data = unwrapToolData(raw);
  return {
    summary: String(data.summary).trim(),
    model: typeof data.sampling?.model === "string" ? data.sampling.model : null,
    noteCount: typeof data.note_count === "number" ? data.note_count : notes.length,
    invokeId: typeof data.sampling?.invoke_id === "string" ? data.sampling.invoke_id : null,
    samplingRequestId: typeof data.sampling?.request_id === "string" ? data.sampling.request_id : null,
  };
}
