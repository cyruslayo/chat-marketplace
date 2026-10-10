/**
 * Throwaway agent-side acceptance driver for the local Shortlet pilot.
 *
 * NOT product code. It exists only so the agent can walk the human acceptance
 * scenarios against a running `npm run pilot:local` and capture screenshots +
 * observed text for the acceptance report.
 *
 * Uses raw Chrome DevTools Protocol (no Playwright), mirroring
 * test/helpers/chrome-devtools.ts but adding Page.captureScreenshot.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.PILOT_BASE ?? "http://127.0.0.1:3000";
const OUT_DIR = resolve(".scratch/pilot-acceptance/screenshots");
const JSON_OUT = resolve(".scratch/pilot-acceptance/agent-observations.json");
let declineGuestTab: Tab | undefined;

interface Note {
  readonly step: string;
  readonly ok: boolean;
  readonly detail?: string;
}
const notes: Note[] = [];
function note(step: string, ok: boolean, detail?: string): void {
  notes.push({ step, ok, detail });
  console.log(
    `${ok ? "OK  " : "FAIL"} ${step}${detail ? ` :: ${detail.slice(0, 400)}` : ""}`,
  );
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const p = typeof a === "object" && a ? a.port : 0;
      srv.close((e) => (e ? rej(e) : res(p)));
    });
  });
}

interface Cdp {
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T>;
  close(): void;
}
async function launchChrome(): Promise<{
  cdp: Cdp;
  proc: ChildProcess;
  userDataDir: string;
  port: number;
}> {
  const port = await freePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "pilot-acceptance-chrome-"));
  const proc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${port}`,
      "--headless=new",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-ipc-flooding-protection",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let wsUrl = "";
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok)
        wsUrl =
          ((await r.json()) as { webSocketDebuggerUrl?: string })
            .webSocketDebuggerUrl ?? "";
    } catch {
      /* starting */
    }
    if (!wsUrl) await new Promise((r) => setTimeout(r, 100));
  }
  if (!wsUrl) throw new Error("chrome did not expose CDP");
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = (e) => rej(new Error(String(e)));
  });
  let id = 1;
  const pending = new Map<
    number,
    { res: (v: unknown) => void; rej: (e: unknown) => void }
  >();
  ws.onmessage = (ev) => {
    let parsed: { id?: number; result?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(
        typeof ev.data === "string" ? ev.data : ev.data.toString(),
      ) as { id?: number; result?: unknown; error?: unknown };
    } catch {
      return;
    }
    if (typeof parsed.id === "number" && pending.has(parsed.id)) {
      const { res, rej } = pending.get(parsed.id)!;
      pending.delete(parsed.id);
      if (parsed.error) rej(new Error(JSON.stringify(parsed.error)));
      else res(parsed.result);
    }
  };
  const cdp: Cdp = {
    send<T>(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
    ): Promise<T> {
      const mid = id++;
      return new Promise<T>((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(mid);
          rej(new Error(`CDP timeout: ${method}`));
        }, 20000);
        pending.set(mid, {
          res: (v: unknown) => {
            clearTimeout(timer);
            res(v as T);
          },
          rej: (e: unknown) => {
            clearTimeout(timer);
            rej(e);
          },
        });
        ws.send(
          JSON.stringify({
            id: mid,
            method,
            ...(params ? { params } : {}),
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    },
  };
  return { cdp, proc, userDataDir, port };
}

interface Tab {
  readonly sessionId: string;
  readonly targetId: string;
  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(expr: string): Promise<T>;
  waitForText(text: string, timeoutMs?: number): Promise<boolean>;
  waitForSelector(sel: string, timeoutMs?: number): Promise<boolean>;
  clickActiveButton(label: string): Promise<boolean>;
  setViewport(width: number, height: number): Promise<void>;
  prompt(text: string): Promise<void>;
  fillActiveInput(value: string): Promise<void>;
  screenshot(name: string): Promise<void>;
  text(): Promise<string>;
  workspace(): Promise<string>;
  close(): Promise<void>;
}

async function createTab(cdp: Cdp, url = "about:blank"): Promise<Tab> {
  const target = await cdp.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
  });
  const attached = await cdp.send<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId: target.targetId, flatten: true },
  );
  const sessionId = attached.sessionId;
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const evaluate = async function evaluateExpr<T>(expr: string): Promise<T> {
    const r = await cdp.send<{
      result: { value?: T };
      exceptionDetails?: unknown;
    }>(
      "Runtime.evaluate",
      { expression: expr, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (r.exceptionDetails)
      throw new Error(
        `eval exception: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`,
      );
    return r.result.value as T;
  };
  const tab: Tab = {
    sessionId,
    targetId: target.targetId,
    async navigate(u) {
      await cdp.send("Page.navigate", { url: u }, sessionId);
      await sleep(1200);
    },
    evaluate,
    async waitForText(text, timeoutMs = 15000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        if (
          await evaluate<boolean>(
            `document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`,
          )
        )
          return true;
        await sleep(200);
      }
      return false;
    },
    async waitForSelector(sel, timeoutMs = 15000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        if (
          await evaluate<boolean>(
            `Boolean(document.querySelector(${JSON.stringify(sel)}))`,
          )
        )
          return true;
        await sleep(200);
      }
      return false;
    },
    async clickActiveButton(label) {
      return evaluate<boolean>(
        `(() => { const b=[...document.querySelectorAll('#active-workspace button')].find((c)=>c.textContent?.includes(${JSON.stringify(label)})); if(!(b instanceof HTMLButtonElement)) return false; b.click(); return true; })()`,
      );
    },
    async setViewport(width, height) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height, deviceScaleFactor: 1, mobile: true },
        sessionId,
      );
    },
    async prompt(text) {
      await tab.waitForSelector("#composer-input", 10000);
      await evaluate(
        `(() => { const i=document.getElementById('composer-input'); const f=document.getElementById('composer'); if(!(i instanceof HTMLInputElement)||!(f instanceof HTMLFormElement)) throw new Error('composer missing'); i.value=${JSON.stringify(text)}; f.requestSubmit(); })()`,
      );
    },
    async fillActiveInput(value) {
      await tab.waitForSelector("#active-workspace input", 10000);
      await evaluate(
        `(() => { const i=document.querySelector('#active-workspace input'); if(!(i instanceof HTMLInputElement)) throw new Error('generated input missing'); i.value=${JSON.stringify(value)}; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); i.blur(); })()`,
      );
    },
    async screenshot(name) {
      // Bring the tab to the foreground: headless Chrome will not compose frames
      // for occluded tabs, which makes Page.captureScreenshot hang.
      try {
        await cdp.send("Target.activateTarget", { targetId: target.targetId });
      } catch {
        /* activation is best-effort */
      }
      await new Promise((r) => setTimeout(r, 250));
      const r = await cdp.send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "png", fromSurface: true },
        sessionId,
      );
      const file = join(OUT_DIR, `${name}.png`);
      writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(`     shot -> ${file}`);
    },
    async text() {
      return evaluate<string>("document.body ? document.body.innerText : ''");
    },
    async workspace() {
      return evaluate<string>(
        "document.getElementById('active-workspace')?.innerText ?? ''",
      );
    },
    async close() {
      try {
        await cdp.send("Target.closeTarget", { targetId: target.targetId });
      } catch {
        /* noop */
      }
    },
  };
  if (url !== "about:blank") await tab.navigate(url);
  return tab;
}

