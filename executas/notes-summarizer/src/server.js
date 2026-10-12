"use strict";

const { randomUUID } = require("node:crypto");
const { StdioTransport } = require("./transport");
const { SamplingClient } = require("./sampling");
const { buildManifest } = require("./manifest");
const { summarizeNotes } = require("./summarize");
const { TOOL_ID, SUMMARIZE_TOOL, VERSION } = require("./identity");
const { log } = require("./log");

const PROTOCOL_V2 = "2.0";

function createServer(io) {
  const transport = new StdioTransport(io);
  const sampling = new SamplingClient(transport);
  const manifest = buildManifest();
  let protocolVersion = "1.1";
  let shuttingDown = false;

  async function handleInitialize(id, params) {
    const offered = params && params.protocolVersion;
    if (offered === PROTOCOL_V2) {
      protocolVersion = PROTOCOL_V2;
      sampling.enable();
    } else {
      protocolVersion = "1.1";
      sampling.disable(`host offered protocolVersion=${offered || "none"}; sampling requires 2.0`);
    }
    const caps = protocolVersion === PROTOCOL_V2 ? { sampling: {} } : {};
    log("rpc", "initialize", { offered, negotiated: protocolVersion, host: params && params.clientInfo });
    await transport.respond(id, {
      protocolVersion,
      server_info: { name: TOOL_ID, version: VERSION },
      serverInfo: { name: TOOL_ID, version: VERSION },
      // Both spellings are in circulation (docs: `capabilities`, examples:
      // `client_capabilities`); they carry the same subset.
      capabilities: caps,
      client_capabilities: caps,
    });
  }

  async function handleInvoke(id, params) {
    const started = Date.now();
    if (!params || typeof params.tool !== "string") {
      return transport.respondError(id, -32602, "invoke requires params.tool");
    }
    const { tool } = params;
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    const context = (params.context && typeof params.context === "object") ? params.context : {};
    // Hosts inject context.invoke_id (older ones put it at params.invoke_id).
    // When neither is present (e.g. a bare manual test) we mint a local one so
    // the sampling request is still correlatable in logs and metadata.
    const hostInvokeId = context.invoke_id || params.invoke_id;
    const invokeId = hostInvokeId || `local-${randomUUID()}`;

    if (tool !== SUMMARIZE_TOOL) {
      return transport.respondError(id, -32601, `Unknown tool: ${tool}`);
    }
    log("rpc", "invoke", { tool, invoke_id: invokeId, invoke_id_source: hostInvokeId ? "host" : "generated" });
    try {
      const data = await summarizeNotes(args, { invokeId, sampling });
      return transport.respond(id, { success: true, tool, data, duration_ms: Date.now() - started });
    } catch (err) {
      const code = Number.isInteger(err.code) ? err.code : -32603;
      log("rpc", "invoke failed", { tool, invoke_id: invokeId, code, message: err.message });
      // Programmer / host errors travel as JSON-RPC errors so the caller sees
      // the original code (e.g. the harness' -32603 "--no-llm" rejection).
      return transport.respondError(id, code, err.message, { tool, invoke_id: invokeId, ...(err.data ? { host: err.data } : {}) });
    }
  }

  transport.onRequest = async (msg) => {
    const { id, method, params } = msg;
    const isNotification = id === undefined;
    switch (method) {
      case "initialize":
        return handleInitialize(id, params);
      case "describe":
        return transport.respond(id, manifest);
      case "invoke":
        return handleInvoke(id, params);
      case "health":
        return transport.respond(id, {
          status: "ready",
          message: "",
          details: { version: VERSION, protocol: protocolVersion, sampling_state: sampling.state, sampling_calls: sampling.calls },
        });
      case "shutdown":
        shuttingDown = true;
        log("rpc", "shutdown requested");
        await transport.respond(id, { ok: true });
        // Stop reading; run() resolves once in-flight work is flushed.
        transport.stop();
        return undefined;
      default:
        if (isNotification) return undefined;
        return transport.respondError(id, -32601, `Method not found: ${method}`);
    }
  };

  return {
    transport,
    async run() {
      log("lifecycle", "started", { tool_id: TOOL_ID, version: VERSION, pid: process.pid, runtime: manifest.runtime.type });
      await transport.run();
      log("lifecycle", shuttingDown ? "stopped after shutdown" : "stdin closed (EOF), exiting");
    },
  };
}

module.exports = { createServer };
