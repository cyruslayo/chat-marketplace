import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { PARTNERS_DEMO_STEPS } from "../apps/local-guest/src/partners-copy.js";
import {
  launchRealBrowser,
  type RealBrowserTab,
} from "./helpers/chrome-devtools.js";

// Landing issue 17: the founding partners page in a real Chrome. Synthetic applicant only.
async function withPage(
  width: number,
  run: (
    tab: RealBrowserTab,
    base: string,
    environment: LocalGuestEnvironment,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "partners-browser-"));
  const environment = LocalGuestEnvironment.openNode({
    databasePath: join(directory, "guest.sqlite"),
  });
  const server = startLocalGuestServer({
    port: 0,
    environment,
    partnerPrivacyNoticeUrl: "https://example.com/privacy",
  });
  const base = `http://127.0.0.1:${await server.listen()}`;
  const browser = await launchRealBrowser({ headless: true });
  try {
    const tab = await browser.createTab();
    await tab.setReducedMotion(true);
    await tab.setCssViewport(width, 900);
    await tab.navigate(`${base}/partners`);
    await tab.waitForSelector(".xp-stage.is-live", 10_000);
    await run(tab, base, environment);
  } finally {
    await browser.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const STATE = `(() => ({
  shown: [...document.querySelectorAll('.xp-frame')].filter((f) => f.querySelector('.xp-screen').getClientRects().length > 0).map((f) => Number(f.dataset.demoFrame)),
  current: document.querySelector('[data-demo-step][aria-current="step"]').dataset.demoStep,
  live: document.querySelector('[data-demo-live]').textContent,
  next: document.querySelector('[data-demo-next]').textContent,
  previousOff: document.querySelector('[data-demo-previous]').getAttribute('aria-disabled'),
  focus: document.activeElement.textContent,
  scrollY: Math.round(scrollY),
}))()`;

interface State {
  readonly shown: readonly number[];
  readonly current: string;
  readonly live: string;
  readonly next: string;
  readonly previousOff: string;
  readonly focus: string;
  readonly scrollY: number;
}

for (const width of [390, 1280])
  test(`Landing 17 AC3: at ${width}px one frame shows at a time, and Previous, Next and Start again change it, announce it, keep focus and never move the window`, async () => {
    await withPage(width, async (tab) => {
      await tab.evaluate(
        "document.querySelector('[data-demo-controls]').scrollIntoView({ block: 'end', behavior: 'instant' })",
      );
      await tab.focus("[data-demo-next]");
      const start = await tab.evaluate<State>(STATE);
      assert.deepEqual(start.shown, [1]);
      assert.equal(start.live, "", "nothing is announced on load");
      assert.equal(start.previousOff, "true");
      for (let step = 2; step <= 6; step += 1) {
        await tab.pressKey("Enter");
        await tab.waitForFunction(
          `document.querySelector('[data-demo-step][aria-current="step"]').dataset.demoStep === '${step}'`,
        );
        const state = await tab.evaluate<State>(STATE);
        assert.deepEqual(state.shown, [step]);
        assert.equal(
          state.live,
          `Step ${step} of 6: ${PARTNERS_DEMO_STEPS[step - 1]!.name}`,
        );
        assert.equal(state.focus, state.next, "focus stays on the control");
        assert.equal(state.next, step === 6 ? "Start again" : "Next");
        assert.equal(state.previousOff, "false");
      }
      assert.ok(await tab.clickButton("Previous"));
      assert.deepEqual((await tab.evaluate<State>(STATE)).shown, [5]);
      await tab.clickButton("Next");
      await tab.clickButton("Start again");
      const again = await tab.evaluate<State>(STATE);
      assert.deepEqual(again.shown, [1]);
      // The screens are the same height on every step, so the window has nowhere to go; the caption height is what may differ.
      const moved = await tab.evaluate<boolean>(
        "(() => { const y = scrollY; document.querySelector('[data-demo-next]').click(); return Math.abs(scrollY - y) > 1; })()",
      );
      assert.equal(moved, false);
    });
  });

test("Landing 17 AC6: the browser check shows the same messages, focuses the first wrong field and sends nothing; a good form is stored", async () => {
  await withPage(390, async (tab, base, environment) => {
    const set = (id: string, value: string): string =>
      `document.getElementById('f-${id}').value = ${JSON.stringify(value)};`;
    await tab.evaluate(
      `${set("fullName", "Test Applicant")}${set("phone", "0801")}document.querySelector('[data-apply-send]').click()`,
    );
    const wrong = await tab.evaluate<{
      path: string;
      errors: string[];
      focus: string;
      alert: string;
    }>(
      "({ path: location.pathname, errors: [...document.querySelectorAll('[data-apply-error]:not([hidden])')].map((e) => e.dataset.applyError), focus: document.activeElement.id, alert: document.querySelector('[data-apply-alert]').textContent })",
    );
    assert.equal(wrong.path, "/partners");
    assert.deepEqual(wrong.errors, [
      "business",
      "phone",
      "email",
      "area",
      "units",
      "stays",
      "consent",
    ]);
    assert.equal(wrong.focus, "f-business");
    assert.match(wrong.alert, /Not sent\. 7 answers need fixing/);
    await tab.evaluate(
      `${set("business", "Example Apartments Ltd")}${set("phone", "+234 801 234 5678")}${set("email", "applicant@example.com")}${set("area", "Wuse")}${set("units", "2 to 5")}document.querySelector('[name=stays]').checked = true; document.querySelector('[name=consent]').checked = true; document.querySelector('[data-apply-send]').click()`,
    );
    await tab.waitForText("Application sent.", 10_000);
    const sent = await tab.evaluate<{ href: string; inView: boolean }>(
      "(() => { const r = document.getElementById('application').getBoundingClientRect(); return { href: location.href, inView: r.top < innerHeight && r.bottom > 0 }; })()",
    );
    assert.equal(sent.href, `${base}/partners/applied#application`);
    assert.equal(sent.inView, true);
    assert.equal(
      environment.database
        .prepare("SELECT COUNT(*) AS n FROM partner_applications")
        .get()?.n,
      1,
    );
  });
});
