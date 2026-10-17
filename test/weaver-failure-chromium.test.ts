import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { SHORTLET_DISCOVERY_CATALOG_ID } from "../apps/web-agent/src/shortlet-catalogs.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";

test("AC20 — A controlled Weaver rendering failure preserves a safe conventional fallback in real Chromium", async () => {
  const directory = mkdtempSync(join(tmpdir(), "weaver-failure-"));
  const server = startLocalGuestServer({ port: 0, environment: LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") }) });
  const browser = await launchRealBrowser();
  const tab = await browser.createTab();
  let stopIntercept: (() => Promise<void>) | undefined;
  try {
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    await tab.navigate(`${base}/`);
    const threadId = await tab.evaluate<string>("sessionStorage.getItem('shortlet-concierge-thread') || ''");
    assert.match(threadId, /^g-/);
    stopIntercept = await tab.interceptRequests(async (url) => {
      if (!url.includes(`/api/state?threadId=${encodeURIComponent(threadId)}`)) return undefined;
      const body = JSON.stringify({
        ok: true,
        threadId,
        timeline: [{ role: "assistant", text: "A rich workspace is available." }],
        surfaces: [{
          surfaceId: `thread-${threadId}:faulty`,
          mode: "focused-surface",
          status: "active",
          summary: "Broken rich workspace",
          textFallback: "Safe fallback for the current workspace.",
          conventionalRoute: "/stays/search",
          // The approved catalogue is known, but its component is not in the
          // Basic-equivalent schema cached by this client version.
          a2uiMessages: [
            { version: "v0.9.1", createSurface: { surfaceId: `thread-${threadId}:faulty`, catalogId: SHORTLET_DISCOVERY_CATALOG_ID } },
            { version: "v0.9.1", updateComponents: { surfaceId: `thread-${threadId}:faulty`, components: [{ id: "root", component: "StayCard", title: "Unsupported rich surface" }] } },
          ],
        }],
      });
      return {
        status: 200,
        headers: [{ name: "Content-Type", value: "application/json" }],
        body: new TextEncoder().encode(body),
      };
    });
    await tab.navigate(`${base}/?threadId=${encodeURIComponent(threadId)}`);
    await tab.waitForText("Safe fallback for the current workspace", 15000);
    assert.equal(await tab.evaluate<string>("document.querySelector('#active-workspace .weaver-mount')?.dataset.renderer || ''"), "fallback");
    assert.equal(await tab.evaluate<boolean>("Boolean(document.querySelector('#active-workspace a[href=\"/stays/search\"]'))"), true);
    const telemetryDeadline = Date.now() + 5000;
    while (!server.environment.telemetry.events().some((event) => event.type === "interaction.weaver-rendering-failure") && Date.now() < telemetryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(server.environment.telemetry.events().some((event) => event.type === "interaction.weaver-rendering-failure"));
    assert.equal(server.environment.interactionStore.listBookingRequestIds().length, 0, "presentation failure does not create booking state");
  } finally {
    await stopIntercept?.();
    await tab.close();
    await browser.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
