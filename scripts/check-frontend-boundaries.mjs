#!/usr/bin/env node
// Enforces the brief's frontend rules on the source AND the built bundle:
//   - no direct LLM calls (anna.llm.* — summaries must go through the Executa)
//   - no self-hosted HTTP (fetch / XMLHttpRequest / WebSocket / EventSource)
//   - no browser-side persistence (localStorage / sessionStorage / indexedDB)
//   - the only Host API calls are anna.storage.get/set, anna.tools.invoke,
//     anna.window.set_title
//
// manifest.json declares ui.host_api.llm = ["complete"] solely because the
// `anna-app dev` harness executes an Executa's reverse sampling/createMessage
// through the App's llm.complete route (see README §5); this check proves
// the iframe itself never uses that grant.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [join(root, "src"), join(root, "bundle")].filter(existsSync);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|js|mjs|html)$/.test(name) && !name.endsWith(".d.ts") ? [p] : [];
  });
}

/** Drop comments and string/template literal contents so prose doesn't match. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/<!--[\s\S]*?-->/g, "");
}

const FORBIDDEN = [
  [/\banna\s*\.\s*llm\b/, "direct anna.llm.* call"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bnew\s+WebSocket\b/, "WebSocket"],
  [/\bnew\s+EventSource\b/, "EventSource"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\bindexedDB\b/, "indexedDB"],
];
const ALLOWED_HOST_CALLS = new Set(["storage.get", "storage.set", "tools.invoke", "window.set_title"]);
const HOST_CALL = /\banna\s*\.\s*([a-z]+)\s*\.\s*([A-Za-z_]\w*)\s*\(/g;

let problems = 0;
const seen = new Set();
for (const file of targets.flatMap(walk)) {
  const rel = relative(root, file);
  const raw = readFileSync(file, "utf8");
  const code = file.endsWith(".html") ? raw.replace(/<code>[\s\S]*?<\/code>/g, "") : codeOnly(raw);
  for (const [re, label] of FORBIDDEN) {
    if (re.test(code)) {
      problems++;
      console.log(`FAIL ${rel}: ${label}`);
    }
  }
  for (const m of code.matchAll(HOST_CALL)) {
    const call = `${m[1]}.${m[2]}`;
    seen.add(call);
    if (!ALLOWED_HOST_CALLS.has(call)) {
      problems++;
      console.log(`FAIL ${rel}: unexpected Host API call anna.${call}`);
    }
  }
}

if (!targets.some((t) => t.endsWith("bundle"))) console.log("note: bundle/ not built yet — checked src/ only");
console.log(`Host API calls found: ${[...seen].sort().map((c) => `anna.${c}`).join(", ") || "(none)"}`);
if (problems) {
  console.error(`\n${problems} frontend boundary violation(s)`);
  process.exit(1);
}
console.log("ok   frontend uses only anna.storage.get/set + anna.tools.invoke (+ window.set_title); no anna.llm, fetch or browser storage");
