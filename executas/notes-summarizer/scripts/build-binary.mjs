#!/usr/bin/env node
// Build the notes-summarizer Executa as a native single-file binary for THIS
// machine and package it per the Anna binary-distribution layout.
//
//   node scripts/build-binary.mjs            # build + archive + smoke test
//   node scripts/build-binary.mjs --no-test  # skip the protocol smoke test
//
// Toolchain: esbuild bundles src/ into one CommonJS file, Node's Single
// Executable Application (SEA) support turns it into a blob, and postject
// injects the blob into a copy of the running `node` binary. The result has
// no runtime dependency on an installed Node.js. SEA can only target the OS /
// CPU of the node binary doing the build, so the platform key is detected
// from the host; CI builds each platform on its own runner.
//
// Output (dist/):
//   tool-mini-notes-summarizer-<version>-<platform>.tar.gz   (macOS / Linux)
//   tool-mini-notes-summarizer-<version>-<platform>.zip      (Windows)
//   …plus a .sha256 file next to each archive.
//
// Archive layout (archive root):
//   manifest.json                         ← name / version / runtime.binary
//   bin/tool-mini-notes-summarizer[.exe]  ← entrypoint, mode 0755
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTarGz, createZip } from "./archive.mjs";

const require = createRequire(import.meta.url);
const pluginDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const { TOOL_ID, VERSION } = require(join(pluginDir, "src", "identity.js"));
const runTest = !process.argv.includes("--no-test");

const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/** Anna platform key for the host: "{os}-{arch}" (x64/amd64 → x86_64). */
export function platformKey(platform = process.platform, arch = process.arch) {
  const os = { darwin: "darwin", linux: "linux", win32: "windows" }[platform];
  if (!os) throw new Error(`unsupported OS: ${platform}`);
  const cpu = {
    x64: "x86_64",
    arm64: os === "linux" ? "aarch64" : "arm64",
    arm: "armv7l",
  }[arch];
  if (!cpu) throw new Error(`unsupported CPU: ${arch}`);
  return `${os}-${cpu}`;
}

const step = (n, msg) => console.log(`[${n}/6] ${msg}`);

async function main() {
  const key = platformKey();
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const exeName = `${TOOL_ID}${isWin ? ".exe" : ""}`;
  const buildDir = join(pluginDir, ".build");
  const stageDir = join(buildDir, "stage");
  const distDir = join(pluginDir, "dist");
  const archiveExt = isWin ? "zip" : "tar.gz";
  const archiveName = `${TOOL_ID}-${VERSION}-${key}.${archiveExt}`;

  console.log(`Executa binary build: ${TOOL_ID} v${VERSION}`);
  console.log(`  platform key ${key}   node ${process.version}   format ${archiveExt}\n`);

  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(join(stageDir, "bin"), { recursive: true });
  mkdirSync(distDir, { recursive: true });

  step(1, "bundling src/ with esbuild");
  const esbuild = require("esbuild");
  const bundlePath = join(buildDir, "executa.cjs");
  await esbuild.build({
    entryPoints: [join(pluginDir, "src", "index.js")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    legalComments: "none",
    logLevel: "warning",
  });

  step(2, "generating SEA blob");
  const blobPath = join(buildDir, "sea-prep.blob");
  const seaConfig = join(buildDir, "sea-config.json");
  writeFileSync(
    seaConfig,
    JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, useCodeCache: false }, null, 2),
  );
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

  step(3, `injecting blob into a copy of ${process.execPath}`);
  const exePath = join(stageDir, "bin", exeName);
  copyFileSync(process.execPath, exePath);
  chmodSync(exePath, 0o755);
  if (isMac) execFileSync("codesign", ["--remove-signature", exePath], { stdio: "inherit" });
  const { inject } = require("postject");
  await inject(exePath, "NODE_SEA_BLOB", readFileSync(blobPath), {
    sentinelFuse: SEA_FUSE,
    ...(isMac ? { machoSegmentName: "NODE_SEA" } : {}),
  });
  // macOS arm64 refuses to run unsigned binaries: re-sign ad hoc.
  if (isMac) execFileSync("codesign", ["--sign", "-", "--force", exePath], { stdio: "inherit" });

  step(4, "writing archive-root manifest.json");
  const entrypoint = `bin/${TOOL_ID}`;
  const archiveManifest = {
    name: TOOL_ID,
    version: VERSION,
    executable_name: TOOL_ID,
    description: "Mini Notes Summarizer Executa (single-file Node SEA binary).",
    runtime: {
      binary: {
        entrypoint: {
          default: entrypoint,
          "windows-x86_64": `${entrypoint}.exe`,
          "windows-arm64": `${entrypoint}.exe`,
        },
        permissions: {
          [isWin ? `${entrypoint}.exe` : entrypoint]: "0o755",
        },
      },
    },
    build: { platform: key, node: process.version, built_at: new Date().toISOString() },
  };
  writeFileSync(join(stageDir, "manifest.json"), `${JSON.stringify(archiveManifest, null, 2)}\n`);

  if (runTest) {
    step(5, "smoke-testing the binary over JSON-RPC stdio");
    const res = spawnSync(process.execPath, [join(pluginDir, "test", "protocol.test.mjs"), "--bin", exePath], {
      stdio: "inherit",
    });
    if (res.status !== 0) throw new Error("protocol smoke test failed against the built binary");
  } else {
    step(5, "smoke test skipped (--no-test)");
  }

  step(6, `packaging dist/${archiveName}`);
  const entries = [
    { name: "manifest.json", data: readFileSync(join(stageDir, "manifest.json")), mode: 0o644 },
    { name: `bin/${exeName}`, data: readFileSync(exePath), mode: 0o755 },
  ];
  const archive = isWin ? createZip(entries) : createTarGz(entries);
  const archivePath = join(distDir, archiveName);
  writeFileSync(archivePath, archive);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  writeFileSync(`${archivePath}.sha256`, `${sha256}  ${archiveName}\n`);

  console.log(`\n✓ ${archivePath}`);
  console.log(`  size    ${(archive.length / 1024 / 1024).toFixed(1)} MiB`);
  console.log(`  sha256  ${sha256}`);
  console.log("  entries");
  for (const e of entries) console.log(`    ${e.mode.toString(8).padStart(4, "0")}  ${e.name}  (${e.data.length} bytes)`);

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `archive=${archivePath}\nplatform=${key}\nsha256=${sha256}\n`, { flag: "a" });
  }
}

main().catch((err) => {
  console.error(`\n✗ build failed: ${err.message}`);
  process.exit(1);
});
