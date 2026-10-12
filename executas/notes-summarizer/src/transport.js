"use strict";

const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const { log } = require("./log");

/**
 * Line-delimited JSON-RPC 2.0 over stdio, bidirectional.
 *
 * One stdin reader receives two kinds of frames:
 *   - requests from the Agent / harness (have a `method`)  → onRequest()
 *   - responses to OUR reverse RPCs, e.g. sampling/createMessage
 *     (no `method`, only `id` + `result|error`)            → pending map
 *
 * Every outgoing frame is one line on stdout; send() resolves once the write
 * callback fires, i.e. the bytes were flushed to the pipe.
 */
class StdioTransport {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    this.input = input;
    this.output = output;
    this.pending = new Map(); // reverse-RPC id → { resolve, reject, timer, method }
    this.inflight = new Set(); // promises of request handlers still running
    this.onRequest = null;
  }

  /** Write one frame and wait until it is flushed. */
  send(frame) {
    const line = `${JSON.stringify(frame)}\n`;
    return new Promise((resolve, reject) => {
      this.output.write(line, "utf8", (err) => (err ? reject(err) : resolve()));
    });
  }

  respond(id, result) {
    return this.send({ jsonrpc: "2.0", id, result });
  }

  respondError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return this.send({ jsonrpc: "2.0", id: id === undefined ? null : id, error });
  }

  /**
   * Issue a reverse JSON-RPC request to the host and await its response.
   * Rejects with an Error carrying `.code` / `.data` on a JSON-RPC error.
   */
  request(method, params, { timeoutMs = 90_000 } = {}) {
    const id = `rev-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const err = new Error(`reverse RPC ${method} timed out after ${timeoutMs}ms`);
        err.code = -32005;
        reject(err);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ jsonrpc: "2.0", id, method, params }).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    }).then((result) => ({ id, result }));
  }

  handleResponse(msg) {
    const entry = this.pending.get(msg.id);
    if (!entry) {
      log("transport", "unmatched response frame", { id: msg.id });
      return;
    }
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) {
      const err = new Error(msg.error.message || "reverse RPC failed");
      err.code = msg.error.code;
      err.data = msg.error.data;
      entry.reject(err);
    } else {
      entry.resolve(msg.result);
    }
  }

  handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log("transport", "parse error on stdin line", { preview: trimmed.slice(0, 120) });
      this.respondError(null, -32700, "Parse error");
      return;
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      this.respondError(null, -32600, "Invalid Request");
      return;
    }
    if (typeof msg.method !== "string") {
      // No method → this is the host answering one of our reverse RPCs.
      this.handleResponse(msg);
      return;
    }
    // Requests are handled concurrently: an invoke blocked on sampling must
    // not stop the reader from delivering the sampling response.
    const p = Promise.resolve()
      .then(() => this.onRequest(msg))
      .catch((err) => {
        log("transport", "unhandled handler error", { error: String(err && err.stack || err) });
        if (msg.id !== undefined) return this.respondError(msg.id, -32603, `Internal error: ${err.message}`);
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /**
   * Read stdin until EOF. Resolves after EOF once all in-flight handlers
   * have written their responses.
   */
  run() {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: this.input, crlfDelay: Infinity });
      this.rl = rl;
      rl.on("line", (line) => this.handleLine(line));
      rl.on("close", async () => {
        // No more host responses can arrive: fail outstanding reverse RPCs
        // so their invokes can answer, then wait for those answers to flush.
        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer);
          const err = new Error(`stdin closed while waiting for ${entry.method} (${id})`);
          err.code = -32603;
          entry.reject(err);
        }
        this.pending.clear();
        await Promise.allSettled([...this.inflight]);
        resolve();
      });
    });
  }

  /** Stop reading stdin (used by `shutdown`); run() then drains and resolves. */
  stop() {
    if (this.rl) this.rl.close();
  }
}

module.exports = { StdioTransport };
