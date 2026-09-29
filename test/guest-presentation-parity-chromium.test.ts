import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withStagePage, type StagePageSpec } from "./helpers/guest-stage-pages.js";

/** The kit sections of the page in the chat workspace and on its standalone page, with per-request attributes removed. */
const KIT_SECTIONS = `(async (pagePath) => {
  const normalise = (element) => element === null ? null : element.outerHTML.replace(/ datetime="[^"]*"/g, "").replace(/>\\s+</g, "><").trim();
  const html = await (await fetch(pagePath)).text();
  const page = new DOMParser().parseFromString(html, "text/html");
  const chat = document.querySelector("#active-workspace");
  return {
    chatTicket: normalise(chat.querySelector(".ui-ticket")), pageTicket: normalise(page.querySelector(".ui-ticket")),
    chatBreakdown: normalise(chat.querySelector(".ui-price-breakdown")), pageBreakdown: normalise(page.querySelector(".ui-price-breakdown")),
  };
})`;

const PARITY_STAGES: readonly StagePageSpec[] = [
  { label: "request review", stage: "review" },
  { label: "offer", stage: "offer" },
  { label: "payment", stage: "payment-ready" },
  { label: "confirmed", stage: "confirmed" },
];

test("AC3: the workspace's organized ticket and price breakdown match the conventional page's, in structure and text, for review, offer, payment and confirmed", async () => {
  for (const spec of PARITY_STAGES) {
    await withStagePage(spec, async ({ fixture, path, threadId }) => {
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setViewport(390, 900);
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.navigate(`${fixture.base}/?threadId=${threadId}`);
        await tab.waitForSelector("#active-workspace .ui-ticket", 15_000);
        await tab.waitForSelector("#active-workspace .ui-price-breakdown", 5_000);
        const sections = await tab.evaluate<{ chatTicket: string | null; pageTicket: string | null; chatBreakdown: string | null; pageBreakdown: string | null }>(`${KIT_SECTIONS}(${JSON.stringify(path)})`);
        assert.ok(sections.pageTicket && sections.pageBreakdown, `${spec.label}: the page has both sections`);
        assert.equal(sections.chatTicket, sections.pageTicket, `${spec.label}: ticket`);
        assert.equal(sections.chatBreakdown, sections.pageBreakdown, `${spec.label}: breakdown`);
        // The same classes in the same order, not just similar text.
        assert.match(sections.chatTicket!, /^<section class="ui-ticket" aria-label="Your stay">.*ui-ticket__dates.*ui-ticket__foot/);
      } finally { await browser.close(); }
    });
  }
});

test("AC4: when a builder omits a fact, the organizer builds nothing partial, the Weaver output stays visible, and no error is thrown", async () => {
  await withStagePage({ label: "request review", stage: "review" }, async ({ fixture, threadId }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setViewport(390, 900);
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      // The server projection reaches the page without its Check-out fact (an older or partial surface).
      await tab.interceptRequests(async (url) => {
        if (!url.includes("/api/state")) return undefined;
        const response = await fetch(`${fixture.base}/api/state?threadId=${threadId}`, { headers: { cookie: fixture.cookie } });
        const state = await response.json() as { surfaces: { a2uiMessages: { updateComponents?: { components: { id: string; children?: string[] }[] } }[] }[] };
        for (const surface of state.surfaces) for (const message of surface.a2uiMessages) {
          const components = message.updateComponents?.components;
          if (!components) continue;
          message.updateComponents!.components = components.filter((component) => component.id !== "draft-check-out").map((component) => component.children ? { ...component, children: component.children.filter((id) => id !== "draft-check-out") } : component);
        }
        return { status: 200, headers: [{ name: "content-type", value: "application/json" }], body: new TextEncoder().encode(JSON.stringify(state)) };
      });
      await tab.navigate(`${fixture.base}/?threadId=${threadId}`);
      await tab.waitForSelector('#active-workspace .weaver-mount[data-renderer="weaver"]', 15_000);
      await tab.waitForSelector("#active-workspace .ui-price-breakdown", 5_000);
      assert.equal(await tab.evaluate<number>("document.querySelectorAll('#active-workspace .ui-ticket').length"), 0, "no half-built ticket");
      const text = await tab.evaluate<string>("document.querySelector('#active-workspace .weaver-mount').textContent");
      assert.ok(text.includes("Check-in: Thu, 10 Sept 2026") && text.includes("Stay: 3 nights · 2 guests"), "the remaining facts stay readable as Weaver rendered them");
      assert.equal(await tab.evaluate<string>("document.getElementById('active-workspace').dataset.status"), "active", "the surface did not fall back or fail");
      assert.equal(await tab.evaluate<boolean>("document.getElementById('error-announcer').textContent === ''"), true, "no error was announced");
    } finally { await browser.close(); }
  });
});
