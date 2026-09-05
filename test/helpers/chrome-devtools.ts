import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
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
  clickButton(labelText: string, accessibleLabel?: string): Promise<boolean>;
  focus(selector: string): Promise<void>;
  isElementFocused(selector: string): Promise<boolean>;
  getCookies(): Promise<readonly RealBrowserCookie[]>;
  getContent(): Promise<string>;
  close(): Promise<void>;
}

export interface RealBrowserInstance {
  readonly port: number;
  readonly userAgent: string;
  createTab(url?: string): Promise<RealBrowserTab>;
  close(): Promise<void>;
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

export async function launchRealBrowser(options: { headless?: boolean } = {}): Promise<RealBrowserInstance> {
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
    throw new Error(`Failed to connect to Chrome DevTools on port ${port}`);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error(`WebSocket error: ${String(e)}`));
  });

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
        await Promise.race([
          loadPromise,
          new Promise((r) => setTimeout(r, 4000)),
        ]);
        await new Promise((r) => setTimeout(r, 200));
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
      throw new Error(`Timeout waiting for selector: ${selector} at ${url}`);
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
      throw new Error(`Timeout waiting for text: ${text} at ${url}; body: ${details.replace(/\\s+/g, " ")}`);
    }

    async function clickButton(labelText: string, accessibleLabel?: string): Promise<boolean> {
      const code = `
        (() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const button = buttons.find((b) => {
            const match = b.textContent && b.textContent.includes(${JSON.stringify(labelText)});
            if (!match) return false;
            ${accessibleLabel ? `
            const card = b.closest('[data-a2ui-component="Card"]');
            return card && card.textContent && card.textContent.includes(${JSON.stringify(accessibleLabel.replace(/^View /, ""))});
            ` : "return true;"}
          });
          if (!button) return false;
          button.scrollIntoView({ block: "center" });
          button.click();
          return true;
        })()
      `;
      return evaluate<boolean>(code);
    }

    async function focus(selector: string): Promise<void> {
      await evaluate<void>(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el && typeof el.focus === "function") el.focus();
        })()
      `);
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
      clickButton,
      focus,
      isElementFocused,
      getCookies,
      getContent,
      close,
    };
  }

  async function close(): Promise<void> {
    try {
      ws.close();
    } catch {}
    try {
      proc.kill("SIGKILL");
    } catch {}
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }

  return {
    port,
    userAgent,
    createTab,
    close,
  };
}
