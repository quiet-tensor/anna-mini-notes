/**
 * Minimal typing of the parts of the Anna App Runtime this app uses.
 * Every namespace call resolves with the host `result` or rejects with an
 * Error carrying `code` / `details` (see App UI SDK docs).
 */
export interface StorageGetResult<T = unknown> {
  value?: T | null;
  etag?: string | null;
  generation?: number | null;
  exists?: boolean;
}

export interface StorageSetArgs<T = unknown> {
  key: string;
  value: T;
  if_match?: string;
}

export interface ToolsInvokeArgs {
  tool_id: string;
  method?: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
}

export interface AnnaRuntime {
  windowUuid: string;
  appId: string;
  versionId: string;
  capabilities: Record<string, unknown>;
  runtimeState: Record<string, unknown>;
  storage: {
    get<T = unknown>(args: { key: string }): Promise<StorageGetResult<T>>;
    set<T = unknown>(args: StorageSetArgs<T>): Promise<unknown>;
  };
  tools: {
    invoke(args: ToolsInvokeArgs, opts?: Record<string, unknown>): Promise<unknown>;
  };
  window: {
    set_title(args: { title: string }): Promise<unknown>;
  };
  on(event: string, handler: (payload: unknown) => void): () => void;
}

/** Error shape thrown by the runtime for `{ ok: false }` responses. */
export interface AnnaRpcError extends Error {
  code?: string | number;
  details?: unknown;
}
