import { bindings, defineConfig, exports, defineWorker } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export const spikeWorker = defineWorker({
  name: "do-sql-spike",
  compatibilityDate: "2026-09-30",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint,
  exports: { SqlProbe: exports.durableObject({ storage: "sqlite" }) },
  env: { SHORTLET: bindings.durableObject({ worker: "do-sql-spike", exportName: "SqlProbe" }) },
});

export default defineConfig({ worker: spikeWorker });
