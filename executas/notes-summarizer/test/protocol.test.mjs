#!/usr/bin/env node
// Protocol test for the notes-summarizer Executa — a scripted fake host.
//
//   node test/protocol.test.mjs                 # test the source (node src/index.js)
//   node test/protocol.test.mjs --bin <path>    # test a built binary (release smoke test)
//   node test/protocol.test.mjs --describe-only --bin <path>
//
// It speaks line-delimited JSON-RPC 2.0 over the plugin's stdin/stdout exactly
// like the Agent does: initialize → describe → invoke, answers the plugin's
// reverse `sampling/createMessage` from fixtures/sampling.jsonl, and checks
// stdout carries nothing but JSON-RPC frames. Every frame in both directions
// is written to recordings/protocol-transcript.jsonl (repo root) as evidence.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, "..");
const repoRoot = join(pluginDir, "..", "..");
const argv = process.argv.slice(2);
const binIdx = argv.indexOf("--bin");
const bin = binIdx >= 0 ? resolve(argv[binIdx + 1]) : null;
const describeOnly = argv.includes("--describe-only");
const transcriptPath = join(repoRoot, "recordings", "protocol-transcript.jsonl");

const fixture = readFileSync(join(pluginDir, "fixtures", "sampling.jsonl"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => JSON.parse(l))
  .find((e) => e.ns === "sampling" && e.method === "createMessage");

const transcript = [];
const record = (dir, frame) => transcript.push({ t: Date.now(), dir, frame });

/** Spawn the plugin and expose request()/notify()/close() + reverse-RPC hooks. */
function startPlugin({ onReverse }) {
  const [cmd, args] = bin ? [bin, []] : [process.execPath, [join(pluginDir, "src", "index.js")]];
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  const stdoutNoise = [];
  const stderr = [];
  let nextId = 1;

  createInterface({ input: child.stderr }).on("line", (l) => stderr.push(l));
  createInterface({ input: child.stdout }).on("line", async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      stdoutNoise.push(line);
      return;
    }
    record("plugin->host", msg);
    if (typeof msg.method === "string") {
      // Reverse RPC from the plugin (e.g. sampling/createMessage).
      const reply = await onReverse(msg);
      const frame = { jsonrpc: "2.0", id: msg.id, ...reply };
      record("host->plugin", frame);
      child.stdin.write(`${JSON.stringify(frame)}\n`);
      return;
    }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p(msg);
    }
  });

  const send = (frame) => {
    record("host->plugin", frame);
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  };

  return {
    child,
    stderr,
    stdoutNoise,
    request(method, params) {
      const id = nextId++;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), 15_000);
        pending.set(id, (m) => {
          clearTimeout(timer);
          res(m);
        });
        send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    raw(line) {
      record("host->plugin", { raw: line });
      child.stdin.write(`${line}\n`);
    },
    nextResponse() {
      // For frames sent with a null/unknown id (parse errors).
      return new Promise((res) => pending.set(null, res));
    },
    close() {
      return new Promise((res) => {
        child.on("exit", (code, signal) => res({ code, signal }));
        child.stdin.end();
      });
    },
  };
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push([false, name]);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const reverseCalls = [];
let samplingReply = () => ({ result: fixture.result });
const plugin = startPlugin({
  onReverse: async (msg) => {
    reverseCalls.push(msg);
    if (msg.method === "sampling/createMessage") return samplingReply(msg);
    return { error: { code: -32601, message: `fake host: ${msg.method} not supported` } };
  },
});

console.log(`notes-summarizer protocol test — ${bin ? `binary ${bin}` : "source (node src/index.js)"}`);

let manifest;
await step("initialize negotiates v2 and declares sampling", async () => {
  const res = await plugin.request("initialize", {
    protocolVersion: "2.0",
    clientInfo: { name: "protocol-test", version: "1" },
    capabilities: { sampling: { maxTokensPerCall: 8192, maxCallsPerInvoke: 8 } },
  });
  assert.equal(res.result.protocolVersion, "2.0");
  assert.deepEqual(res.result.client_capabilities.sampling, {});
  assert.deepEqual(res.result.capabilities.sampling, {});
});

