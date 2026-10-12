// Type shim for the Anna App Runtime SDK. The real module is served by the
// host (production dashboard or the `anna-app dev` harness) at
// /static/anna-apps/_sdk/latest/index.js and is NOT bundled — vite marks it
// external. tsconfig `paths` maps that URL to this file for type checking;
// runtime.ts narrows `connect()` to AnnaRuntime.
export declare const AnnaAppRuntime: {
  connect(): Promise<unknown>;
};
