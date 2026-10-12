#!/usr/bin/env node
"use strict";

const { createServer } = require("./server");
const { log } = require("./log");

const server = createServer();

process.on("SIGTERM", () => {
  log("lifecycle", "SIGTERM received, exiting");
  process.exit(0);
});

server.run().then(
  () => process.exit(0),
  (err) => {
    log("lifecycle", "fatal", { error: String(err && err.stack || err) });
    process.exit(1);
  },
);
