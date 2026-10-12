/**
 * App-wide constants.
 *
 * TOOL_ID / SUMMARIZE_METHOD must match manifest.json (required_executas,
 * ui.host_api.tools), executas/notes-summarizer/executa.json and the
 * Executa's `describe` manifest. `npm run check:identity` enforces this.
 */
export const TOOL_ID = "tool-mini-notes-summarizer";
export const SUMMARIZE_METHOD = "summarize_notes";

/** Single storage key holding the whole notes document (atomic get/set). */
export const NOTES_STORAGE_KEY = "mini-notes:v1:notes";

/** Notes are "short" — keep each one bounded. */
export const MAX_NOTE_LENGTH = 500;

/** Upper bound for the summarize round-trip (host clamps to 1–90 s). */
export const SUMMARIZE_TIMEOUT_MS = 90_000;
