"use strict";

const { log } = require("./log");

/**
 * Thin client for the reverse `sampling/createMessage` RPC.
 *
 * Negotiation state (set by `initialize`):
 *   "v2"      — host negotiated protocol 2.0 → sampling allowed
 *   "v1"      — host explicitly offered < 2.0 → fail fast with -32008
 *               (SAMPLING_NOT_NEGOTIATED), the code the host itself would use
 *   "unknown" — no `initialize` received. Production Agents and
 *               `anna-app executa dev` always send it; the `anna-app dev` App
 *               harness does not, yet still injects context.invoke_id and
 *               answers reverse RPCs. We attempt the call and let the host
 *               decide (it replies -32008 when sampling is not negotiated).
 */
class SamplingClient {
  constructor(transport) {
    this.transport = transport;
    this.state = "unknown";
    this.disabledReason = null;
    this.calls = 0;
  }

  get negotiated() {
    return this.state === "v2";
  }

  enable() {
    this.state = "v2";
    this.disabledReason = null;
  }

  disable(reason) {
    this.state = "v1";
    this.disabledReason = reason;
  }

  /**
   * @param {object} req  MCP-style sampling params (messages, maxTokens, …)
   * @returns {Promise<{requestId: string, result: object}>}
   */
  async createMessage(req, { timeoutMs = 80_000 } = {}) {
    if (this.state === "v1") {
      const err = new Error(`sampling unavailable: ${this.disabledReason}`);
      err.code = -32008;
      throw err;
    }
    if (this.state === "unknown") {
      log("sampling", "no initialize handshake seen; issuing sampling/createMessage and letting the host decide");
    }
    this.calls += 1;
    const invokeId = req.metadata && req.metadata.executa_invoke_id;
    log("sampling", "-> sampling/createMessage", {
      invoke_id: invokeId,
      messages: req.messages.length,
      maxTokens: req.maxTokens,
    });
    const started = Date.now();
    try {
      const { id, result } = await this.transport.request("sampling/createMessage", req, { timeoutMs });
      log("sampling", "<- sampling/createMessage result", {
        id,
        invoke_id: invokeId,
        model: result && result.model,
        stopReason: result && result.stopReason,
        elapsed_ms: Date.now() - started,
      });
      return { requestId: id, result };
    } catch (err) {
      log("sampling", "<- sampling/createMessage error", {
        invoke_id: invokeId,
        code: err.code,
        message: err.message,
        elapsed_ms: Date.now() - started,
      });
      throw err;
    }
  }
}

module.exports = { SamplingClient };
