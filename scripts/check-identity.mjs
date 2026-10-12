#!/usr/bin/env node
// Fails if the tool identity drifts between the places that must agree:
//   manifest.json required_executas[].tool_id + ui.host_api.tools
//   executas/notes-summarizer/executa.json tool_id (+ package.json bin key)
//   src/config.ts TOOL_ID / SUMMARIZE_METHOD           (frontend constants)
//   the Executa's live `describe` manifest: name + tools[].name
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const executaDir = join(root, "executas", "notes-summarizer");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const manifest = readJson("manifest.json");
const executa = readJson("executas/notes-summarizer/executa.json");
const executaPkg = readJson("executas/notes-summarizer/package.json");
const configTs = readFileSync(join(root, "src", "config.ts"), "utf8");
const constant = (name) => configTs.match(new RegExp(`export const ${name} = "([^"]+)"`))?.[1];

function describe() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(executaDir, "src", "index.js")], { stdio: ["pipe", "pipe", "ignore"] });
    const rl = createInterface({ input: child.stdout });
    rl.once("line", (line) => {
      child.stdin.end();
      try {
        resolve(JSON.parse(line).result);
      } catch (e) {
        reject(e);
      }
    });
    child.on("error", reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "describe" })}\n`);
  });
}

const described = await describe();
const expected = executa.tool_id;
const method = constant("SUMMARIZE_METHOD");

const checks = [
  ["manifest.required_executas[0].tool_id", manifest.required_executas?.[0]?.tool_id, expected],
  ["manifest.ui.host_api.tools", manifest.ui?.host_api?.tools?.[0], `required:${expected}`],
  ["executas/notes-summarizer/package.json bin key", Object.keys(executaPkg.bin ?? {})[0], expected],
  ["src/config.ts TOOL_ID", constant("TOOL_ID"), expected],
  ["describe().name", described?.name, expected],
  ["describe().tools[] contains SUMMARIZE_METHOD", described?.tools?.some((t) => t.name === method) ? method : undefined, method],
  ["describe().host_capabilities", JSON.stringify(described?.host_capabilities), JSON.stringify(["llm.sample"])],
];

let failed = 0;
for (const [label, actual, want] of checks) {
  const ok = actual === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${actual}${ok ? "" : `  (expected ${want})`}`);
}
if (failed) {
  console.error(`\n${failed} identity check(s) failed`);
  process.exit(1);
}
console.log(`\ntool identity consistent: ${expected} / ${method}`);
