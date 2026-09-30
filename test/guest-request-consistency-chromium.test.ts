import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withRequestScreen } from "./helpers/guest-request-screen.js";

for (const state of ["draft", "review", "sent", "declined"] as const) {
  test(`AC1: ${state === "declined" ? "not accepted" : state} renders the same head, ticket, breakdown and actions in the chat workspace and on its conventional page`, async () => {
    await withRequestScreen(state, async (fixture, path) => {
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.setViewport(390, 900);
        await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
        await tab.waitForSelector("#active-workspace .request-screen", 10_000);
        const result = await tab.evaluate<{ chat: (string | null)[]; page: (string | null)[] }>(`(async () => {
          const html = await (await fetch(${JSON.stringify(path)})).text();
          const page = new DOMParser().parseFromString(html, 'text/html');
          const sections = (root) => ['.request-head', '.ui-ticket', '.ui-price-breakdown', '.request-actions', '.ui-steps'].map(selector => root.querySelector(selector)?.outerHTML.replace(/ datetime="[^"]*"/g, '') ?? null);
          return { chat: sections(document.querySelector('#active-workspace')), page: sections(page) };
        })()`);
        assert.ok(result.chat.every(Boolean), "all kit sections render, including the outcome");
        assert.deepEqual(result.chat, result.page);
        if (state === "review") assert.match(await tab.evaluate<string>("document.querySelector('#active-workspace .request-notes').textContent"), /Guests: Named Primary/);
        for (const width of [320, 390, 768, 1280]) {
          await tab.setViewport(width, 900);
          assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `${state} reflows at ${width}`);
        }
      } finally { await browser.close(); }
    }, state === "review" ? { guestName: "Named Primary" } : {});
  });
}

test("AC1: request actions retain visible loading feedback and their original Weaver binding", async () => {
  await withRequestScreen("draft", async (fixture) => {
    const browser = await launchRealBrowser();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector("#active-workspace .request-screen", 10_000);
      await tab.interceptRequests(async (url) => { if (url.includes("/api/event")) await gate; return undefined; });
      assert.equal(await tab.clickButton("Review request"), true);
      await tab.waitForSelector('#active-workspace button[data-loading="true"]', 5_000);
      assert.equal(await tab.evaluate<boolean>("document.querySelector('#active-workspace button[data-loading=\"true\"]').getBoundingClientRect().width >= 44"), true, "loading feedback is on the visible primary control");
      release();
      await tab.waitForText("Submit Booking Request", 10_000);
      assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 0, "review does not submit the request");
    } finally { release(); await browser.close(); }
  });
});

test("AC3: the request-pending chat state shows the neutral banner and steps, and no longer renders .waiting-panel", async () => {
  await withRequestScreen("sent", async (fixture) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector("#active-workspace .request-screen", 10_000);
      assert.equal(await tab.evaluate<number>("document.querySelectorAll('#active-workspace .waiting-panel').length"), 0);
      assert.equal(await tab.evaluate<number>("document.querySelectorAll('#active-workspace .ui-steps li').length"), 3);
      assert.match(await tab.evaluate<string>("document.querySelector('#active-workspace .ui-banner--neutral').textContent"), /Nothing is charged until you accept an offer and pay/);
    } finally { await browser.close(); }
  });
});

test("AC5: without JavaScript, each conventional request page renders fully and its primary action works by form post", async () => {
  for (const state of ["draft", "review", "sent", "declined", "expired"] as const) {
    await withRequestScreen(state, async (fixture, path) => {
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setJavaScriptEnabled(false);
        await tab.setViewport(320, 900);
        // Let Chromium retain a real HttpOnly session cookie for native form navigation and redirects.
        await tab.navigate(`${fixture.base}/`);
        await tab.navigate(`${fixture.base}${path}`);
        const html = await tab.getContent();
        assert.match(html, /request-head/);
        assert.match(html, /ui-ticket/);
        assert.match(html, /ui-price-breakdown/);
        assert.match(html, /ui-steps/);
        const label = state === "draft" ? "Review request" : state === "review" ? "Submit Booking Request" : state === "sent" ? "Back to your conversation" : "Find other stays";
        assert.match(html, /method="post"/);
        assert.equal(await tab.clickButton(label), true);
        await tab.waitForText(state === "draft" ? "Submit Booking Request" : state === "review" ? "Request sent" : state === "sent" ? "Your message" : "Update search", 10_000);
      } finally { await browser.close(); }
    });
  }
});
