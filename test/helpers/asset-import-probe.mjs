// Import-time probe for slice 09a AC1: the handler modules must import successfully without
// reading any file into them at module load. Run as `node test/helpers/asset-import-probe.mjs`
// with an empty working directory; imports resolve from this file's own URL, not the cwd.
import { register } from "tsx/esm/api";
await register();
await Promise.all([
  import(new URL("../../apps/local-guest/src/guest-server.js", import.meta.url).href),
  import(new URL("../../apps/local-owner/src/local-owner-server.js", import.meta.url).href),
]);
console.log("ASSET-IMPORT-OK");
