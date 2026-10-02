import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";

test("AC1: the live offer renders the same banner, ticket, breakdown, policies card and action in chat and on its conventional page", async () => {
  await withStagePage(
    { label: "Offer", stage: "offer" },
    async ({ fixture, path }) => {
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.setViewport(390, 900);
        await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
        await tab.waitForSelector("#active-workspace .offer-screen", 10_000);
        const parity = await tab.evaluate<{
          chat: (string | null)[];
          page: (string | null)[];
        }>(`(async () => {
        const page = new DOMParser().parseFromString(await (await fetch(${JSON.stringify(path)})).text(), 'text/html');
        const sections = root => ['.offer-head', '.offer-deadline', '.ui-ticket', '.ui-price-breakdown', '.offer-policies', '.offer-actions', '.ui-steps'].map(selector => root.querySelector(selector)?.outerHTML.replace(/ datetime="[^"]*"/g, '') ?? null);
        return { chat: sections(document.querySelector('#active-workspace')), page: sections(page) };
      })()`);
        assert.ok(parity.chat.every(Boolean));
        assert.deepEqual(parity.chat, parity.page);
        await mkdir(".scratch/guest-ui-consistency/screenshots/08", {
          recursive: true,
        });
        await writeFile(
          ".scratch/guest-ui-consistency/screenshots/08/chat-live.png",
          await tab.captureScreenshot(),
        );
        for (const width of [320, 390, 768, 1280]) {
          await tab.setViewport(width, 900);
          assert.equal(
            await tab.evaluate<boolean>(
              "document.documentElement.scrollWidth <= innerWidth",
            ),
            true,
          );
        }
        assert.equal(await tab.clickButton("Accept and pay"), true);
        await tab.waitForText("Payment required", 10_000);
      } finally {
        await browser.close();
      }
    },
  );
});

test("AC2: the conventional offer countdown updates and reloads authoritative expiry without manual navigation", async () => {
  await withStagePage(
    { label: "Offer", stage: "offer" },
    async ({ fixture, path }) => {
      fixture.setTime("2026-09-03T10:19:59Z");
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.navigate(`${fixture.base}${path}`);
        await tab.waitForText("1 minute left", 10_000);
        fixture.setTime("2026-09-03T10:20:00Z");
        await tab.waitForSelector(
          '.offer-screen[data-offer-state="expired"]',
          10_000,
        );
        assert.equal(await tab.clickButton("Accept and pay"), false);
      } finally {
        await browser.close();
      }
    },
  );
});

test("AC2: chat deadline expiry disables acceptance during a failed authoritative refresh and retries to the expired screen", async () => {
  await withStagePage(
    { label: "Offer", stage: "offer" },
    async ({ fixture }) => {
      fixture.setTime("2026-09-03T10:19:58Z");
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
        await tab.waitForSelector("#active-workspace .offer-screen", 10_000);
        let failures = 0;
        const restore = await tab.interceptRequests(async (url) => {
          if (new URL(url).pathname === "/api/state" && failures++ === 0)
            return {
              status: 503,
              headers: [{ name: "Content-Type", value: "application/json" }],
              body: new TextEncoder().encode('{"ok":false}'),
            };
          return undefined;
        });
        fixture.setTime("2026-09-03T10:20:00Z");
        await tab.waitForFunction(
          "document.querySelector('#active-workspace .offer-actions button')?.disabled === true",
          10_000,
        );
        assert.equal(
          await tab.evaluate<boolean>(
            "[...document.querySelectorAll('#active-workspace [data-a2ui-component=Column] button')].every(button => button.disabled)",
          ),
          true,
        );
        await tab.waitForSelector(
          '#active-workspace .offer-screen[data-offer-state="expired"]',
          15_000,
        );
        assert.ok(failures >= 2, "failed refresh is retried");
        assert.equal(await tab.clickButton("Accept and pay"), false);
        await restore();
      } finally {
        await browser.close();
      }
    },
  );
});

test("AC4: offers render no waiting-panel or info box and the live banner uses ui-banner--warning", async () => {
  await withStagePage(
    { label: "Offer", stage: "offer" },
    async ({ fixture }) => {
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
        await tab.waitForSelector("#active-workspace .offer-screen", 10_000);
        assert.equal(
          await tab.evaluate<number>(
            "document.querySelectorAll('#active-workspace .waiting-panel, #active-workspace .ui-banner--info').length",
          ),
          0,
        );
        assert.equal(
          await tab.evaluate<number>(
            "document.querySelectorAll('#active-workspace .offer-deadline.ui-banner--warning').length",
          ),
          1,
        );
        assert.equal(
          await tab.evaluate<number>(
            "document.querySelectorAll('#active-workspace .ui-steps li').length",
          ),
          3,
        );
        // A fixture clock refresh updates the authoritative state, not client expiry inference.
        fixture.setTime("2026-09-03T10:20:00Z");
        await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
        await tab.waitForSelector(
          '#active-workspace .offer-screen[data-offer-state="expired"]',
          10_000,
        );
        assert.equal(
          await tab.evaluate<number>(
            "document.querySelectorAll('#active-workspace .waiting-panel').length",
          ),
          0,
        );
      } finally {
        await browser.close();
      }
    },
  );
});

test("AC5: without JavaScript the offer accept form works and the expired page renders", async () => {
  for (const expired of [false, true])
    await withStagePage(
      { label: "Offer", stage: "offer" },
      async ({ fixture, path }) => {
        if (expired) fixture.setTime("2026-09-03T10:20:00Z");
        const browser = await launchRealBrowser();
        try {
          const tab = await browser.createTab();
          await tab.setJavaScriptEnabled(false);
          await tab.setViewport(320, 900);
          await tab.navigate(fixture.base);
          await tab.navigate(`${fixture.base}${path}`);
          assert.match(await tab.getContent(), /offer-screen/);
          if (expired) {
            assert.match(
              await tab.getContent(),
              /Conditional Booking Offer expired/,
            );
            assert.equal(await tab.clickButton("Find other stays"), true);
            await tab.waitForText("Update search", 10_000);
          } else {
            assert.equal(await tab.clickButton("Accept and pay"), true);
            await tab.waitForText("Payment required", 10_000);
            assert.match(await tab.getContent(), /How would you like to pay\?/);
          }
        } finally {
          await browser.close();
        }
      },
    );
});
