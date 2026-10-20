import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCdpTransport, type CdpCallOptions, type CdpSocket } from "./cdp-transport.js";

/**
 * Real-browser helper. The Chrome binary is `SHORTLET_CHROME_PATH` when set and not blank, otherwise the Windows default
 * below. Set `SHORTLET_CHROME_NO_SANDBOX=1` only where Chrome's sandbox cannot run (for example some containers); the
 * sandbox stays on otherwise. Both are read by `resolveChromeLaunch`, which the Chromium tests reach through launchRealBrowser.
 */
const DEFAULT_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export interface ChromeLaunchConfig {
  readonly executable: string;
  readonly sandboxArgs: readonly string[];
}

export function resolveChromeLaunch(env: NodeJS.ProcessEnv = process.env): ChromeLaunchConfig {
  const override = env.SHORTLET_CHROME_PATH?.trim();
  return {
    executable: override ? override : DEFAULT_CHROME_PATH,
    sandboxArgs: env.SHORTLET_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
  };
}

export interface RealBrowserCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly httpOnly?: boolean;
  readonly sameSite?: string;
}

export interface RealBrowserAccessibilityNode {
  readonly role: string;
  readonly name: string;
}

export interface RealBrowserTab {
  readonly targetId: string;
  readonly sessionId: string;
  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(expression: string, options?: CdpCallOptions): Promise<T>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  waitForText(text: string, timeoutMs?: number): Promise<void>;
  waitForFunction(expression: string, timeoutMs?: number): Promise<void>;
  clickButton(labelText: string, accessibleLabel?: string): Promise<boolean>;
  focus(selector: string): Promise<void>;
  isElementFocused(selector: string): Promise<boolean>;
  getCookies(): Promise<readonly RealBrowserCookie[]>;
  /** Sets one cookie for `url` (the tab then sends it like a browser-issued cookie). Used to act as an existing device. */
  setCookie(name: string, value: string, url: string): Promise<void>;
  getContent(): Promise<string>;
  getAccessibilityTree(): Promise<readonly RealBrowserAccessibilityNode[]>;
  captureScreenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
  setViewport(width: number, height: number): Promise<void>;
  setCssViewport(width: number, height: number): Promise<void>;
  setOffline(offline: boolean): Promise<void>;
  pressKey(key: string): Promise<void>;
  setReducedMotion(reduced: boolean): Promise<void>;
  /** Disables page scripts, as a browser with JavaScript turned off would (issue 06c). */
  setJavaScriptEnabled(enabled: boolean): Promise<void>;
  /** Types text into the focused element through the input pipeline, without page scripts. */
  insertText(text: string): Promise<void>;
  setExtraHeaders(headers: Readonly<Record<string, string>>): Promise<void>;
  overrideOrigin(origin: string): Promise<() => Promise<void>>;
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

/** The DevTools endpoint Chrome reports in DevToolsActivePort, inside its own profile directory. */
export interface DevToolsEndpoint {
  readonly port: number;
  readonly browserPath: string;
}

/**
 * Parses DevToolsActivePort: line 1 is the port Chrome bound (launched with --remote-debugging-port=0), line 2 the browser
 * websocket path. Anything else is not used.
 */
export function parseDevToolsActivePort(text: string): DevToolsEndpoint | undefined {
  const [portLine, pathLine] = text.split(/\r?\n/);
  const port = Number((portLine ?? "").trim());
  const browserPath = (pathLine ?? "").trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if (!browserPath.startsWith("/devtools/browser/")) return undefined;
  return { port, browserPath };
}

/**
 * The browser that answers on the port must be the one the profile directory named. Anything else on that port (for
 * example a user's own browser with remote debugging on) is refused, and the run fails rather than attaching to it.
 */
export function assertOwnBrowserEndpoint(endpoint: DevToolsEndpoint, webSocketUrl: string): void {
  let answered: string;
  try {
    answered = new URL(webSocketUrl).pathname;
  } catch {
    throw new Error(`DevTools reported an unreadable websocket URL (${webSocketUrl}); it is not the browser this run launched`);
  }
  if (answered !== endpoint.browserPath) {
    throw new Error(`DevTools on port ${endpoint.port} reports browser ${answered}, which is not the browser this run launched (${endpoint.browserPath})`);
  }
}

const BROWSER_LOCK_DIR = join(tmpdir(), "chat-marketplace-real-browser.lock");

/**
 * How long one launch waits for another process's browser before it fails. A holder keeps the lock for one browser
 * session (one test: seconds to about a minute), so five minutes is generous. A holder that is no longer running is
 * taken over at once, so this bound only ever applies to a live holder.
 */
export const BROWSER_LOCK_WAIT_MS = 5 * 60_000;
/** An owner file not touched for this long has no live heartbeat, so its holder is gone or frozen. */
const BROWSER_LOCK_STALE_MS = 8_000;
const BROWSER_LOCK_POLL_MS = 50;
const BROWSER_LOCK_HEARTBEAT_MS = 1_000;
/** Budget for the cleanup calls in close(); a tab that cannot close quickly does not hold the run up. */
const CLOSE_CALL_TIMEOUT_MS = 5_000;

export interface BrowserLockOptions {
  /** Where the lock lives; the shared tmp directory by default. */
  readonly lockDir?: string;
  /** How long to wait for a live holder before failing. */
  readonly waitMs?: number;
  readonly log?: (message: string) => void;
}

interface BrowserLockOwner {
  readonly pid: number;
  readonly startedAt: string;
}

// The owner file is JSON {pid, startedAt}. An older owner file held the bare PID; it is still read, with an unknown start.
function readBrowserLockOwner(ownerPath: string): BrowserLockOwner | undefined {
  let text: string;
  try {
    text = readFileSync(ownerPath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed === "object" && parsed !== null && "pid" in parsed && "startedAt" in parsed && typeof parsed.pid === "number" && typeof parsed.startedAt === "string") {
    return { pid: parsed.pid, startedAt: parsed.startedAt };
  }
  const legacy = Number(text);
  return Number.isInteger(legacy) && legacy > 0 ? { pid: legacy, startedAt: "unknown" } : undefined;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else, so it is alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function mtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

export async function acquireBrowserLock(options: BrowserLockOptions = {}): Promise<() => void> {
  const lockDir = options.lockDir ?? BROWSER_LOCK_DIR;
  const waitMs = options.waitMs ?? BROWSER_LOCK_WAIT_MS;
  const log = options.log ?? ((message: string) => console.warn(message));
  const ownerPath = join(lockDir, "owner");
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = readBrowserLockOwner(ownerPath);
      if (holder && !processAlive(holder.pid)) {
        log(`Took over the stale real-browser lock at ${lockDir}: holder PID ${holder.pid} (started ${holder.startedAt}) is no longer running.`);
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      // A holder that is alive but has stopped its heartbeat is treated the same way. Without an owner file, the lock
      // directory's own age decides.
      const beat = mtimeMs(holder ? ownerPath : lockDir);
      if (beat === undefined) continue;
      if (Date.now() - beat > BROWSER_LOCK_STALE_MS) {
        const who = holder ? `PID ${holder.pid}` : "unrecorded";
        log(`Took over the stale real-browser lock at ${lockDir}: no heartbeat for ${Math.round((Date.now() - beat) / 1000)} s (holder ${who}).`);
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        const who = holder ? `holder PID ${holder.pid} (started ${holder.startedAt})` : "no recorded holder";
        throw new Error(`Timed out after ${waitMs} ms waiting for the real-browser lock at ${lockDir}; ${who}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, BROWSER_LOCK_POLL_MS));
      continue;
    }
    // Acquired: record this holder, keep its heartbeat fresh, and release on request.
    writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
    const heartbeat = setInterval(() => {
      try {
        utimesSync(ownerPath, new Date(), new Date());
      } catch {
        clearInterval(heartbeat);
      }
    }, BROWSER_LOCK_HEARTBEAT_MS);
    heartbeat.unref();
    return () => {
      clearInterval(heartbeat);
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {}
    };
  }
}

export async function launchRealBrowser(options: { headless?: boolean } = {}): Promise<RealBrowserInstance> {
  const releaseBrowserLock = await acquireBrowserLock();
  const headless = options.headless ?? true;
  // Chrome picks the port (0) and records it in DevToolsActivePort inside this profile; the helper trusts only that file.
  const userDataDir = mkdtempSync(join(tmpdir(), "guest-chrome-"));

  const args = [
    `--remote-debugging-port=0`,
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

  const chrome = resolveChromeLaunch();
  const proc: ChildProcess = spawn(chrome.executable, [...chrome.sandboxArgs, ...args], { stdio: "ignore" });
  const targetIds = new Set<string>();

  // The first launch on a cold CI runner can take longer than 4 s to write its profile (CI run 38090026371 failed at 4.2 s
  // with 40 attempts). The budget only matters when Chrome fails to start; a healthy launch returns on the first poll.
  const DEVTOOLS_READY_ATTEMPTS = 150;
  let endpoint: DevToolsEndpoint | undefined;
  for (let attempt = 0; attempt < DEVTOOLS_READY_ATTEMPTS && !endpoint && proc.exitCode === null; attempt++) {
    try {
      endpoint = parseDevToolsActivePort(readFileSync(join(userDataDir, "DevToolsActivePort"), "utf8"));
    } catch {
      endpoint = undefined;
    }
    if (!endpoint) await new Promise((r) => setTimeout(r, 100));
  }

  if (!endpoint) {
    proc.kill();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    releaseBrowserLock();
    throw new Error(`Chrome did not report its DevTools port in ${userDataDir}`);
  }
  const port = endpoint.port;
  const wsUrl = `ws://127.0.0.1:${port}${endpoint.browserPath}`;

  // Confirm the answering browser is this one before anything is sent to it.
  const reported = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl?: string };
  try {
    assertOwnBrowserEndpoint(endpoint, reported.webSocketDebuggerUrl ?? "");
  } catch (error) {
    proc.kill();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    releaseBrowserLock();
    throw error;
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

  // The page URL of each session, for error messages: the last navigation the helper started or the main frame reported.
  const pageUrls = new Map<string, string>();
  const eventListeners = new Set<(message: { method: string; params?: unknown; sessionId?: string }) => void>();
  const socket: CdpSocket = {
    send: (data) => ws.send(data),
    subscribe: (handlers) => {
      ws.onmessage = (event) => handlers.message(event.data);
      ws.onclose = () => handlers.close();
    },
  };
  const transport = createCdpTransport({
    socket,
    describePage: (sessionId) => (sessionId ? pageUrls.get(sessionId) : undefined) ?? "<unknown page>",
    onEvent: (message) => {
      if (message.method === "Page.frameNavigated" && message.sessionId) {
        const frame = (message.params as { frame?: { url?: unknown; parentId?: unknown } } | undefined)?.frame;
        if (frame && !frame.parentId && typeof frame.url === "string") pageUrls.set(message.sessionId, frame.url);
      }
      for (const listener of eventListeners) listener(message);
    },
  });
  const send = transport.send;

  const versionData = reported as { "User-Agent"?: string; Browser?: string };
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
      pageUrls.set(sessionId, url);
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

    async function evaluate<T = unknown>(expression: string, options?: CdpCallOptions): Promise<T> {
      const res = await send<{ result: { value?: T; type: string; description?: string }; exceptionDetails?: unknown }>(
        "Runtime.evaluate",
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
        options,
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
      // Re-focus on every poll: a surface that just rendered moves focus to itself one animation frame later
      // (apps/local-guest/src/client.ts), which can land after a single focus() call. Focus must hold across two
      // consecutive polls; a persistent trap still fails.
      const refocus = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const held = Boolean(el) && document.activeElement === el;
        if (el && !held && typeof el.focus === "function") el.focus();
        return held;
      })()`;
      const deadline = Date.now() + 8000;
      let heldPolls = 0;
      while (Date.now() < deadline) {
        heldPolls = await evaluate<boolean>(refocus) ? heldPolls + 1 : 0;
        if (heldPolls >= 2) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      const url = await evaluate<string>("location.href").catch(() => "<unavailable>");
      const active = await evaluate<string>("document.activeElement ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '') + '.' + document.activeElement.className : '<none>'").catch(() => "<unavailable>");
      throw new Error(`Timeout focusing ${selector} at ${safeDiagnosticUrl(url)}; focus is on ${active}`);
    }

    async function isElementFocused(selector: string): Promise<boolean> {
      return evaluate<boolean>(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          return Boolean(el && document.activeElement === el);
        })()
      `);
    }

    async function setCookie(name: string, value: string, url: string): Promise<void> {
      await send("Network.setCookie", { name, value, url }, sessionId);
    }

    async function getCookies(): Promise<readonly RealBrowserCookie[]> {
      const res = await send<{ cookies: RealBrowserCookie[] }>("Network.getCookies", {}, sessionId);
      return res.cookies ?? [];
    }

    async function getContent(): Promise<string> {
      return evaluate<string>("document.documentElement.outerHTML");
    }

    async function getAccessibilityTree(): Promise<readonly RealBrowserAccessibilityNode[]> {
      const result = await send<{ nodes: readonly { readonly ignored?: boolean; readonly role?: { readonly value?: unknown }; readonly name?: { readonly value?: unknown } }[] }>("Accessibility.getFullAXTree", {}, sessionId);
      return result.nodes.filter((node) => node.ignored !== true).map((node) => ({
        role: typeof node.role?.value === "string" ? node.role.value : "",
        name: typeof node.name?.value === "string" ? node.name.value : "",
      }));
    }

    async function captureScreenshot(): Promise<Uint8Array> {
      const result = await send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
      return Buffer.from(result.data, "base64");
    }

    async function close(): Promise<void> {
      try {
        await Promise.race([
          send("Target.closeTarget", { targetId }),
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
      } catch {
        // Target may already be closed
      } finally {
        targetIds.delete(targetId);
      }
    }

    async function setViewport(width: number, height: number): Promise<void> {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true }, sessionId);
    }

    async function setCssViewport(width: number, height: number): Promise<void> {
      await send("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false }, sessionId);
    }

    async function setOffline(offline: boolean): Promise<void> {
      await send("Network.emulateNetworkConditions", { offline, latency: offline ? 0 : 20, downloadThroughput: offline ? 0 : 1_000_000, uploadThroughput: offline ? 0 : 1_000_000 }, sessionId);
    }

    async function pressKey(key: string): Promise<void> {
      const keyData: Readonly<Record<string, { readonly code: string; readonly virtualKeyCode: number }>> = {
        Enter: { code: "Enter", virtualKeyCode: 13 },
        Tab: { code: "Tab", virtualKeyCode: 9 },
        Escape: { code: "Escape", virtualKeyCode: 27 },
        Backspace: { code: "Backspace", virtualKeyCode: 8 },
        ALT: { code: "AltLeft", virtualKeyCode: 18 },
      };
      const resolved = keyData[key];
      const params = resolved === undefined ? { key } : {
        key,
        code: resolved.code,
        windowsVirtualKeyCode: resolved.virtualKeyCode,
        nativeVirtualKeyCode: resolved.virtualKeyCode,
        ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
      };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...params }, sessionId);
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...params }, sessionId);
    }

    async function setJavaScriptEnabled(enabled: boolean): Promise<void> {
      await send("Emulation.setScriptExecutionDisabled", { value: !enabled }, sessionId);
    }

    async function insertText(text: string): Promise<void> {
      await send("Input.insertText", { text }, sessionId);
    }

    async function setReducedMotion(reduced: boolean): Promise<void> {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] }, sessionId);
    }

    async function setExtraHeaders(headers: Readonly<Record<string, string>>): Promise<void> {
      await send("Network.setExtraHTTPHeaders", { headers }, sessionId);
    }

    async function overrideOrigin(origin: string): Promise<() => Promise<void>> {
      await send("Fetch.enable", { patterns: [{ requestStage: "Request" }] }, sessionId);
      let active = true;
      const listener = (event: { method: string; params?: unknown; sessionId?: string }) => {
        if (!active || event.sessionId !== sessionId || event.method !== "Fetch.requestPaused") return;
        const params = event.params;
        if (params === null || typeof params !== "object" || Array.isArray(params)) return;
        const record = params as { requestId?: unknown; request?: { headers?: unknown } };
        if (typeof record.requestId !== "string" || record.request?.headers === null || typeof record.request?.headers !== "object" || Array.isArray(record.request.headers)) return;
        const headers = Object.entries(record.request.headers as Record<string, unknown>)
          .filter(([name]) => name.toLowerCase() !== "origin")
          .map(([name, value]) => ({ name, value: String(value) }));
        headers.push({ name: "Origin", value: origin });
        void send("Fetch.continueRequest", { requestId: record.requestId, headers }, sessionId).catch(() => undefined);
      };
      eventListeners.add(listener);
      return async () => {
        if (!active) return;
        active = false;
        eventListeners.delete(listener);
        try { await send("Fetch.disable", {}, sessionId); } catch { /* tab may already be closed */ }
      };
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
      setCookie,
      getContent,
      getAccessibilityTree,
      captureScreenshot,
      close,
      setViewport,
      setCssViewport,
      setOffline,
      pressKey,
      setReducedMotion,
      setJavaScriptEnabled,
      insertText,
      setExtraHeaders,
      overrideOrigin,
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
      try { await send("Target.closeTarget", { targetId }, undefined, { timeoutMs: CLOSE_CALL_TIMEOUT_MS }); } catch {}
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
