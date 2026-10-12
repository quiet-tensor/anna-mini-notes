#!/usr/bin/env node
// `npm run executa:mock` — one-shot backend sampling test, no Anna account:
//
//   anna-app executa dev --dir executas/notes-summarizer \
//     --mock-sampling executas/notes-summarizer/fixtures/sampling.jsonl \
//     --invoke summarize_notes --args '<three sample notes>'
//
// Wrapped in a script only so the JSON args survive cmd.exe / PowerShell /
// bash quoting identically. Extra CLI flags are passed through (e.g. --json).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "@anna-ai", "cli", "dist", "cli.js");
const notes = [
  { seq: 1, content: "明天跟客户 follow up" },
  { seq: 2, content: "修复登录 bug" },
  { seq: 3, content: "Workshop 内容想法" },
];

const args = [
  cli,
  "executa",
  "dev",
  "--dir",
  join(root, "executas", "notes-summarizer"),
  "--mock-sampling",
  join(root, "executas", "notes-summarizer", "fixtures", "sampling.jsonl"),
  "--invoke",
  "summarize_notes",
  "--args",
  JSON.stringify({ notes }),
  ...process.argv.slice(2),
];

const res = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(res.status ?? 1);
