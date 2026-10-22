import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_COPY } from "../apps/local-guest/src/landing-copy.js";
import { GUEST_DEMO_COPY } from "../apps/web-agent/src/guest-content.js";
import { demoDatabase, demoGuestHandler, DEMO_INVITE_CODE, removeDemoDatabase, sendDemoRequest, setCookieOf, withDemoEnvironment } from "./helpers/demo-mode-fixture.js";

const INVITE_FORM = /name="invite"/;

test("AC1: with SHORTLET_DEMO=enabled on staging, a guest session starts from / and from /welcome without an invite code", async () => {
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: true }, async (environment) => {
      const handler = demoGuestHandler(environment);
      try {
        const home = await sendDemoRequest(handler, "/");
        assert.ok(setCookieOf(home), "a session cookie is issued from /");
        assert.doesNotMatch(home.body.toString("utf8"), INVITE_FORM);
        const welcome = await sendDemoRequest(handler, "/welcome");
        assert.equal(welcome.statusCode, 200);
        assert.doesNotMatch(welcome.body.toString("utf8"), INVITE_FORM);
        const start = await sendDemoRequest(handler, "/welcome/start", {
          method: "POST",
          headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded" },
          body: Buffer.from("message=Somewhere+quiet+in+Abuja+for+a+week"),
        });
        assert.ok(setCookieOf(start), "a session cookie is issued from /welcome/start");
        assert.doesNotMatch(start.body.toString("utf8"), INVITE_FORM);
      } finally {
        await handler.close();
      }
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});

test("AC1 failure path: with demo off on staging, / without ?invite= still refuses a session", async () => {
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: false }, async (environment) => {
      const handler = demoGuestHandler(environment, { betaInviteCode: DEMO_INVITE_CODE });
      try {
        const home = await sendDemoRequest(handler, "/");
        assert.match(home.body.toString("utf8"), INVITE_FORM);
        assert.equal(setCookieOf(home), undefined, "no session cookie without the invite");
        const valid = await sendDemoRequest(handler, `/?invite=${DEMO_INVITE_CODE}`);
        assert.ok(setCookieOf(valid), "the correct invite still starts a session");
      } finally {
        await handler.close();
      }
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});

test("AC3: in demo mode, /welcome shows the demo notice and the test-payment copy from the copy modules", async () => {
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: true }, async (environment) => {
      const handler = demoGuestHandler(environment);
      try {
        const body = (await sendDemoRequest(handler, "/welcome")).body.toString("utf8");
        assert.ok(body.includes(LANDING_COPY.demoNotice), "the landing demo notice");
        assert.ok(body.includes(GUEST_DEMO_COPY.testPayments), "the test-payment copy");
      } finally {
        await handler.close();
      }
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});

test("AC3: in demo mode, a guest page carries the demo banner with the copy module text, and its length header matches the body", async () => {
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: true }, async (environment) => {
      const handler = demoGuestHandler(environment);
      try {
        const home = await sendDemoRequest(handler, "/");
        const html = home.body.toString("utf8");
        assert.match(html, /<body[^>]*><div role="note" data-demo-banner/);
        assert.ok(html.includes(GUEST_DEMO_COPY.banner), "the banner text comes from the copy module");
        const length = home.headers.find((header) => header.name.toLowerCase() === "content-length");
        assert.equal(Number(length?.value ?? home.body.length), home.body.length);
      } finally {
        await handler.close();
      }
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});

test("AC3 failure path: with demo off, neither the demo banner nor the test-payment copy appears", async () => {
  const f = demoDatabase();
  try {
    await withDemoEnvironment({ databasePath: f.path, demo: false }, async (environment) => {
      const handler = demoGuestHandler(environment);
      try {
        for (const path of ["/", "/welcome"]) {
          const body = (await sendDemoRequest(handler, path)).body.toString("utf8");
          assert.doesNotMatch(body, /data-demo-banner/, path);
          assert.equal(body.includes(GUEST_DEMO_COPY.testPayments), false, path);
        }
      } finally {
        await handler.close();
      }
    });
  } finally {
    removeDemoDatabase(f.dir);
  }
});
