"use strict";

/**
 * Single source of truth for the tool identity on the Executa side.
 *
 * These values MUST stay identical to:
 *   - manifest.json            → required_executas[].tool_id, ui.host_api.tools
 *   - executa.json             → tool_id
 *   - src/config.ts (frontend) → TOOL_ID, SUMMARIZE_METHOD
 *
 * `npm run check:identity` (scripts/check-identity.mjs) fails the build if
 * any of them drift.
 */
const TOOL_ID = "tool-mini-notes-summarizer";
const SUMMARIZE_TOOL = "summarize_notes";
const VERSION = "0.1.0";

module.exports = { TOOL_ID, SUMMARIZE_TOOL, VERSION };
