"use strict";

const { TOOL_ID, SUMMARIZE_TOOL, VERSION } = require("./identity");

function isSeaBinary() {
  try {
    return require("node:sea").isSea();
  } catch {
    return false;
  }
}

/** Bare manifest returned by `describe` (Anna Executa protocol shape). */
function buildManifest() {
  return {
    name: TOOL_ID,
    display_name: "Mini Notes Summarizer",
    version: VERSION,
    description:
      "Summarizes the notes of the Mini Notes Anna App by asking the host LLM " +
      "through reverse sampling/createMessage. Ships no API key and never composes summaries locally.",
    author: "Mini Notes",
    license: "MIT",
    icon: "📝",
    category: "productivity",
    host_capabilities: ["llm.sample"],
    tools: [
      {
        name: SUMMARIZE_TOOL,
        description:
          "Summarize the user's notes (in the order they were added) into a short overview " +
          "plus key themes and action items, using the host LLM.",
        timeout: 90,
        parameters: [
          {
            name: "notes",
            type: "array",
            items: { type: "object" },
            description:
              "Notes to summarize, oldest first. Each item is { seq: integer, content: string, created_at?: string }; plain strings are accepted too.",
            required: true,
          },
          {
            name: "max_tokens",
            type: "integer",
            description: "Upper bound for the summary length in tokens (16-8192).",
            required: false,
            default: 400,
          },
        ],
      },
    ],
    runtime: {
      type: isSeaBinary() ? "binary" : "node",
      engine: `node ${process.version}`,
      protocol: "2.0",
    },
  };
}

module.exports = { buildManifest };
