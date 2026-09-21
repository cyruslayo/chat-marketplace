import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export interface RealBrowserCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly httpOnly?: boolean;
  readonly sameSite?: string;
}

export interface RealBrowserTab {
  readonly targetId: string;
  readonly sessionId: string;
  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  waitForText(text: string, timeoutMs?: number): Promise<void>;
  waitForFunction(expression: string, timeoutMs?: number): Promise<void>;
  clickButton(labelText: string, accessibleLabel?: string): Promise<boolean>;
  focus(selector: string): Promise<void>;
  isElementFocused(selector: string): Promise<boolean>;
  getCookies(): Promise<readonly RealBrowserCookie[]>;
  getContent(): Promise<string>;
  close(): Promise<void>;
  setViewport(width: number, height: number): Promise<void>;
  setOffline(offline: boolean): Promise<void>;
  pressKey(key: string): Promise<void>;
  setReducedMotion(reduced: boolean): Promise<void>;
  interceptRequests(interceptor: (url: string) => Promise<{
    readonly status: number;
    readonly headers: readonly { readonly name: string; readonly value: string }[];
    readonly body: Uint8Array;
  } | undefined>): Promise<() => Promise<void>>;
}

export interface RealBrowserInstance {
  readonly port: number;
  readonly userAgent: string;
  createTab(url?: string): Promise<RealBrowserTab>;
  close(options?: { readonly releaseLock?: boolean }): Promise<void>;
  releaseLock(): void;
}