await step("describe returns the bare manifest", async () => {
  const res = await plugin.request("describe");
  manifest = res.result;
  for (const k of ["name", "display_name", "version", "description", "host_capabilities", "tools", "runtime"]) {
    assert.ok(k in manifest, `manifest.${k} missing`);
  }
  assert.equal(manifest.name, "tool-mini-notes-summarizer");
  assert.deepEqual(manifest.host_capabilities, ["llm.sample"]);
  const tool = manifest.tools.find((t) => t.name === "summarize_notes");
  assert.ok(tool, "summarize_notes tool missing");
  assert.ok(Array.isArray(tool.parameters), "tools[].parameters[] (Executa shape) missing");
  assert.ok(tool.parameters.some((p) => p.name === "notes" && p.type === "array" && p.required === true));
  assert.ok(!("input_schema" in tool), "MCP-style input_schema must not replace parameters[]");
  if (bin) assert.equal(manifest.runtime.type, "binary", "packaged build should report runtime.type=binary");
});

if (!describeOnly) {
  const invokeId = "test-invoke-0001";
  await step("invoke summarize_notes → reverse sampling/createMessage → summary from sampling", async () => {
    const before = reverseCalls.length;
    const res = await plugin.request("invoke", {
      tool: "summarize_notes",
      arguments: {
        notes: [
          { seq: 1, content: "明天跟客户 follow up" },
          { seq: 2, content: "修复登录 bug" },
          { seq: 3, content: "Workshop 内容想法" },
        ],
      },
      context: { invoke_id: invokeId, sampling_token: "fake-token" },
    });
    const sampling = reverseCalls.slice(before).filter((m) => m.method === "sampling/createMessage");
    assert.equal(sampling.length, 1, "expected exactly one sampling/createMessage");
    const req = sampling[0].params;
    assert.equal(req.metadata.executa_invoke_id, invokeId, "metadata must carry invoke_id");
    assert.equal(req.includeContext, "none");
    assert.ok(req.maxTokens > 0);
    const text = req.messages[0].content.text;
    for (const n of ["明天跟客户 follow up", "修复登录 bug", "Workshop 内容想法"]) assert.ok(text.includes(n), `prompt lacks note ${n}`);
    assert.equal(res.result.success, true);
    assert.equal(res.result.data.summary, fixture.result.content.text.trim(), "summary must be the sampling text verbatim");
    assert.equal(res.result.data.sampling.model, fixture.result.model);
    assert.equal(res.result.data.sampling.invoke_id, invokeId);
  });

  await step("host sampling error is propagated with its code", async () => {
    samplingReply = () => ({ error: { code: -32603, message: "harness started with --no-llm" } });
    const res = await plugin.request("invoke", {
      tool: "summarize_notes",
      arguments: { notes: ["a note"] },
      context: { invoke_id: "test-invoke-0002" },
    });
    samplingReply = () => ({ result: fixture.result });
    assert.equal(res.error.code, -32603);
    assert.match(res.error.message, /--no-llm/);
  });

  await step("empty notes → -32602, no sampling issued", async () => {
    const before = reverseCalls.length;
    const res = await plugin.request("invoke", { tool: "summarize_notes", arguments: { notes: [] }, context: { invoke_id: "x" } });
    assert.equal(res.error.code, -32602);
    assert.equal(reverseCalls.length, before);
  });

  await step("unknown tool → -32601", async () => {
    const res = await plugin.request("invoke", { tool: "nope", arguments: {} });
    assert.equal(res.error.code, -32601);
  });

  await step("unknown method → -32601", async () => {
    const res = await plugin.request("does/not/exist");
    assert.equal(res.error.code, -32601);
  });

  await step("malformed line → -32700, process keeps serving", async () => {
    const wait = plugin.nextResponse();
    plugin.raw("{not json");
    const res = await wait;
    assert.equal(res.error.code, -32700);
    const health = await plugin.request("health");
    assert.equal(health.result.status, "ready");
  });
}

await step("stdout carried only JSON-RPC frames", async () => {
  assert.deepEqual(plugin.stdoutNoise, []);
});

await step("exits 0 on stdin EOF", async () => {
  const { code } = await plugin.close();
  assert.equal(code, 0);
});

mkdirSync(dirname(transcriptPath), { recursive: true });
writeFileSync(transcriptPath, transcript.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`\ntranscript (${transcript.length} frames): ${transcriptPath}`);
if (process.env.SHOW_STDERR) console.log(plugin.stderr.join("\n"));

const failed = results.filter(([ok]) => !ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
