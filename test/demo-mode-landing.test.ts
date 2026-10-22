import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_COPY } from "../apps/local-guest/src/landing-copy.js";
import { GUEST_DEMO_COPY } from "../apps/web-agent/src/guest-content.js";
import { demoDatabase, demoGuestHandler, removeDemoDatabase, sendDemoRequest, withDemoEnvironment } from "./helpers/demo-mode-fixture.js";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("AC3: in demo mode, /welcome shows the demo notice and the test-payment copy once, with no second banner", async () => {
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: true }, async (environment) => {
      const handler = demoGuestHandler(environment);
      try {
        const body = (await sendDemoRequest(handler, "/welcome")).body.toString("utf8");
        assert.equal(count(body, LANDING_COPY.demoNotice), 1, "the landing demo notice appears once");
        assert.equal(count(body, GUEST_DEMO_COPY.testPayments), 1, "the test-payment copy appears once");
        assert.doesNotMatch(body, /data-demo-banner/, "the landing page does not repeat the notice in a banner");
        const chat = (await sendDemoRequest(handler, "/")).body.toString("utf8");
        assert.equal(count(chat, "data-demo-banner"), 1, "the chat page keeps its one demo banner");
      } finally {
        await handler.close();
      }
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});
