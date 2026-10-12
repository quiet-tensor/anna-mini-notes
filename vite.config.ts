import { defineConfig } from "vite";

/** Served by the Anna host at runtime — never bundled. */
const ANNA_SDK_URL = "/static/anna-apps/_sdk/latest/index.js";

export default defineConfig({
  // Relative asset URLs: the host serves the bundle under
  // /anna-apps/<slug>/<version>/ (or /anna-apps/<slug>/dev/ in the harness).
  base: "./",
  build: {
    // manifest.json → ui.bundle.entry = "index.html" inside this directory;
    // `anna-app dev` / `validate` read ./bundle by default.
    outDir: "bundle",
    emptyOutDir: true,
    target: "es2020",
    // Keep identifiers readable: `anna-app validate --strict` greps the built
    // bundle for `anna.<ns>.<method>(` calls to check them against host_api.
    minify: false,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      external: [ANNA_SDK_URL],
    },
  },
});
