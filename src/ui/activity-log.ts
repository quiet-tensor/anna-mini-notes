/**
 * In-app trace of every Host API call the app makes. It is the visible
 * evidence that notes go through anna.storage.* and summaries through
 * anna.tools.invoke (the harness also records the same envelopes).
 */
export interface ActivityEntry {
  at: Date;
  call: string;
  detail: string;
  ok: boolean;
  ms: number;
}

type Listener = (entries: readonly ActivityEntry[]) => void;

const MAX_ENTRIES = 50;
const entries: ActivityEntry[] = [];
const listeners = new Set<Listener>();

export function onActivity(listener: Listener): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

function push(entry: ActivityEntry): void {
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  for (const l of listeners) l(entries);
}

/** Run a host call, timing it and recording success/failure. */
export async function traced<T>(call: string, detail: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await fn();
    push({ at: new Date(), call, detail, ok: true, ms: Math.round(performance.now() - started) });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    push({ at: new Date(), call, detail: `${detail} → ${msg}`, ok: false, ms: Math.round(performance.now() - started) });
    throw err;
  }
}