function redactDiagnostics(value: string): string {
  return value
    .replace(/(?:\+?234|0)\d[\d\s().-]{8,}/g, "[redacted-phone]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?:shortlet_guest_session|shortlet_operator_session|shortlet_operator_secret)=[^;\s]+/gi, "$1=[redacted-cookie]");
}

function safeDiagnosticUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

const BROWSER_LOCK_DIR = join(tmpdir(), "chat-marketplace-real-browser.lock");

async function acquireBrowserLock(): Promise<() => void> {
  for (;;) {
    try {
      mkdirSync(BROWSER_LOCK_DIR);
      writeFileSync(join(BROWSER_LOCK_DIR, "owner"), String(process.pid), "utf8");
      return () => { try { rmSync(BROWSER_LOCK_DIR, { recursive: true, force: true }); } catch {} };
    } catch {
      try {
        const owner = Number(readFileSync(join(BROWSER_LOCK_DIR, "owner"), "utf8"));
        if (!Number.isInteger(owner) || owner <= 0) throw new Error("invalid lock owner");
        try { process.kill(owner, 0); } catch { rmSync(BROWSER_LOCK_DIR, { recursive: true, force: true }); continue; }
      } catch {
        try { rmSync(BROWSER_LOCK_DIR, { recursive: true, force: true }); } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export async function launchRealBrowser(options: { headless?: boolean } = {}): Promise<RealBrowserInstance> {
  const releaseBrowserLock = await acquireBrowserLock();
  const headless = options.headless ?? true;
  const port = await getAvailablePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "guest-chrome-"));

  const args = [
    `--remote-debugging-port=${port}`,
    headless ? "--headless=new" : "",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-popup-blocking",
    "--disable-prompt-on-repost",
    "--disable-renderer-backgrounding",
    "--disable-sync",
    "--force-color-profile=srgb",
    "--metrics-recording-only",
    "about:blank",
  ].filter(Boolean);

  const proc: ChildProcess = spawn(CHROME_PATH, args, { stdio: "ignore" });
  const targetIds = new Set<string>();

  let wsUrl = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const data = (await res.json()) as { webSocketDebuggerUrl?: string; "User-Agent"?: string };
        if (data.webSocketDebuggerUrl) {
          wsUrl = data.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {
      // Chrome is starting up
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!wsUrl) {
    proc.kill();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    releaseBrowserLock();
    throw new Error(`Failed to connect to Chrome DevTools on port ${port}`);
  }

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error(`WebSocket error: ${String(e)}`));
    });
  } catch (error) {
    try { ws.close(); } catch {}
    if (proc.exitCode === null) {
      try { proc.kill("SIGKILL"); } catch {}
    }
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    releaseBrowserLock();
    throw error;
  }

  let messageId = 1;
  const pendingRequests = new Map<number, { resolve: (val: unknown) => void; reject: (err: unknown) => void }>();
  const eventListeners = new Set<(message: { method: string; params?: unknown; sessionId?: string }) => void>();

  ws.onmessage = (event) => {
    try {
      const raw = typeof event.data === "string" ? event.data : event.data.toString();
      const parsed = JSON.parse(raw) as { id?: number; result?: unknown; error?: unknown; method?: string; params?: unknown; sessionId?: string };
      if (typeof parsed.id === "number" && pendingRequests.has(parsed.id)) {
        const { resolve, reject } = pendingRequests.get(parsed.id)!;
        pendingRequests.delete(parsed.id);
        if (parsed.error) reject(new Error(JSON.stringify(parsed.error)));
        else resolve(parsed.result);
      }
      if (parsed.method) {
        for (const listener of eventListeners) {
          listener({ method: parsed.method, params: parsed.params, sessionId: parsed.sessionId });
        }
      }
    } catch {
      // Ignore unparseable frame
    }
  };

  const send = <T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> => {
    const id = messageId++;
    return new Promise<T>((resolve, reject) => {
      pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject });
      ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) }));
    });
  };

  const versionData = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { "User-Agent"?: string; Browser?: string };
  const userAgent = versionData["User-Agent"] ?? versionData.Browser ?? "Chromium";

  async function createTab(initialUrl = "about:blank"): Promise<RealBrowserTab> {
    const target = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const targetId = target.targetId;
    targetIds.add(targetId);

    const attached = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = attached.sessionId;

    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Network.enable", {}, sessionId);

    async function navigate(url: string): Promise<void> {
      let resolveLoad: () => void;
      const loadPromise = new Promise<void>((r) => {
        resolveLoad = r;
      });

      const listener = (event: { method: string; sessionId?: string }) => {
        if (event.sessionId === sessionId && (event.method === "Page.loadEventFired" || event.method === "Page.domContentEventFired")) {
          resolveLoad();
        }
      };

      eventListeners.add(listener);
      try {
        await send("Page.navigate", { url }, sessionId);
        await Promise.race([loadPromise, new Promise((r) => setTimeout(r, 4000))]);
      } finally {
        eventListeners.delete(listener);
      }
    }

    async function evaluate<T = unknown>(expression: string): Promise<T> {
      const res = await send<{ result: { value?: T; type: string; description?: string }; exceptionDetails?: unknown }>(
        "Runtime.evaluate",
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (res.exceptionDetails) {
        throw new Error(`Evaluation exception: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result.value as T;
    }

    async function waitForSelector(selector: string, timeoutMs = 8000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        if (found) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      const url = await evaluate<string>("location.href").catch(() => "<unavailable>");
      throw new Error(`Timeout waiting for selector: ${selector} at ${safeDiagnosticUrl(url)}`);
    }

    async function waitForText(text: string, timeoutMs = 8000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = await evaluate<boolean>(`document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`);
        if (found) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      const details = await evaluate<string>("document.body ? document.body.innerText.slice(0, 500) : '<no body>'").catch(() => "<unavailable>");
      const url = await evaluate<string>("location.href").catch(() => "<unavailable>");
      throw new Error(`Timeout waiting for text: ${text} at ${safeDiagnosticUrl(url)}; body: ${redactDiagnostics(details.replace(/\\s+/g, " "))}`);
    }

    async function waitForFunction(expression: string, timeoutMs = 8000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await evaluate<boolean>(`Boolean(${expression})`)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      const url = await evaluate<string>("location.href").catch(() => "<unavailable>");
      const details = await evaluate<string>("document.body ? document.body.innerText.slice(0, 500) : '<no body>'").catch(() => "<unavailable>");
      throw new Error(`Timeout waiting for browser condition at ${safeDiagnosticUrl(url)}; body: ${redactDiagnostics(details.replace(/\\s+/g, " "))}`);
    }

    async function clickButton(labelText: string, accessibleLabel?: string): Promise<boolean> {
      const code = `
        (() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const matches = buttons.filter((b) => {
            const match = b.textContent && b.textContent.includes(${JSON.stringify(labelText)});
            return Boolean(match);
          });
          const button = matches.find((b) => {
            ${accessibleLabel ? `
            const card = b.closest('[data-a2ui-component="Card"]');
            return Boolean(card && card.textContent && card.textContent.includes(${JSON.stringify(accessibleLabel.replace(/^View /, ""))}));
            ` : "return true;"}
          }) || (matches.length === 1 ? matches[0] : null);
          if (!button) return false;
          button.scrollIntoView({ block: "center" });
          button.click();
          return true;
        })()
      `;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (await evaluate<boolean>(code)) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    }

    async function focus(selector: string): Promise<void> {
      await evaluate<void>(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el && typeof el.focus === "function") el.focus();
        })()
      `);
      await waitForFunction(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`, 8000);
    }

    async function isElementFocused(selector: string): Promise<boolean> {
      return evaluate<boolean>(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          return Boolean(el && document.activeElement === el);
        })()
      `);
    }

    async function getCookies(): Promise<readonly RealBrowserCookie[]> {
      const res = await send<{ cookies: RealBrowserCookie[] }>("Network.getCookies", {}, sessionId);
      return res.cookies ?? [];
    }

    async function getContent(): Promise<string> {
      return evaluate<string>("document.documentElement.outerHTML");
    }

    async function close(): Promise<void> {
      try {
        await send("Target.closeTarget", { targetId });
      } catch {
        // Target may already be closed
      }
    }

    async function setViewport(width: number, height: number): Promise<void> {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true }, sessionId);
    }

    async function setOffline(offline: boolean): Promise<void> {
      await send("Network.emulateNetworkConditions", { offline, latency: offline ? 0 : 20, downloadThroughput: offline ? 0 : 1_000_000, uploadThroughput: offline ? 0 : 1_000_000 }, sessionId);
    }

    async function pressKey(key: string): Promise<void> {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key }, sessionId);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key }, sessionId);
    }

    async function setReducedMotion(reduced: boolean): Promise<void> {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] }, sessionId);
    }

    async function interceptRequests(
      interceptor: (url: string) => Promise<{
        readonly status: number;
        readonly headers: readonly { readonly name: string; readonly value: string }[];
        readonly body: Uint8Array;
      } | undefined>,
    ): Promise<() => Promise<void>> {
      await send("Fetch.enable", { patterns: [{ requestStage: "Request" }] }, sessionId);
      let active = true;
      const listener = (event: { method: string; params?: unknown; sessionId?: string }) => {
        if (!active || event.sessionId !== sessionId || event.method !== "Fetch.requestPaused") return;
        const params = event.params;
        if (params === null || typeof params !== "object" || Array.isArray(params)) return;
        const record = params as { requestId?: unknown; request?: { url?: unknown } };
        if (typeof record.requestId !== "string" || typeof record.request?.url !== "string") return;
        void (async () => {
          try {
            const intercepted = await interceptor(record.request!.url as string);
            if (!intercepted) {
              await send("Fetch.continueRequest", { requestId: record.requestId }, sessionId);
              return;
            }
            await send("Fetch.fulfillRequest", {
              requestId: record.requestId,
              responseCode: intercepted.status,
              responseHeaders: intercepted.headers,
              body: Buffer.from(intercepted.body).toString("base64"),
            }, sessionId);
          } catch {
            try { await send("Fetch.continueRequest", { requestId: record.requestId }, sessionId); } catch {}
          }
        })();
      };
      eventListeners.add(listener);
      let disposed = false;
      return async () => {
        if (disposed) return;
        disposed = true;
        active = false;
        eventListeners.delete(listener);
        try { await send("Fetch.disable", {}, sessionId); } catch {}
      };
    }

    if (initialUrl !== "about:blank") {
      await navigate(initialUrl);
    }

    return {
      targetId,
      sessionId,
      navigate,
      evaluate,
      waitForSelector,
      waitForText,
      waitForFunction,
      clickButton,
      focus,
      isElementFocused,
      getCookies,
      getContent,
      close,
      setViewport,
      setOffline,
      pressKey,
      setReducedMotion,
      interceptRequests,
    };
  }

  let closed = false;
  let lockReleased = false;
  function releaseLock(): void {
    if (lockReleased) return;
    lockReleased = true;
    releaseBrowserLock();
  }

  async function close(options: { readonly releaseLock?: boolean } = {}): Promise<void> {
    if (closed) return;
    closed = true;
    for (const targetId of [...targetIds]) {
      try { await send("Target.closeTarget", { targetId }); } catch {}
      targetIds.delete(targetId);
    }
    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(fallback); resolve(); };
      const fallback = setTimeout(finish, 1000);
      ws.addEventListener("close", finish, { once: true });
      try { ws.close(); } catch { finish(); }
    });
    try {
      if (proc.exitCode === null) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 10000);
          proc.once("exit", () => { clearTimeout(timer); resolve(); });
          try { proc.kill("SIGKILL"); } catch { clearTimeout(timer); resolve(); }
        });
      }
    } finally {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
      if (options.releaseLock !== false) releaseLock();
    }
  }

  return {
    port,
    userAgent,
    createTab,
    close,
    releaseLock,
  };
}
