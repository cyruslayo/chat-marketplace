/**
 * Assistant Preflight Verification
 * Validates TypeScript types, offline protocol tests, full 20 offline evals,
 * and Weaver demo test parity WITHOUT calling live Gemini.
 */
import { execSync } from "node:child_process";

console.log("=== 1. Checking TypeScript (tsc --noEmit) ===");
execSync("npm run check", { stdio: "inherit" });
console.log("✓ TypeScript check clean.");

console.log("\n=== 2. Running Assistant Protocol Tests ===");
execSync("node --import tsx --test test/assistant-interactions-protocol.test.ts", { stdio: "inherit" });
console.log("✓ Assistant protocol tests passed.");

console.log("\n=== 3. Running Assistant Offline Eval Suite (20 Scenarios) ===");
execSync("node --import tsx --test test/shortlet-assistant-evals.test.ts", { stdio: "inherit" });
console.log("✓ All 20 offline evals passed.");

console.log("\n=== 4. Running Local Guest Weaver Demo Tests ===");
execSync("node --import tsx --test test/local-guest-weaver-demo.test.ts", { stdio: "inherit" });
console.log("✓ Weaver demo regression tests passed.");

console.log("\n=======================================================");
console.log("ALL OFFLINE PREFLIGHT GATES PASSED CLEANLY.");
console.log("Live Gemini API smoke intentionally NOT run — reserved for the final human test after all offline gates pass.");
console.log("=======================================================");
