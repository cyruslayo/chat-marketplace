import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { ASSISTANT_CONTROL_COPY } from "../../apps/local-guest/src/assistant/control-copy.js";
import { ModelQuotaGuardClient } from "../../apps/local-guest/src/assistant/model-quota-guard.js";
import { SqliteModelRequestQuota } from "../../packages/platform-core/src/model-request-quota.js";
import { GUEST_ASSISTANT_COPY } from "../../apps/web-agent/src/guest-content.js";

const state = process.argv[2] ?? "results";
assert.ok(["results", "details", "draft", "redirect", "unavailable", "quota", "support"].includes(state), "Choose one supported capture state");
await test(`AC7: ${state} guest captures preserve reflow and 44px controls at 320, 390, 768, and 1280 pixels`, async () => {
const run = process.env.CONTROLS_CAPTURE_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");
const directory = join(".scratch/guest-ui-consistency/screenshots/concierge-controls-05", run, state);
mkdirSync(directory, { recursive: true });
let unavailable = false;
let transportStarts = 0;
const scripted = new ScriptedAssistantModel([(request) => {
  const last = request.history.at(-1);
  if (last?.role === "tool_results") {
    const kinds: Readonly<Record<string, string>> = { search_stays: "show_results", get_unit_details: "show_details", prepare_request_draft: "propose_action" };
    return { text: JSON.stringify({ kind: kinds[last.results[0]?.name ?? ""] ?? "show_status", references: last.results.filter((result) => !result.isError).map((result) => result.name) }) };
  }
  if (last?.role === "user" && last.text === "Show me the first one") return { toolCalls: [{ id: "capture-details", name: "get_unit_details", args: { stayRef: "stay-1" } }] };
  if (last?.role === "user" && last.text === "I am locked out of my stay and need support.") return { text: JSON.stringify({ kind: "support_guidance", references: [] }) };
  if (last?.role === "user" && last.text === "Prepare a Request Draft") return { toolCalls: [{ id: "capture-draft", name: "prepare_request_draft", args: { stayRef: "stay-1", nights: 4, guests: 2 } }] };
  return null;
}]);
const transport: AssistantModelClient = { supportsProviderAttemptReservation: true, generate: async (request) => {
  await request.beforeProviderAttempt?.();
  transportStarts++;
  if (unavailable) throw new Error("Synthetic guard outage");
  const input = request.history.at(-1);
  if (request.structuredOutput?.name === "concierge_scope" && input?.role === "user" && input.text.includes("locked out")) {
    return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["support"], reasonCode: "supported",
      slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } }) };
  }
  return scripted.generate(request);
} };
let guard: ModelQuotaGuardClient | undefined;
const model: AssistantModelClient = { generate: (request) => {
  assert.ok(guard, "Initialize the persistent quota authority before fixture turns");
  return guard.generate(request);
} };
const fixture = await restartFixture({}, { conciergeMode: "assistant-offline", modelClient: model });
const identity = { tenantId: fixture.environment.config.tenantId, guestId: fixture.environment.guestPrincipal().id };
const quota = new SqliteModelRequestQuota(fixture.environment.database, { dailyTenantLimit: 100, hourlyGuestLimit: 100 });
guard = new ModelQuotaGuardClient(transport, quota, identity);
let browser: Awaited<ReturnType<typeof launchRealBrowser>> | undefined;
try {
  browser = await launchRealBrowser();
  const search = await fixture.send("/api/turn", { text: "I need a place in Ikoyi for 4 nights for 2 guests" });
  assert.equal(search.ok, true);
  assert.equal(search.ok ? search.surfaces.length : 0, 1);
  if (state === "details" || state === "draft") {
    const details = await fixture.send("/api/turn", { text: "Show me the first one" });
    assert.equal(details.ok, true);
    assert.match(details.ok ? details.surfaces[0]?.surfaceId ?? "" : "", /:unit:/);
  }
  if (state === "draft") {
    const draft = await fixture.send("/api/turn", { text: "Prepare a Request Draft" });
    assert.equal(draft.ok, true);
    assert.match(draft.ok ? draft.surfaces[0]?.surfaceId ?? "" : "", /:request:draft:/);
  }
  if (state === "quota") {
    let exhausted = false;
    for (let attempt = 0; attempt <= 100; attempt++) {
      const reservation = await quota.reserve(identity);
      if (!reservation.reserved) { exhausted = true; break; }
    }
    assert.ok(exhausted, "The real local quota authority must refuse before capture");
  }
  const tab = await browser.createTab();
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  const findings: unknown[] = [];
  for (const width of [320, 390, 768, 1280]) {
    for (const theme of ["light", "dark"]) {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector("#composer-input", 15_000);
      await tab.waitForFunction("document.readyState === 'complete' && !document.querySelector('#active-workspace')?.hidden", 15_000);
      await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      if (state === "redirect" || state === "unavailable" || state === "quota" || state === "support") {
        const startsBefore = transportStarts;
        unavailable = state === "unavailable";
        const prompt = state === "redirect" ? "Write a poem about stars" : state === "support" ? "I am locked out of my stay and need support." : "Please check my stay";
        await tab.evaluate(`(() => { const input = document.querySelector('#composer-input'); input.value = ${JSON.stringify(prompt)}; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#composer').requestSubmit(); })()`);
        await tab.waitForText(state === "redirect" ? ASSISTANT_CONTROL_COPY.redirect : state === "support" ? GUEST_ASSISTANT_COPY.activeStayEmergencySupport : ASSISTANT_CONTROL_COPY.unavailable, 15_000);
        if (state === "quota") assert.equal(transportStarts, startsBefore, "Quota refusal cannot start model transport");
      }
      const height = await tab.evaluate<number>("Math.max(900, document.documentElement.scrollHeight)");
      await size(Math.min(2400, height));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const result = await tab.evaluate<{ width: number; overflow: number; smallTargets: { tag: string; width: number; height: number }[] }>(`(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, smallTargets: [...document.querySelectorAll('#main-content button, #main-content a, #main-content input, #composer button, #composer input')].filter(el => !el.hidden && !el.disabled && el.getAttribute('type') !== 'hidden' && !['radio', 'checkbox'].includes(el.getAttribute('type')) && el.getClientRects().length && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0).map(el => ({ tag: el.tagName, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })).filter(rect => rect.width < 44 || rect.height < 44) }))()`);
      findings.push({ state, theme, viewport: width, ...result });
      writeFileSync(join(directory, `${theme}-${width}.png`), await tab.captureScreenshot());
      assert.equal(result.width, width);
      assert.ok(result.overflow <= 0, `${state}/${theme}/${width}: horizontal overflow`);
      assert.deepEqual(result.smallTargets, [], `${state}/${theme}/${width}: controls below 44px`);
      process.stdout.write(`${state}/${theme}/${width}: reflow and targets pass\n`);
      unavailable = false;
    }
  }
  writeFileSync(join(directory, "findings.json"), JSON.stringify({ model: "offline scripted fixture", quotaAuthority: "local SQLite", transportStarts, findings }, null, 2));
  await tab.close();
} finally {
  await browser?.close();
  await fixture.close();
}
});
