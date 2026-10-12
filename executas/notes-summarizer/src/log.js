"use strict";

/**
 * stderr-only logger. stdout is reserved for JSON-RPC frames — nothing in
 * this plugin may call console.log / process.stdout.write except
 * transport.js.
 */
function log(scope, message, extra) {
  const ts = new Date().toISOString();
  const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  process.stderr.write(`${ts} [notes-summarizer] [${scope}] ${message}${suffix}\n`);
}

module.exports = { log };