function operatorToken(): string {
  const r = spawnSync("npm", ["run", "pilot:local:operator-token"], {
    encoding: "utf8",
    shell: true,
    cwd: process.cwd(),
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const token = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z0-9_-]{30,}$/.test(l) && !l.includes(" "));
  if (!token)
    throw new Error(`operator token not found in: ${out.slice(0, 500)}`);
  return token;
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    note(
      name,
      false,
      error instanceof Error
        ? `${error.message}\n${error.stack ?? ""}`.slice(0, 800)
        : String(error),
    );
  }
}

async function main(): Promise<void> {
  // SAFETY: hard watchdog so no CDP stall can leave the walk hanging forever.
  setTimeout(
    () => {
      console.error("watchdog: capture exceeded 12 minutes, exiting");
      process.exit(3);
    },
    12 * 60 * 1000,
  );
  mkdirSync(OUT_DIR, { recursive: true });
  const { cdp, proc, userDataDir } = await launchChrome();
  const openedTabs: Tab[] = [];
  const newTab = async (url = "about:blank"): Promise<Tab> => {
    const t = await createTab(cdp, url);
    openedTabs.push(t);
    return t;
  };
  const runAll = (process.env.PILOT_ONLY ?? "") !== "decline";
  const guest = await newTab(`${BASE}/`);
  const guestB = await newTab(`${BASE}/`);
  const guestRef = await newTab(`${BASE}/`);
  const operator = await newTab();
  if (!runAll) {
    await guest.close();
    await guestB.close();
    await guestRef.close();
  }

  if (runAll) {
    // ---------------- Scenario 1: Lagos multi-turn discovery ----------------
    await step("s1.landing", async () => {
      await guest.waitForSelector("#composer-input", 20000);
      await guest.screenshot("01-guest-landing-390");
      note("s1.landing", true);
    });
    await step("s1.turn1 Lagos", async () => {
      await guest.prompt("Lagos");
      const ok = await guest.waitForText("how many guests", 20000);
      await guest.screenshot("02-lagos-clarify");
      note("s1.turn1 Lagos", ok, (await guest.text()).slice(-500));
    });
    await step("s1.turn2 2 nights and 2 guests", async () => {
      await guest.prompt("2 nights and 2 guests");
      const ok = await guest.waitForText("Old Ikoyi", 20000);
      await guest.screenshot("03-lagos-results");
      note(
        "s1.turn2 2 nights and 2 guests",
        ok,
        JSON.stringify({ workspace: (await guest.workspace()).slice(0, 500) }),
      );
    });
    await step("s1.turn3 Lekki", async () => {
      await guest.prompt("Lekki");
      const ok = await guest.waitForText("Lekki Phase 1", 20000);
      await guest.screenshot("04-lekki-results");
      note(
        "s1.turn3 Lekki",
        ok,
        JSON.stringify({
          workspace: (await guest.workspace()).slice(0, 700),
          transcriptTail: (await guest.text()).slice(-700),
        }),
      );
    });

    // ---------------- Scenario 2: refinement ----------------
    await step("s2.refinement two bedrooms", async () => {
      await guestRef.waitForSelector("#composer-input", 20000);
      await guestRef.prompt("Lagos");
      await guestRef.waitForText("how many guests", 20000);
      await guestRef.prompt("2 nights and 2 guests");
      await guestRef.waitForText("Old Ikoyi", 20000);
      await guestRef.prompt("Lekki");
      await guestRef.waitForText("Lekki Phase 1", 20000);
      await guestRef.screenshot("05a-before-refinement");
      const beforeWorkspaces = await guestRef.evaluate<number>(
        "document.querySelectorAll('#active-workspace').length",
      );
      await guestRef.prompt("Only show me two bedrooms.");
      await new Promise((r) => setTimeout(r, 3000));
      const afterWorkspaces = await guestRef.evaluate<number>(
        "document.querySelectorAll('#active-workspace').length",
      );
      await guestRef.screenshot("05-refinement-two-bedrooms");
      const ws = await guestRef.workspace();
      const transcript = await guestRef.text();
      note(
        "s2.refinement two bedrooms",
        beforeWorkspaces === 1 && afterWorkspaces === 1,
        JSON.stringify({
          beforeWorkspaces,
          afterWorkspaces,
          workspaceHasLekki: /Lekki/.test(ws),
          workspaceHasIkoyi: /Ikoyi/.test(ws),
          workspaceHasNoMatch: /No eligible Units/.test(ws),
          workspace: ws.slice(0, 700),
          transcriptTail: transcript.slice(-500),
        }),
      );
    });

    // ---------------- Unit detail ----------------
    await step("s3.unit detail", async () => {
      const clicked = await guest.clickActiveButton("View Unit");
      const ok = await guest.waitForText("Request to Book", 20000);
      await guest.screenshot("06-unit-detail");
      note(
        "s3.unit detail",
        clicked && ok,
        JSON.stringify({
          clicked,
          unitDetailText: (await guest.workspace()).slice(0, 1400),
        }),
      );
    });

    // ---------------- Request Draft / review / phone / Booking Request ----------------
    await step("s4.request draft", async () => {
      const clicked = await guest.clickActiveButton("Request to Book");
      await new Promise((r) => setTimeout(r, 1500));
      await guest.screenshot("07-request-draft");
      const ws = await guest.workspace();
      note(
        "s4.request draft",
        clicked,
        JSON.stringify({ clicked, draftText: ws.slice(0, 1200) }),
      );
    });
    await step("s5.review request", async () => {
      const clicked = await guest.clickActiveButton("Review Request");
      const ok = await guest.waitForText("Submit Booking Request", 20000);
      await guest.screenshot("08-booking-request-review");
      note(
        "s5.review request",
        clicked && ok,
        JSON.stringify({
          clicked,
          reviewText: (await guest.workspace()).slice(0, 1400),
        }),
      );
    });
    await step("s6.submit booking request", async () => {
      const clicked = await guest.clickActiveButton("Submit Booking Request");
      const ok = await guest.waitForText("Phone number", 20000);
      await guest.screenshot("09-phone-collection");
      note(
        "s6.submit booking request",
        clicked && ok,
        JSON.stringify({
          clicked,
          phoneText: (await guest.workspace()).slice(0, 900),
        }),
      );
    });
    await step("s7.save phone", async () => {
      await guest.fillActiveInput("+2348031234567");
      const clicked = await guest.clickActiveButton("Save Phone number");
      await new Promise((r) => setTimeout(r, 2500));
      await guest.screenshot("10-booking-request-created");
      note(
        "s7.save phone",
        clicked,
        JSON.stringify({
          clicked,
          statusText: (await guest.workspace()).slice(0, 1200),
          transcriptTail: (await guest.text()).slice(-600),
        }),
      );
    });
  } // pause runAll: operator login is also needed by the decline-only path

  // ---------------- Operator: login, inbox, detail, confirm ----------------
  await step("s8.operator token + login", async () => {
    const token = operatorToken();
    await operator.navigate(`${BASE}/operator/login`);
    await operator.waitForSelector("#token", 20000);
    await operator.screenshot("11-operator-login");
    await operator.evaluate(
      `(() => { const i=document.querySelector('#token'); const f=i?.closest('form'); if(!(i instanceof HTMLInputElement)||!(f instanceof HTMLFormElement)) throw new Error('token form missing'); i.value=${JSON.stringify(token)}; f.requestSubmit(); })()`,
    );
    const ok = await operator.waitForText("Operator workspace", 20000);
    await operator.screenshot("12-operator-home");
    note(
      "s8.operator token + login",
      ok,
      (await operator.text()).slice(0, 500),
    );
  });
  if (runAll) {
    await step("s9.operator inbox", async () => {
      await operator.navigate(`${BASE}/operator/requests`);
      const ok = await operator.waitForText("Booking Requests", 20000);
      await operator.screenshot("13-operator-inbox");
      note(
        "s9.operator inbox",
        ok,
        JSON.stringify({ inbox: (await operator.text()).slice(0, 1200) }),
      );
    });
    await step("s10.operator request detail", async () => {
      const opened = await operator.evaluate<boolean>(
        `(() => { const a=[...document.querySelectorAll('a')].find((c)=>c.getAttribute('href')?.startsWith('/operator/requests/')); if(!(a instanceof HTMLAnchorElement)) return false; a.click(); return true; })()`,
      );
      const ok = await operator.waitForText("Booking Request", 20000);
      await operator.screenshot("14-operator-request-detail");
      note(
        "s10.operator request detail",
        opened && ok,
        JSON.stringify({
          opened,
          detail: (await operator.text()).slice(0, 1800),
        }),
      );
    });
    await step("s11.operator confirm", async () => {
      const clicked = await operator.evaluate<boolean>(
        `(() => { const b=[...document.querySelectorAll('button')].find((c)=>c.textContent?.includes('Confirm Booking Request')); if(!(b instanceof HTMLButtonElement)) return false; b.click(); return true; })()`,
      );
      const ok = await operator.waitForText("confirmed", 20000);
      await operator.screenshot("15-operator-confirmed");
      note(
        "s11.operator confirm",
        clicked && ok,
        JSON.stringify({
          clicked,
          after: (await operator.text()).slice(0, 900),
        }),
      );
    });

    // ---------------- Guest offer ----------------
    await step("s12.guest offer", async () => {
      await guest.navigate(await guest.evaluate<string>("location.href"));
      const ok = await guest.waitForText("Conditional Booking Offer", 20000);
      await guest.screenshot("16-conditional-offer");
      note(
        "s12.guest offer",
        ok,
        JSON.stringify({ offer: (await guest.workspace()).slice(0, 1400) }),
      );
    });
    await step("s13.accept offer", async () => {
      const clicked = await guest.clickActiveButton("Accept");
      const ok = await guest.waitForText("secure checkout", 20000);
      await guest.screenshot("17-checkout-ready");
      note(
        "s13.accept offer",
        clicked && ok,
        JSON.stringify({
          clicked,
          text: (await guest.workspace()).slice(0, 1000),
          transcriptTail: (await guest.text()).slice(-500),
        }),
      );
    });
    await step("s14.payment email", async () => {
      const status = await guest.evaluate<number>(
        `fetch('/guest/contact/email',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({contactEmail:'acceptance.guest@example.test',expectedRevision:'1'}),redirect:'manual'}).then(()=>0).catch(()=>-1)`,
      );
      await guest.navigate(await guest.evaluate<string>("location.href"));
      await guest.waitForText("secure checkout", 20000);
      await guest.screenshot("18-after-email");
      note("s14.payment email", status === 0, `fetch status ${status}`);
    });
    await step("s15.start secure checkout", async () => {
      const clicked = await guest.clickActiveButton("Start secure checkout");
      const ok = await guest.waitForText(
        "Continue on the standard page",
        20000,
      );
      await guest.screenshot("19-checkout-transition");
      note(
        "s15.start secure checkout",
        clicked && ok,
        JSON.stringify({
          clicked,
          text: (await guest.workspace()).slice(0, 800),
        }),
      );
    });
    await step("s16.local payment", async () => {
      const standard = await guest.evaluate<string>(
        `[...document.querySelectorAll('a')].find((l)=>l.textContent?.includes('Continue on the standard page'))?.href || ''`,
      );
      await guest.navigate(standard);
      await guest.waitForText("Continue to local demo payment", 20000);
      const local = await guest.evaluate<string>(
        `[...document.querySelectorAll('a')].find((l)=>l.textContent?.includes('Continue to local demo payment'))?.href || ''`,
      );
      await guest.navigate(local);
      await guest.waitForText("Local demo payment", 20000);
      await guest.screenshot("20-local-payment-page");
      const completed = await guest.evaluate<boolean>(
        `(() => { const b=[...document.querySelectorAll('button')].find((c)=>c.textContent?.includes('Complete local payment')); if(!(b instanceof HTMLButtonElement)) return false; b.click(); return true; })()`,
      );
      const ok = await guest.waitForText("Reservation confirmed", 20000);
      await guest.screenshot("21-confirmed-booking");
      note(
        "s16.local payment",
        completed && ok,
        JSON.stringify({
          completed,
          confirmed: (await guest.text()).slice(0, 1600),
        }),
      );
    });

    // ---------------- Scenario 3: conflict (fresh session) ----------------
    await step("s17.conflict", async () => {
      await guestB.waitForSelector("#composer-input", 20000);
      await guestB.prompt("Lagos");
      await guestB.waitForText("how many guests", 20000);
      await guestB.prompt("2 nights and 2 guests");
      await guestB.waitForText("Old Ikoyi", 20000);
      await guestB.prompt("Wuse");
      const ok = await guestB.waitForText("Abuja", 20000);
      await guestB.screenshot("22-wuse-conflict");
      const t = await guestB.text();
      note(
        "s17.conflict",
        ok,
        JSON.stringify({
          conflictLine: t
            .split("\n")
            .filter((l) => /Wuse|Abuja|Lagos/.test(l))
            .slice(-6)
            .join(" | "),
          transcriptTail: t.slice(-600),
        }),
      );
    });
    await step("s18.conflict resolve Abuja", async () => {
      await guestB.prompt("Abuja");
      const ok = await guestB.waitForText("Wuse 2", 20000);
      await guestB.screenshot("23-abuja-after-conflict");
      note(
        "s18.conflict resolve Abuja",
        ok,
        JSON.stringify({
          workspace: (await guestB.workspace()).slice(0, 700),
          transcriptTail: (await guestB.text()).slice(-400),
        }),
      );
    });

    // ---------------- Mobile ----------------
    await step("s19.mobile 390", async () => {
      await guest.setViewport(390, 844);
      await new Promise((r) => setTimeout(r, 800));
      await guest.screenshot("24-confirmed-390");
      const m = await guest.evaluate<{ w: number; doc: number; ws: number }>(
        "({w:innerWidth,doc:document.documentElement.scrollWidth,ws:document.querySelectorAll('#active-workspace').length})",
      );
      note("s19.mobile 390", m.doc <= 390, JSON.stringify(m));
    });
    await step("s20.mobile 320", async () => {
      await guest.setViewport(320, 800);
      await new Promise((r) => setTimeout(r, 800));
      await guest.screenshot("25-confirmed-320");
      const m = await guest.evaluate<{ w: number; doc: number; ws: number }>(
        "({w:innerWidth,doc:document.documentElement.scrollWidth,ws:document.querySelectorAll('#active-workspace').length})",
      );
      note("s20.mobile 320", m.doc <= 320, JSON.stringify(m));
    });
    await step("s21.mobile operator inbox 390", async () => {
      await operator.setViewport(390, 844);
      await operator.navigate(`${BASE}/operator/requests`);
      await operator.waitForText("Booking Requests", 20000);
      await operator.screenshot("26-operator-inbox-390");
      const m = await operator.evaluate<{ doc: number }>(
        "({doc:document.documentElement.scrollWidth})",
      );
      note("s21.mobile operator inbox 390", m.doc <= 390, JSON.stringify(m));
    });
    await step("s22.mobile guest discovery 320 (fresh tab)", async () => {
      const t = await newTab(`${BASE}/`);
      await t.setViewport(320, 800);
      await t.navigate(`${BASE}/`);
      await t.waitForSelector("#composer-input", 20000);
      await t.prompt("Lagos");
      await t.waitForText("how many guests", 20000);
      await t.prompt("2 nights and 2 guests");
      await t.waitForText("Old Ikoyi", 20000);
      await t.prompt("Lekki");
      await t.waitForText("Lekki Phase 1", 20000);
      await t.screenshot("27-discovery-320");
      const m = await t.evaluate<{ doc: number; overflow: number }>(
        "(() => { const a=document.getElementById('active-workspace'); return {doc:document.documentElement.scrollWidth, overflow: Math.max((a?.scrollWidth??0)-(a?.clientWidth??0),0)}; })()",
      );
      note(
        "s22.mobile guest discovery 320",
        m.doc <= 320 && m.overflow === 0,
        JSON.stringify(m),
      );
    });
  } // end runAll

  // ---------------- Decline scenario (fresh guest + operator) ----------------
  await step("s23.decline create request", async () => {
    const t = await newTab(`${BASE}/`);
    const composerReady = await t.waitForSelector("#composer-input", 25000);
    if (!composerReady) {
      const diag = await t.evaluate<string>(
        `JSON.stringify({url:location.href,title:document.title,body:(document.body?document.body.innerText:'').slice(0,800),htmlLength:(document.documentElement.outerHTML||'').length})`,
      );
      throw new Error(`decline guest composer missing: ${diag}`);
    }
    await t.prompt("Show me apartments in Wuse 2 for 2 nights for 2 people");
    await t.waitForText("Wuse 2", 20000);
    await t.clickActiveButton("View Unit");
    await t.waitForText("Request to Book", 20000);
    await t.clickActiveButton("Request to Book");
    await t.waitForText("Review Request", 20000);
    await t.clickActiveButton("Review Request");
    await t.waitForText("Submit Booking Request", 20000);
    await t.clickActiveButton("Submit Booking Request");
    await t.waitForText("Phone number", 20000);
    await t.fillActiveInput("+2348094445566");
    await t.clickActiveButton("Save Phone number");
    await new Promise((r) => setTimeout(r, 2500));
    await t.screenshot("28-decline-guest-request");
    note(
      "s23.decline create request",
      true,
      (await t.workspace()).slice(0, 800),
    );
    // keep tab around for guest declination check
    declineGuestTab = t;
  });
  await step("s24.decline via operator", async () => {
    await operator.setViewport(1280, 900);
    await operator.navigate(`${BASE}/operator/requests`);
    await operator.waitForText("Booking Requests", 20000);
    const opened = await operator.evaluate<boolean>(
      `(() => { const links=[...document.querySelectorAll('a')].filter((c)=>c.getAttribute('href')?.startsWith('/operator/requests/')); if(!links.length) return false; links[links.length-1].click(); return true; })()`,
    );
    await operator.waitForText("Booking Request", 20000);
    const clicked = await operator.evaluate<boolean>(
      `(() => { const b=[...document.querySelectorAll('button')].find((c)=>c.textContent?.includes('Decline Booking Request')); if(!(b instanceof HTMLButtonElement)) return false; b.click(); return true; })()`,
    );
    const ok = await operator.waitForText("declined", 20000);
    await operator.screenshot("29-operator-declined");
    note(
      "s24.decline via operator",
      opened && clicked && ok,
      JSON.stringify({ opened, clicked }),
    );
  });
  await step("s25.guest sees decline", async () => {
    const t = declineGuestTab;
    if (!t) throw new Error("decline guest tab missing");
    await t.navigate(await t.evaluate<string>("location.href"));
    const ok = await t.waitForText("declined", 20000);
    await t.screenshot("30-guest-decline");
    note(
      "s25.guest sees decline",
      ok,
      JSON.stringify({ text: (await t.text()).slice(-900) }),
    );
  });

  // ---------------- Restart check (guest + operator) ----------------
  await step("s26.pre-restart state", async () => {
    await guest.setViewport(1280, 900);
    await guest.screenshot("31-pre-restart-guest");
    note("s26.pre-restart state", true);
  });

  for (const t of openedTabs) await t.close().catch(() => undefined);
  cdp.close();
  try {
    proc.kill("SIGKILL");
  } catch {
    /* noop */
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* noop */
  }

  writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, notes }, null, 2));
  const failed = notes.filter((n) => !n.ok).length;
  console.log(
    `\n==== capture complete: ${notes.length - failed}/${notes.length} steps OK ====`,
  );
  console.log(`observations -> ${JSON_OUT}`);
}

await main();
