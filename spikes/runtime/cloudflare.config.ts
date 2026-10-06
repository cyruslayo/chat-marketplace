import { bindings, defineConfig, exports, defineWorker } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({ worker: defineWorker({
  name: "shortlet-runtime-spike",
  compatibilityDate: "2026-09-30",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint,
  exports: { RuntimeProbe: exports.durableObject({ storage: "sqlite" }) },
  env: { PROBE: bindings.durableObject({ worker: "shortlet-runtime-spike", exportName: "RuntimeProbe" }) },
}) });
