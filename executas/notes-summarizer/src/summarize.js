"use strict";

const { SUMMARIZE_TOOL } = require("./identity");

const MAX_NOTES = 200;
const MAX_NOTE_CHARS = 2_000;
const DEFAULT_MAX_TOKENS = 400;

const SYSTEM_PROMPT = [
  "You summarize a user's short personal notes.",
  "Write the summary in the same language as the notes.",
  "Start with a one-sentence overview, then list the key themes and any action items as short bullet points.",
  "Only use information contained in the notes. Do not invent tasks, dates or people.",
].join(" ");

/** Raised for bad arguments → surfaced as JSON-RPC -32602. */
class InvalidParams extends Error {
  constructor(message) {
    super(message);
    this.code = -32602;
  }
}

/**
 * Normalise the `notes` argument. Accepts either note objects
 * ({ seq, content, created_at? }) as sent by the app, or plain strings.
 */
function normaliseNotes(raw) {
  if (!Array.isArray(raw)) throw new InvalidParams("`notes` must be an array");
  if (raw.length > MAX_NOTES) throw new InvalidParams(`at most ${MAX_NOTES} notes per call`);
  return raw.map((item, index) => {
    const note = typeof item === "string" ? { content: item } : item;
    if (!note || typeof note.content !== "string") {
      throw new InvalidParams(`notes[${index}].content must be a string`);
    }
    const content = note.content.trim().slice(0, MAX_NOTE_CHARS);
    const seq = Number.isInteger(note.seq) ? note.seq : index + 1;
    return { seq, content };
  }).filter((n) => n.content.length > 0);
}

function buildSamplingRequest(notes, { invokeId, maxTokens }) {
  const listing = notes.map((n) => `#${n.seq}: ${n.content}`).join("\n");
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Here are my ${notes.length} notes, in the order I added them:\n\n` +
            `${listing}\n\n` +
            "Summarize these notes.",
        },
      },
    ],
    systemPrompt: SYSTEM_PROMPT,
    maxTokens,
    temperature: 0.3,
    includeContext: "none",
    metadata: {
      executa_invoke_id: invokeId,
      tool: SUMMARIZE_TOOL,
      note_count: notes.length,
    },
  };
}

/**
 * summarize_notes: the summary text comes exclusively from the host LLM via
 * sampling/createMessage. Nothing here composes summary text locally.
 */
async function summarizeNotes(args, { invokeId, sampling }) {
  const notes = normaliseNotes(args.notes);
  if (notes.length === 0) throw new InvalidParams("`notes` is empty — add at least one note first");

  let maxTokens = DEFAULT_MAX_TOKENS;
  if (args.max_tokens !== undefined) {
    if (!Number.isInteger(args.max_tokens) || args.max_tokens < 16 || args.max_tokens > 8192) {
      throw new InvalidParams("`max_tokens` must be an integer between 16 and 8192");
    }
    maxTokens = args.max_tokens;
  }

  const request = buildSamplingRequest(notes, { invokeId, maxTokens });
  const { requestId, result } = await sampling.createMessage(request);

  const content = result && result.content;
  const summary = content && content.type === "text" && typeof content.text === "string" ? content.text.trim() : "";
  if (!summary) {
    const err = new Error("host sampling returned no text content");
    err.code = -32603;
    throw err;
  }

  return {
    summary,
    note_count: notes.length,
    source: "sampling/createMessage",
    sampling: {
      request_id: requestId,
      invoke_id: invokeId,
      model: result.model || null,
      stop_reason: result.stopReason || null,
      usage: result.usage || null,
    },
  };
}

module.exports = { summarizeNotes, buildSamplingRequest, normaliseNotes, InvalidParams, SYSTEM_PROMPT };
