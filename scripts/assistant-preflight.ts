/**
 * Assistant Preflight Verification
 * Validates TypeScript types, browser client build, vendor Weaver artifacts,
 * assistant protocol tests, offline evals, Weaver demo tests, and an offline
 * assistant HTTP/Weaver E2E check WITHOUT calling live Gemini.
 */
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createBasicWebRuntime } from "@weaver/web";
import type { A2UIServerMessage, A2UIClientActionMessage } from "@weaver/core";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";

console.log("=== 1. Checking TypeScript (tsc --noEmit) ===");
execSync("npm run check", { stdio: "inherit" });
console.log("✓ TypeScript check clean.");

console.log("\n=== 2. Building Local Guest Browser Client ===");
execSync("node apps/local-guest/scripts/build-client.mjs", { stdio: "inherit" });
console.log("✓ Browser client build succeeded.");

console.log("\n=== 3. Verifying Weaver Vendor Artifacts ===");
execSync("npm run verify:weaver", { stdio: "inherit" });
console.log("✓ Weaver vendor verification passed.");

console.log("\n=== 4. Running Assistant Protocol Tests ===");
execSync("npm run test:assistant", { stdio: "inherit" });
console.log("✓ Assistant protocol and eval suites passed.");

console.log("\n=== 5. Running Local Guest Weaver Demo Tests ===");
execSync("npm run test:guest-local", { stdio: "inherit" });
console.log("✓ Local guest Weaver demo tests passed.");

console.log("\n=== 6. Running Offline Assistant HTTP / Weaver E2E Verification ===");
async function runAssistantHttpWeaverE2e() {
  const server = startLocalGuestServer({ conciergeMode: "assistant-offline" });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const threadId = `g-${crypto.randomUUID()}`;

  try {
    // 1. Initial turn: Search via assistant HTTP API
    const turnRes = await fetch(`${base}/api/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, text: "I need a place in Ikoyi for 4 nights for 2 guests" }),
    });
    assert.equal(turnRes.status, 200);
    const turnBody = await turnRes.json() as any;
    assert.equal(turnBody.ok, true);
    assert.ok(turnBody.surfaces && turnBody.surfaces.length > 0);
    const discoverySurface = turnBody.surfaces[0];
    assert.ok(discoverySurface.surfaceId.includes("discovery"));

    // 2. Mount discovery surface in Weaver web runtime
    const window = new Window();
    const runtimeRes = createBasicWebRuntime();
    assert.equal(runtimeRes.ok, true);
    for (const msg of discoverySurface.a2uiMessages as readonly A2UIServerMessage[]) {
      const proc = runtimeRes.value.runtime.process(msg);
      assert.equal(proc.ok, true);
    }
    const mountTarget = window.document.createElement("div") as unknown as Element;
    const mountRes = runtimeRes.value.mount({ surfaceId: discoverySurface.surfaceId, target: mountTarget });
    assert.equal(mountRes.ok, true);
    assert.ok(mountTarget.innerHTML.includes("Luxury 2-Bedroom Apartment in Old Ikoyi"));

    // 3. Propose Request to Book
    const reqTurnRes = await fetch(`${base}/api/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, text: "Request the first one." }),
    });
    const reqBody = await reqTurnRes.json() as any;
    assert.equal(reqBody.ok, true);
    assert.ok(reqBody.surfaces && reqBody.surfaces.length > 0);
    const pendingSurface = reqBody.surfaces[0];
    assert.ok(pendingSurface.surfaceId.includes("pending-action"));

    // 4. Confirm action via Weaver event endpoint with active surface binding
    const pendingAction = server.app.assistantRuntime?.getThread(threadId).taskState.pendingAction;
    assert.ok(pendingAction);
    const eventRes = await fetch(`${base}/api/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        name: "shortlet.assistant.confirm-action",
        surfaceId: pendingSurface.surfaceId,
        sourceComponentId: "preflight-test",
        timestamp: new Date().toISOString(),
        context: {
          actionId: pendingAction.id,
          threadId,
          surfaceId: pendingSurface.surfaceId,
        },
      }),
    });
    const eventBody = await eventRes.json() as any;
    assert.equal(eventBody.ok, true);
    assert.ok(eventBody.messages?.[0]?.includes("accepted your request"));
    assert.ok(eventBody.surfaces?.some((s: any) => s.surfaceId.includes("offer")));

    console.log("✓ Offline Assistant HTTP / Weaver E2E interaction succeeded.");
  } finally {
    await server.close();
  }
}

await runAssistantHttpWeaverE2e();

console.log("\n=======================================================");
console.log("ALL OFFLINE PREFLIGHT GATES PASSED CLEANLY.");
console.log("Live Gemini API smoke intentionally NOT run — reserved for the final human test after all offline gates pass.");
console.log("=======================================================");
