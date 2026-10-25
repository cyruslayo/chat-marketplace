import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  futimesSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { killProcessTree } from "../../scripts/browser-phase.mjs";
import {
  createCdpTransport,
  type CdpCallOptions,
  type CdpSocket,
} from "./cdp-transport.js";

/**
 * Real-browser helper. The Chrome binary is `SHORTLET_CHROME_PATH` when set and not blank, otherwise the Windows default
 * below. Set `SHORTLET_CHROME_NO_SANDBOX=1` only where Chrome's sandbox cannot run (for example some containers); the
 * sandbox stays on otherwise. Both are read by `resolveChromeLaunch`, which the Chromium tests reach through launchRealBrowser.
 */
const DEFAULT_CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export interface ChromeLaunchConfig {
  readonly executable: string;
  readonly sandboxArgs: readonly string[];
}

export interface ManagedProcessIdentity {
  readonly pid: number;
  readonly executable: string;
  readonly creationTime: string;
  readonly profile: string;
  readonly parentProcessId?: number;
}

function normalizedIdentityPath(value: string): string {
  return value.replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase("en-US");
}

/** Unknown or incomplete observations never authorize a process signal. */
export function processIdentityMatches(
  expected: ManagedProcessIdentity | undefined,
  actual: ManagedProcessIdentity | undefined,
): boolean {
  const complete = (value: ManagedProcessIdentity | undefined): value is ManagedProcessIdentity =>
    value !== undefined && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.executable === "string" && value.executable.trim().length > 0 &&
    typeof value.creationTime === "string" && value.creationTime.trim().length > 0 &&
    typeof value.profile === "string" && value.profile.trim().length > 0;
  return Boolean(
    complete(expected) && complete(actual) && expected.pid === actual.pid &&
    expected.creationTime === actual.creationTime &&
    (expected.parentProcessId === undefined || actual.parentProcessId === expected.parentProcessId) &&
    normalizedIdentityPath(expected.executable) === normalizedIdentityPath(actual.executable) &&
    normalizedIdentityPath(expected.profile) === normalizedIdentityPath(actual.profile),
  );
}

/** Reads only identity fields from CIM. The raw command line stays inside PowerShell. */
export function inspectWindowsProcess(pid: number, timeoutMs = 5_000): ManagedProcessIdentity | undefined {
  if (process.platform !== "win32" || !Number.isInteger(pid) || pid <= 0) return undefined;
  const script = String.raw`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop; if ($null -eq $p) { exit 3 }; $m=[regex]::Match([string]$p.CommandLine,'(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=(\S+))'); if (!$m.Success) { exit 4 }; $profile=if ($m.Groups[1].Success) {$m.Groups[1].Value} elseif ($m.Groups[2].Success) {$m.Groups[2].Value} else {$m.Groups[3].Value}; [pscustomobject]@{pid=[int]$p.ProcessId; parentProcessId=[int]$p.ParentProcessId; executable=[string]$p.ExecutablePath; creationTime=$p.CreationDate.ToUniversalTime().ToString('o'); profile=$profile} | ConvertTo-Json -Compress`;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", timeout: Math.max(1, Math.min(5_000, timeoutMs)), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const value: unknown = JSON.parse(output);
    if (typeof value !== "object" || value === null) return undefined;
    const row = value as Record<string, unknown>;
    if (row.pid !== pid || typeof row.executable !== "string" || typeof row.creationTime !== "string" || typeof row.profile !== "string" || !Number.isSafeInteger(row.parentProcessId)) return undefined;
    return { pid, executable: row.executable, creationTime: row.creationTime, profile: row.profile, parentProcessId: row.parentProcessId as number };
  } catch {
    return undefined;
  }
}

/** Rechecks an already-attested owner by stable process identity without exposing its command line. */
function inspectWindowsProcessRecord(pid: number, profile: string, timeoutMs: number): ManagedProcessIdentity | undefined {
  if (process.platform !== "win32" || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const script = String.raw`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop; if($null -eq $p){exit 3}; [pscustomobject]@{pid=[int]$p.ProcessId; parentProcessId=[int]$p.ParentProcessId; executable=[string]$p.ExecutablePath; creationTime=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`;
  try {
    const value: unknown = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", timeout: Math.max(1, Math.min(5_000, timeoutMs)), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim());
    if (typeof value !== "object" || value === null) return undefined;
    const row = value as Record<string, unknown>;
    if (row.pid !== pid || !Number.isSafeInteger(row.parentProcessId) || typeof row.executable !== "string" || !row.executable || typeof row.creationTime !== "string" || !row.creationTime) return undefined;
    return { pid, parentProcessId: row.parentProcessId as number, executable: row.executable, creationTime: row.creationTime, profile };
  } catch { return undefined; }
}

/** Returns every process that carries this exact temporary profile, or undefined when CIM cannot prove the set. */
export function inspectWindowsProfileOwners(profile: string, expectedRoot?: ManagedProcessIdentity, timeoutMs = 5_000): readonly ManagedProcessIdentity[] | undefined {
  if (process.platform !== "win32" || profile.trim().length === 0) return undefined;
  const safeProfile = profile.replaceAll("'", "''");
  const expectedRootCheck = expectedRoot
    ? `$root=$all | Where-Object { $_.ProcessId -eq ${expectedRoot.pid} }; if($null -eq $root) { if(@($all | Where-Object { $_.ParentProcessId -eq ${expectedRoot.pid} }).Count -gt 0){exit 5} } elseif([string]$root.ExecutablePath -ine '${expectedRoot.executable.replaceAll("'", "''")}' -or $root.CreationDate.ToUniversalTime().ToString('o') -ne '${expectedRoot.creationTime.replaceAll("'", "''")}' -or !$roots.ContainsKey(${expectedRoot.pid})){exit 6};`
    : "";
  const script = String.raw`$target=[IO.Path]::GetFullPath('${safeProfile}').TrimEnd('\'); $all=@(Get-CimInstance Win32_Process -ErrorAction Stop); $roots=@{}; foreach($p in $all) { $m=[regex]::Match([string]$p.CommandLine,'(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=(\S+))'); if($m.Success) { $value=if($m.Groups[1].Success){$m.Groups[1].Value}elseif($m.Groups[2].Success){$m.Groups[2].Value}else{$m.Groups[3].Value}; try { if([IO.Path]::GetFullPath($value).TrimEnd('\') -ieq $target) { $roots[[int]$p.ProcessId]=[string]$p.ExecutablePath } } catch {} } }; $owned=@{}; foreach($id in $roots.Keys) { $owned[[int]$id]=$roots[[int]$id] }; $changed=$true; while($changed) { $changed=$false; foreach($p in $all) { $parent=[int]$p.ParentProcessId; if(!$owned.ContainsKey([int]$p.ProcessId) -and $owned.ContainsKey($parent) -and [string]$p.ExecutablePath -ieq [string]$owned[$parent]) { $owned[[int]$p.ProcessId]=[string]$p.ExecutablePath; $changed=$true } } }; $rows=@(foreach($p in $all) { if($owned.ContainsKey([int]$p.ProcessId)) { [pscustomobject]@{pid=[int]$p.ProcessId; parentProcessId=[int]$p.ParentProcessId; executable=[string]$p.ExecutablePath; creationTime=$p.CreationDate.ToUniversalTime().ToString('o'); profile=$target} } }); ConvertTo-Json -InputObject ([pscustomobject]@{items=@($rows)}) -Compress`;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", timeout: Math.max(1, Math.min(5_000, timeoutMs)), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const value: unknown = JSON.parse(output);
    if (typeof value !== "object" || value === null || !Array.isArray((value as Record<string, unknown>).items)) return undefined;
    const rows: ManagedProcessIdentity[] = [];
    for (const item of (value as { items: unknown[] }).items) {
      if (typeof item !== "object" || item === null) return undefined;
      const row = item as Record<string, unknown>;
      if (!Number.isSafeInteger(row.pid) || !Number.isSafeInteger(row.parentProcessId) || typeof row.executable !== "string" || !row.executable ||
        typeof row.creationTime !== "string" || !row.creationTime || typeof row.profile !== "string" || !row.profile) return undefined;
      rows.push({ pid: row.pid as number, parentProcessId: row.parentProcessId as number, executable: row.executable, creationTime: row.creationTime, profile: row.profile });
    }
    if (expectedRoot && rows.length === 0) {
      const rootStatusScript = String.raw`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${expectedRoot.pid}" -ErrorAction Stop; $result=if($null -ne $p){[pscustomobject]@{state='present';matches=([string]$p.ExecutablePath -ieq '${expectedRoot.executable.replaceAll("'", "''")}') -and ($p.CreationDate.ToUniversalTime().ToString('o') -eq '${expectedRoot.creationTime.replaceAll("'", "''")}')}}else{$children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${expectedRoot.pid}" -ErrorAction Stop);[pscustomobject]@{state='absent';matches=$false;children=$children.Count}}; $result | ConvertTo-Json -Compress`;
      const rootStatus: unknown = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", rootStatusScript], {
        encoding: "utf8", timeout: Math.max(1, Math.min(5_000, timeoutMs)), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      }).trim());
      if (typeof rootStatus !== "object" || rootStatus === null) return undefined;
      const status = rootStatus as Record<string, unknown>;
      if (!(status.state === "absent" && status.children === 0)) return undefined;
    }
    return rows;
  } catch {
    return undefined;
  }
}

export function resolveChromeLaunch(
  env: NodeJS.ProcessEnv = process.env,
): ChromeLaunchConfig {
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

/** Which platform font actually drew a selector's glyphs (landing typography verification). */
export interface RealBrowserPlatformFont {
  readonly familyName: string;
  readonly postScriptName: string;
  readonly isCustomFont: boolean;
  readonly glyphCount: number;
}

export interface RealBrowserAccessibilityNode {
  readonly role: string;
  readonly name: string;
}

export interface RealBrowserTab {
  readonly targetId: string;
  readonly sessionId: string;
  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(
    expression: string,
    options?: CdpCallOptions,
  ): Promise<T>;
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
  getPlatformFonts(
    selector: string,
  ): Promise<readonly RealBrowserPlatformFont[]>;
  captureScreenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
  setViewport(width: number, height: number): Promise<void>;
  setCssViewport(width: number, height: number): Promise<void>;
  setOffline(offline: boolean): Promise<void>;
  setNetworkProfile(profile: "fast3g" | "none"): Promise<void>;
  pressKey(key: string): Promise<void>;
  setReducedMotion(reduced: boolean): Promise<void>;
  /** Disables page scripts, as a browser with JavaScript turned off would (issue 06c). */
  setJavaScriptEnabled(enabled: boolean): Promise<void>;
  /** Types text into the focused element through the input pipeline, without page scripts. */
  insertText(text: string): Promise<void>;
  setExtraHeaders(headers: Readonly<Record<string, string>>): Promise<void>;
  overrideOrigin(origin: string): Promise<() => Promise<void>>;
  interceptRequests(
    interceptor: (url: string) => Promise<
      | {
          readonly status: number;
          readonly headers: readonly {
            readonly name: string;
            readonly value: string;
          }[];
          readonly body: Uint8Array;
        }
      | undefined
    >,
  ): Promise<() => Promise<void>>;
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
    .replace(
      /(shortlet_guest_session|shortlet_operator_session|shortlet_operator_secret)=[^;\s]+/gi,
      "$1=[redacted-cookie]",
    );
}

function safeDiagnosticUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const depth = parsed.pathname.split("/").filter(Boolean).length;
    return `${parsed.origin}${depth === 0 ? "/" : `/<route:${depth}>`}`;
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
export function parseDevToolsActivePort(
  text: string,
): DevToolsEndpoint | undefined {
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
export function assertOwnBrowserEndpoint(
  endpoint: DevToolsEndpoint,
  webSocketUrl: string,
): void {
  let answered: string;
  try {
    answered = new URL(webSocketUrl).pathname;
  } catch {
    throw new Error(
      "DevTools reported an unreadable websocket URL; it is not the browser this run launched",
    );
  }
  if (answered !== endpoint.browserPath) {
    throw new Error(
      `DevTools on port ${endpoint.port} reported a different browser endpoint; it is not the browser this run launched`,
    );
  }
}

/** Kills only the Chrome process this helper launched and waits for its exit before profile cleanup. */
export async function terminateOwnedChromeProcess(
  proc: ChildProcess,
  timeoutMs = OWNED_CHROME_TERMINATION_TIMEOUT_MS,
  identity?: ManagedProcessIdentity,
  actions: {
    readonly platform?: NodeJS.Platform;
    readonly inspect?: (pid: number) => ManagedProcessIdentity | undefined;
    readonly inspectProfileOwners?: (profile: string, expectedRoot?: ManagedProcessIdentity) => readonly ManagedProcessIdentity[] | undefined;
    readonly terminate?: (pid: number) => void;
  } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  if (proc.pid === undefined) return;
  const isWindows = (actions.platform ?? process.platform) === "win32";
  const inspectProfileOwners = actions.inspectProfileOwners ?? inspectWindowsProfileOwners;
  const isExited = () => proc.exitCode !== null || proc.signalCode !== null;
  if (isWindows) {
    if (!identity) throw new Error("Owned Chrome identity is missing; process signal was refused");
    const inspect = actions.inspect ?? ((pid: number) =>
      inspectWindowsProcessRecord(pid, identity.profile, Math.max(1, deadline - Date.now())));
    const killVerified = (candidate: ManagedProcessIdentity) => {
      const actual = inspect(candidate.pid);
      if (!processIdentityMatches(candidate, actual)) return false;
      if (actions.terminate) actions.terminate(candidate.pid);
      else {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return false;
        const result = spawnSync("taskkill", ["/PID", String(candidate.pid), "/F"], {
          stdio: "ignore", timeout: remainingMs, windowsHide: true,
        });
        if (result.status !== 0) return false;
      }
      return true;
    };
    const owners = inspectProfileOwners(identity.profile, identity, Math.max(1, deadline - Date.now()));
    if (owners === undefined) throw new Error("Chrome profile owners could not be inspected; cleanup remains locked");
    const root = inspect(proc.pid);
    const candidates = [...owners];
    if (processIdentityMatches(identity, root) && !candidates.some((owner) => processIdentityMatches(identity, owner))) {
      candidates.push(identity);
    }
    // Validate the complete profile process set before the first PID-directed action.
    for (const owner of candidates) {
      if (Date.now() >= deadline) throw new Error("Chrome cleanup reached its time bound before signalling owners");
      if (!processIdentityMatches(owner, inspect(owner.pid)) ||
        normalizedIdentityPath(owner.profile) !== normalizedIdentityPath(identity.profile)) {
        throw new Error("A Chrome profile owner could not be verified; cleanup remains locked");
      }
    }
    const ownerDepth = (row: ManagedProcessIdentity) => {
      let depth = 0;
      let parent = row.parentProcessId;
      while (parent !== undefined && parent !== identity.pid && depth < candidates.length) {
        const parentOwner = candidates.find((candidate) => candidate.pid === parent);
        if (!parentOwner) break;
        parent = parentOwner.parentProcessId;
        depth += 1;
      }
      return row.pid === identity.pid ? 0 : depth + 1;
    };
    for (const owner of [...candidates].sort((left, right) => ownerDepth(right) - ownerDepth(left))) {
      if (!killVerified(owner)) throw new Error("A Chrome profile owner could not be stopped; cleanup remains locked");
    }
    for (;;) {
      const remaining = inspectProfileOwners(identity.profile, identity, Math.max(1, deadline - Date.now()));
      if (remaining === undefined) throw new Error("Chrome profile owners could not be confirmed; cleanup remains locked");
      if (remaining.length === 0) return;
      if (Date.now() >= deadline) throw new Error("Chrome profile owners remain after the termination bound; cleanup remains locked");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } else if (!isExited()) {
    if (!killProcessTree(proc.pid)) throw new Error("Launched Chrome process group could not be stopped");
  } else {
    return;
  }
  let clearWait: (() => void) | undefined;
  const exited = new Promise<boolean>((resolve) => {
    let settled = false;
    let cleanup = () => {};
    const finish = (didExit: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(didExit);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    cleanup = () => {
      clearTimeout(timer);
      proc.off("exit", onExit);
    };
    clearWait = cleanup;
    proc.once("exit", onExit);
  });
  if (isExited()) { clearWait?.(); return; }
  const stopped = await exited;
  if (!stopped && !isExited()) {
    throw new Error(`Launched Chrome process ${proc.pid} did not exit within ${timeoutMs} ms after termination was requested`);
  }
}

const BROWSER_LOCK_DIR = join(tmpdir(), "chat-marketplace-real-browser.lock");

/**
 * How long one launch waits for another process's browser before it fails. A holder keeps the lock for one browser
 * session (one test: seconds to about a minute), so five minutes is generous. A holder that is no longer running is
 * taken over at once, so this bound only ever applies to a live holder.
 */
export const BROWSER_LOCK_WAIT_MS = 5 * 60_000;
/** Age after which a lock directory with no readable owner record can be reclaimed. */
export const BROWSER_LOCK_STALE_MS = 30_000;
const BROWSER_LOCK_POLL_MS = 50;
const BROWSER_LOCK_HEARTBEAT_MS = 1_000;
export const DEVTOOLS_ATTACH_TIMEOUT_MS = 10_000;
export const OWNED_CHROME_TERMINATION_TIMEOUT_MS = 15_000;
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
  readonly lockToken?: string;
  readonly cleanupFailed?: boolean;
  readonly profileIntent?: string;
  readonly processIdentity?: {
    readonly pid: number;
    readonly executable: string;
    readonly creationTime: string;
    readonly parentProcessId?: number;
  };
}

export interface BrowserLockRelease {
  (): void;
  setProfileIntent(path: string): void;
  setProcessIdentity(identity: ManagedProcessIdentity): void;
  markCleanupFailed(): void;
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
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "pid" in parsed &&
    "startedAt" in parsed &&
    typeof parsed.pid === "number" &&
    typeof parsed.startedAt === "string"
  ) {
    const lockToken =
      "lockToken" in parsed && typeof parsed.lockToken === "string"
        ? parsed.lockToken
        : undefined;
    const cleanupFailed = "cleanupFailed" in parsed && parsed.cleanupFailed === true;
    const profileIntent = "profileIntent" in parsed && typeof parsed.profileIntent === "string"
      ? parsed.profileIntent
      : undefined;
    const rawIdentity = "processIdentity" in parsed ? parsed.processIdentity : undefined;
    const processIdentity = typeof rawIdentity === "object" && rawIdentity !== null &&
      "pid" in rawIdentity && Number.isSafeInteger(rawIdentity.pid) &&
      "executable" in rawIdentity && typeof rawIdentity.executable === "string" &&
      "creationTime" in rawIdentity && typeof rawIdentity.creationTime === "string"
      ? { pid: rawIdentity.pid as number, executable: rawIdentity.executable, creationTime: rawIdentity.creationTime,
          ...( "parentProcessId" in rawIdentity && Number.isSafeInteger(rawIdentity.parentProcessId) ? { parentProcessId: rawIdentity.parentProcessId as number } : {}) }
      : undefined;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      ...(lockToken ? { lockToken } : {}),
      ...(cleanupFailed ? { cleanupFailed } : {}),
      ...(profileIntent ? { profileIntent } : {}),
      ...(processIdentity ? { processIdentity } : {}),
    };
  }
  const legacy = Number(text);
  return Number.isInteger(legacy) && legacy > 0
    ? { pid: legacy, startedAt: "unknown" }
    : undefined;
}

export interface BrowserLockEntry {
  readonly ownerPath: string;
  readonly owner: BrowserLockOwner | undefined;
}

function findBrowserLockEntry(lockDir: string): BrowserLockEntry | undefined {
  let entries: string[];
  try {
    entries = readdirSync(lockDir);
  } catch {
    return undefined;
  }
  const marker = entries.find(
    (name) => name.startsWith("owner-") && name.endsWith(".json"),
  );
  const ownerPath = marker
    ? join(lockDir, marker)
    : entries.includes("owner")
      ? join(lockDir, "owner")
      : undefined;
  return ownerPath
    ? { ownerPath, owner: readBrowserLockOwner(ownerPath) }
    : undefined;
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

function sameLockOwner(
  left: BrowserLockOwner | undefined,
  right: BrowserLockOwner | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.lockToken === right.lockToken
  );
}

/** Removes a dead owner's unique marker, then removes the directory only when it is empty. */
export function takeOverStaleLock(
  lockDir: string,
  entry: BrowserLockEntry | undefined,
  log: (message: string) => void,
  reason: string,
): boolean {
  if (entry?.owner) {
    if (
      processAlive(entry.owner.pid) ||
      !sameLockOwner(readBrowserLockOwner(entry.ownerPath), entry.owner)
    )
      return false;
    try {
      unlinkSync(entry.ownerPath);
      // Another acquisition cannot publish while this path exists. A token-specific marker also prevents an
      // old observation from unlinking a replacement owner's marker after this directory is reclaimed.
      rmdirSync(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      if (
        ["ENOTEMPTY", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return false;
      throw error;
    }
  } else {
    try {
      rmdirSync(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      if (
        ["ENOTEMPTY", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return false;
      throw error;
    }
  }
  log(`Took over the stale real-browser lock at ${lockDir}: ${reason}`);
  return true;
}

export async function acquireBrowserLock(
  options: BrowserLockOptions = {},
): Promise<BrowserLockRelease> {
  const lockDir = options.lockDir ?? BROWSER_LOCK_DIR;
  const waitMs = options.waitMs ?? BROWSER_LOCK_WAIT_MS;
  const log = options.log ?? ((message: string) => console.warn(message));
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lockToken = randomUUID();
    const startedAt = new Date().toISOString();
    const owner = { pid: process.pid, startedAt, lockToken };
    const candidateDir = `${lockDir}.candidate-${process.pid}-${lockToken}`;
    const ownerName = `owner-${lockToken}.json`;
    const candidateOwnerPath = join(candidateDir, ownerName);
    const ownerPath = join(lockDir, ownerName);
    let published = false;
    if (mtimeMs(lockDir) === undefined) {
      try {
        mkdirSync(candidateDir);
        writeFileSync(candidateOwnerPath, JSON.stringify(owner), "utf8");
        renameSync(candidateDir, lockDir);
        published = true;
      } catch (error) {
        try {
          rmSync(candidateDir, { recursive: true, force: true });
        } catch {
          // Best-effort removal of our unpublished candidate; preserve the publication error below.
        }
        if (mtimeMs(lockDir) === undefined) throw error;
      }
    }
    if (published) {
      let ownerFd: number;
      try {
        ownerFd = openSync(ownerPath, "r+");
      } catch (error) {
        try {
          unlinkSync(ownerPath);
        } catch {}
        try {
          rmdirSync(lockDir);
        } catch {
          // Best-effort rollback; the original owner-file error is rethrown below.
        }
        throw error;
      }
      const heartbeat = setInterval(() => {
        if (!sameLockOwner(readBrowserLockOwner(ownerPath), owner)) {
          clearInterval(heartbeat);
          return;
        }
        try {
          futimesSync(ownerFd!, new Date(), new Date());
        } catch {
          clearInterval(heartbeat);
        }
      }, BROWSER_LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      let released = false;
      const release = (() => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        closeSync(ownerFd);
        if (!sameLockOwner(readBrowserLockOwner(ownerPath), owner)) return;
        try {
          unlinkSync(ownerPath);
          rmdirSync(lockDir);
        } catch (error) {
          if (
            !["ENOENT", "ENOTEMPTY", "EPERM"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw error;
        }
      }) as BrowserLockRelease;
      release.setProfileIntent = (path) => {
        if (!sameLockOwner(readBrowserLockOwner(ownerPath), owner)) throw new Error("Real-browser lock ownership changed before profile launch");
        const current = readBrowserLockOwner(ownerPath);
        writeFileSync(ownerPath, JSON.stringify({ ...current, profileIntent: path }), "utf8");
      };
      release.setProcessIdentity = (identity) => {
        if (!sameLockOwner(readBrowserLockOwner(ownerPath), owner)) throw new Error("Real-browser lock ownership changed after process launch");
        const current = readBrowserLockOwner(ownerPath);
        writeFileSync(ownerPath, JSON.stringify({ ...current,
          processIdentity: { pid: identity.pid, executable: identity.executable, creationTime: identity.creationTime,
            ...(identity.parentProcessId === undefined ? {} : { parentProcessId: identity.parentProcessId }) } }), "utf8");
      };
      release.markCleanupFailed = () => {
        if (!sameLockOwner(readBrowserLockOwner(ownerPath), owner)) return;
        const current = readBrowserLockOwner(ownerPath);
        writeFileSync(ownerPath, JSON.stringify({ ...current, cleanupFailed: true }), "utf8");
      };
      return release;
    }
    const entry = findBrowserLockEntry(lockDir);
    const holder = entry?.owner;
    if (holder?.cleanupFailed) {
      if (processAlive(holder.pid)) {
        throw new Error("The real-browser lock records failed cleanup; refusing another browser launch");
      }
      const recorded = holder.processIdentity;
      if (process.platform !== "win32" || !holder.profileIntent || !recorded) {
        throw new Error("Failed browser cleanup cannot be recovered without a verified process identity and profile");
      }
      const identity: ManagedProcessIdentity = { ...recorded, profile: holder.profileIntent };
      const deadOwnerBrowser = {
        pid: identity.pid,
        exitCode: null,
        signalCode: null,
      } as ChildProcess;
      await terminateOwnedChromeProcess(deadOwnerBrowser, OWNED_CHROME_TERMINATION_TIMEOUT_MS, identity);
      if (!takeOverStaleLock(lockDir, entry, log, "the abandoned browser profile was verified empty after cleanup")) {
        throw new Error("Verified browser cleanup completed, but the stale lock could not be recovered");
      }
      continue;
    }
    if (holder && !processAlive(holder.pid)) {
      if (
        takeOverStaleLock(
          lockDir,
          entry,
          log,
          `holder PID ${holder.pid} (started ${holder.startedAt}) is no longer running.`,
        )
      )
        continue;
    }
    // A live PID remains the owner even when its heartbeat is old.
    const beat = mtimeMs(entry?.ownerPath ?? lockDir);
    if (beat === undefined) {
      if (Date.now() >= deadline) {
        const who = holder
          ? `holder PID ${holder.pid} (started ${holder.startedAt})`
          : "no recorded holder";
        throw new Error(
          `Timed out after ${waitMs} ms waiting for the real-browser lock at ${lockDir}; ${who}.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, BROWSER_LOCK_POLL_MS));
      continue;
    }
    if (!entry && Date.now() - beat > BROWSER_LOCK_STALE_MS) {
      if (
        takeOverStaleLock(
          lockDir,
          undefined,
          log,
          `no heartbeat for ${Math.round((Date.now() - beat) / 1000)} s (holder unrecorded).`,
        )
      )
        continue;
    }
    if (Date.now() >= deadline) {
      const who = holder
        ? `holder PID ${holder.pid} (started ${holder.startedAt})`
        : "no recorded holder";
      throw new Error(
        `Timed out after ${waitMs} ms waiting for the real-browser lock at ${lockDir}; ${who}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, BROWSER_LOCK_POLL_MS));
  }
}

interface DevToolsVersion {
  readonly webSocketDebuggerUrl?: string;
  readonly Browser?: string;
  readonly "User-Agent"?: string;
}

/**
 * Confirms the browser answering on the endpoint is the one this run launched, before anything is sent to it. Any failure
 * (a network error, a bad status, unreadable JSON, a different browser) runs onFailure, which the caller uses to kill
 * Chrome, remove its profile and release the lock, and the failure is rethrown.
 */
export async function attachToOwnBrowser(options: {
  readonly endpoint: DevToolsEndpoint;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly onFailure: (error: unknown) => void | Promise<void>;
}): Promise<DevToolsVersion> {
  const timeoutMs = options.timeoutMs ?? DEVTOOLS_ATTACH_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = async (): Promise<DevToolsVersion> => {
    const response = await (options.fetchImpl ?? fetch)(
      `http://127.0.0.1:${options.endpoint.port}/json/version`,
      { signal: controller.signal },
    );
    if (!response.ok)
      throw new Error(
        `DevTools on port ${options.endpoint.port} answered ${response.status} to /json/version`,
      );
    const body: unknown = await response.json();
    const url =
      typeof body === "object" &&
      body !== null &&
      "webSocketDebuggerUrl" in body &&
      typeof body.webSocketDebuggerUrl === "string"
        ? body.webSocketDebuggerUrl
        : "";
    assertOwnBrowserEndpoint(options.endpoint, url);
    return body as DevToolsVersion;
  };
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new Error(
          `DevTools on port ${options.endpoint.port} did not answer /json/version within ${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(), timeout]);
  } catch (error) {
    if (timedOut)
      error = new Error(
        `DevTools on port ${options.endpoint.port} did not answer /json/version within ${timeoutMs} ms`,
      );
    await options.onFailure(error);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function launchRealBrowser(
  options: { headless?: boolean } = {},
): Promise<RealBrowserInstance> {
  const releaseBrowserLock = await acquireBrowserLock();
  const headless = options.headless ?? true;
  // Chrome picks the port (0) and records it in DevToolsActivePort inside this profile; the helper trusts only that file.
  const userDataDir = mkdtempSync(join(tmpdir(), "guest-chrome-"));
  releaseBrowserLock.setProfileIntent(userDataDir);

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
  const proc: ChildProcess = spawn(
    chrome.executable,
    [...chrome.sandboxArgs, ...args],
    {
      stdio: "ignore",
      detached: process.platform !== "win32",
    },
  );
  const processIdentity = proc.pid === undefined ? undefined : inspectWindowsProcess(proc.pid);
  if (processIdentity) releaseBrowserLock.setProcessIdentity(processIdentity);
  let browserExit:
    | { readonly code: number | null; readonly signal: NodeJS.Signals | null }
    | undefined;
  proc.once("exit", (code, signal) => {
    browserExit = { code, signal };
  });
  const cleanupOwnedChrome = async () => {
    try {
      await terminateOwnedChromeProcess(proc, OWNED_CHROME_TERMINATION_TIMEOUT_MS, processIdentity);
    } catch (error) {
      releaseBrowserLock.markCleanupFailed();
      throw error;
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Owned-process termination already succeeded; a locked profile must not prevent lock release.
    }
    releaseBrowserLock();
  };
  const targetIds = new Set<string>();

  // The first launch on a cold CI runner can take longer than 4 s to write its profile (CI run 38090026371 failed at 4.2 s
  // with 40 attempts). The budget only matters when Chrome fails to start; a healthy launch returns on the first poll.
  const DEVTOOLS_READY_ATTEMPTS = 150;
  let endpoint: DevToolsEndpoint | undefined;
  for (
    let attempt = 0;
    attempt < DEVTOOLS_READY_ATTEMPTS && !endpoint && proc.exitCode === null;
    attempt++
  ) {
    try {
      endpoint = parseDevToolsActivePort(
        readFileSync(join(userDataDir, "DevToolsActivePort"), "utf8"),
      );
    } catch {
      endpoint = undefined;
    }
    if (!endpoint) await new Promise((r) => setTimeout(r, 100));
  }

  if (!endpoint) {
    await cleanupOwnedChrome();
    throw new Error(
      `Chrome did not report its DevTools port in ${userDataDir}`,
    );
  }
  const port = endpoint.port;
  const wsUrl = `ws://127.0.0.1:${port}${endpoint.browserPath}`;

  // Confirm the answering browser is this one before anything is sent to it.
  const reported = await attachToOwnBrowser({
    endpoint,
    onFailure: async () => cleanupOwnedChrome(),
  });

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () =>
        reject(
          new Error("WebSocket error while connecting to the launched browser"),
        );
    });
  } catch (error) {
    try {
      ws.close();
    } catch {
      // Retain the attach error; awaited owned-process cleanup below reports termination failures.
    }
    try {
      await cleanupOwnedChrome();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "WebSocket attach failed and Chrome cleanup did not complete",
      );
    }
    throw error;
  }

  // The page URL of each session, for error messages: the last navigation the helper started or the main frame reported.
  const pageUrls = new Map<string, string>();
  const eventListeners = new Set<
    (message: { method: string; params?: unknown; sessionId?: string }) => void
  >();
  const socket: CdpSocket = {
    send: (data) => ws.send(data),
    subscribe: (handlers) => {
      ws.onmessage = (event) => handlers.message(event.data);
      ws.onclose = (event) =>
        handlers.close({ code: event.code, reason: event.reason });
    },
  };
  const transport = createCdpTransport({
    socket,
    describePage: (sessionId) =>
      (sessionId ? pageUrls.get(sessionId) : undefined) ?? "<unknown page>",
    describeBrowserExit: () =>
      browserExit
        ? `Chrome exit code ${browserExit.code ?? "<none>"}, signal ${browserExit.signal ?? "<none>"}`
        : "Chrome process had not exited",
    onEvent: (message) => {
      if (message.method === "Page.frameNavigated" && message.sessionId) {
        const frame = (
          message.params as
            | { frame?: { url?: unknown; parentId?: unknown } }
            | undefined
        )?.frame;
        if (frame && !frame.parentId && typeof frame.url === "string")
          pageUrls.set(message.sessionId, frame.url);
      }
      for (const listener of eventListeners) listener(message);
    },
  });
  const send = transport.send;

  const versionData = reported as { "User-Agent"?: string; Browser?: string };
  const userAgent =
    versionData["User-Agent"] ?? versionData.Browser ?? "Chromium";

  async function createTab(
    initialUrl = "about:blank",
  ): Promise<RealBrowserTab> {
    const target = await send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const targetId = target.targetId;
    targetIds.add(targetId);

    const attached = await send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    );
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
        if (
          event.sessionId === sessionId &&
          (event.method === "Page.loadEventFired" ||
            event.method === "Page.domContentEventFired")
        ) {
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
      } finally {
        eventListeners.delete(listener);
      }
    }

    async function evaluate<T = unknown>(
      expression: string,
      options?: CdpCallOptions,
    ): Promise<T> {
      const res = await send<{
        result: { value?: T; type: string; description?: string };
        exceptionDetails?: unknown;
      }>(
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
        throw new Error(
          `Evaluation exception: ${JSON.stringify(res.exceptionDetails)}`,
        );
      }
      return res.result.value as T;
    }

    async function waitForSelector(
      selector: string,
      timeoutMs = 8000,
    ): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = await evaluate<boolean>(
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        );
        if (found) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      const url = await evaluate<string>("location.href").catch(
        () => "<unavailable>",
      );
      throw new Error(
        `Timeout waiting for selector: ${selector} at ${safeDiagnosticUrl(url)}`,
      );
    }

    async function waitForText(text: string, timeoutMs = 8000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = await evaluate<boolean>(
          `document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`,
        );
        if (found) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      const details = await evaluate<string>(
        "document.body ? document.body.innerText.slice(0, 500) : '<no body>'",
      ).catch(() => "<unavailable>");
      const url = await evaluate<string>("location.href").catch(
        () => "<unavailable>",
      );
      throw new Error(
        `Timeout waiting for text: ${text} at ${safeDiagnosticUrl(url)}; body: ${redactDiagnostics(details.replace(/\\s+/g, " "))}`,
      );
    }

    async function waitForFunction(
      expression: string,
      timeoutMs = 8000,
    ): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await evaluate<boolean>(`Boolean(${expression})`)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      const url = await evaluate<string>("location.href").catch(
        () => "<unavailable>",
      );
      const details = await evaluate<string>(
        "document.body ? document.body.innerText.slice(0, 500) : '<no body>'",
      ).catch(() => "<unavailable>");
      throw new Error(
        `Timeout waiting for browser condition at ${safeDiagnosticUrl(url)}; body: ${redactDiagnostics(details.replace(/\\s+/g, " "))}`,
      );
    }

    async function clickButton(
      labelText: string,
      accessibleLabel?: string,
    ): Promise<boolean> {
      const code = `
        (() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const matches = buttons.filter((b) => {
            const match = b.textContent && b.textContent.includes(${JSON.stringify(labelText)});
            return Boolean(match);
          });
          const button = matches.find((b) => {
            ${
              accessibleLabel
                ? `
            const card = b.closest('[data-a2ui-component="Card"]');
            return Boolean(card && card.textContent && card.textContent.includes(${JSON.stringify(accessibleLabel.replace(/^View /, ""))}));
            `
                : "return true;"
            }
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
        heldPolls = (await evaluate<boolean>(refocus)) ? heldPolls + 1 : 0;
        if (heldPolls >= 2) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      const url = await evaluate<string>("location.href").catch(
        () => "<unavailable>",
      );
      const active = await evaluate<string>(
        "document.activeElement ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '') + '.' + document.activeElement.className : '<none>'",
      ).catch(() => "<unavailable>");
      throw new Error(
        `Timeout focusing ${selector} at ${safeDiagnosticUrl(url)}; focus is on ${active}`,
      );
    }

    async function isElementFocused(selector: string): Promise<boolean> {
      return evaluate<boolean>(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          return Boolean(el && document.activeElement === el);
        })()
      `);
    }

    async function setCookie(
      name: string,
      value: string,
      url: string,
    ): Promise<void> {
      await send("Network.setCookie", { name, value, url }, sessionId);
    }

    async function getCookies(): Promise<readonly RealBrowserCookie[]> {
      const res = await send<{ cookies: RealBrowserCookie[] }>(
        "Network.getCookies",
        {},
        sessionId,
      );
      return res.cookies ?? [];
    }

    async function getContent(): Promise<string> {
      return evaluate<string>("document.documentElement.outerHTML");
    }

    async function getAccessibilityTree(): Promise<
      readonly RealBrowserAccessibilityNode[]
    > {
      const result = await send<{
        nodes: readonly {
          readonly ignored?: boolean;
          readonly role?: { readonly value?: unknown };
          readonly name?: { readonly value?: unknown };
        }[];
      }>("Accessibility.getFullAXTree", {}, sessionId);
      return result.nodes
        .filter((node) => node.ignored !== true)
        .map((node) => ({
          role: typeof node.role?.value === "string" ? node.role.value : "",
          name: typeof node.name?.value === "string" ? node.name.value : "",
        }));
    }

    async function getPlatformFonts(
      selector: string,
    ): Promise<readonly RealBrowserPlatformFont[]> {
      await send("DOM.enable", {}, sessionId);
      await send("CSS.enable", {}, sessionId);
      const document = await send<{ root: { nodeId: number } }>(
        "DOM.getDocument",
        { depth: 0 },
        sessionId,
      );
      const found = await send<{ nodeId: number }>(
        "DOM.querySelector",
        { nodeId: document.root.nodeId, selector },
        sessionId,
      );
      if (!found.nodeId) throw new Error(`No element matches ${selector}`);
      const result = await send<{ fonts: readonly RealBrowserPlatformFont[] }>(
        "CSS.getPlatformFontsForNode",
        { nodeId: found.nodeId },
        sessionId,
      );
      return result.fonts;
    }

    async function captureScreenshot(): Promise<Uint8Array> {
      const result = await send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
        sessionId,
      );
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
      await send(
        "Emulation.setDeviceMetricsOverride",
        { width, height, deviceScaleFactor: 1, mobile: true },
        sessionId,
      );
    }

    async function setCssViewport(
      width: number,
      height: number,
    ): Promise<void> {
      await send(
        "Emulation.setDeviceMetricsOverride",
        {
          width,
          height,
          screenWidth: width,
          screenHeight: height,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      );
    }

    async function setOffline(offline: boolean): Promise<void> {
      await send(
        "Network.emulateNetworkConditions",
        {
          offline,
          latency: offline ? 0 : 20,
          downloadThroughput: offline ? 0 : 1_000_000,
          uploadThroughput: offline ? 0 : 1_000_000,
        },
        sessionId,
      );
    }

    // Landing issue 10's existing Lighthouse Fast 3G profile; no change to the browser lifecycle/transport.
    async function setNetworkProfile(
      profile: "fast3g" | "none",
    ): Promise<void> {
      const conditions =
        profile === "fast3g"
          ? {
              offline: false,
              latency: 563,
              downloadThroughput: 204_800,
              uploadThroughput: 93_750,
            }
          : {
              offline: false,
              latency: 0,
              downloadThroughput: -1,
              uploadThroughput: -1,
            };
      await send("Network.emulateNetworkConditions", conditions, sessionId);
    }

    async function pressKey(key: string): Promise<void> {
      const keyData: Readonly<
        Record<
          string,
          { readonly code: string; readonly virtualKeyCode: number }
        >
      > = {
        Enter: { code: "Enter", virtualKeyCode: 13 },
        Tab: { code: "Tab", virtualKeyCode: 9 },
        Escape: { code: "Escape", virtualKeyCode: 27 },
        Backspace: { code: "Backspace", virtualKeyCode: 8 },
        ALT: { code: "AltLeft", virtualKeyCode: 18 },
      };
      const resolved = keyData[key];
      const params =
        resolved === undefined
          ? { key }
          : {
              key,
              code: resolved.code,
              windowsVirtualKeyCode: resolved.virtualKeyCode,
              nativeVirtualKeyCode: resolved.virtualKeyCode,
              ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
            };
      await send(
        "Input.dispatchKeyEvent",
        { type: "keyDown", ...params },
        sessionId,
      );
      await send(
        "Input.dispatchKeyEvent",
        { type: "keyUp", ...params },
        sessionId,
      );
    }

    async function setJavaScriptEnabled(enabled: boolean): Promise<void> {
      await send(
        "Emulation.setScriptExecutionDisabled",
        { value: !enabled },
        sessionId,
      );
    }

    async function insertText(text: string): Promise<void> {
      await send("Input.insertText", { text }, sessionId);
    }

    async function setReducedMotion(reduced: boolean): Promise<void> {
      await send(
        "Emulation.setEmulatedMedia",
        {
          features: [
            {
              name: "prefers-reduced-motion",
              value: reduced ? "reduce" : "no-preference",
            },
          ],
        },
        sessionId,
      );
    }

    async function setExtraHeaders(
      headers: Readonly<Record<string, string>>,
    ): Promise<void> {
      await send("Network.setExtraHTTPHeaders", { headers }, sessionId);
    }

    async function overrideOrigin(
      origin: string,
    ): Promise<() => Promise<void>> {
      await send(
        "Fetch.enable",
        { patterns: [{ requestStage: "Request" }] },
        sessionId,
      );
      let active = true;
      const listener = (event: {
        method: string;
        params?: unknown;
        sessionId?: string;
      }) => {
        if (
          !active ||
          event.sessionId !== sessionId ||
          event.method !== "Fetch.requestPaused"
        )
          return;
        const params = event.params;
        if (
          params === null ||
          typeof params !== "object" ||
          Array.isArray(params)
        )
          return;
        const record = params as {
          requestId?: unknown;
          request?: { headers?: unknown };
        };
        if (
          typeof record.requestId !== "string" ||
          record.request?.headers === null ||
          typeof record.request?.headers !== "object" ||
          Array.isArray(record.request.headers)
        )
          return;
        const headers = Object.entries(
          record.request.headers as Record<string, unknown>,
        )
          .filter(([name]) => name.toLowerCase() !== "origin")
          .map(([name, value]) => ({ name, value: String(value) }));
        headers.push({ name: "Origin", value: origin });
        void send(
          "Fetch.continueRequest",
          { requestId: record.requestId, headers },
          sessionId,
        ).catch(() => undefined);
      };
      eventListeners.add(listener);
      return async () => {
        if (!active) return;
        active = false;
        eventListeners.delete(listener);
        try {
          await send("Fetch.disable", {}, sessionId);
        } catch {
          /* tab may already be closed */
        }
      };
    }

    async function interceptRequests(
      interceptor: (url: string) => Promise<
        | {
            readonly status: number;
            readonly headers: readonly {
              readonly name: string;
              readonly value: string;
            }[];
            readonly body: Uint8Array;
          }
        | undefined
      >,
    ): Promise<() => Promise<void>> {
      await send(
        "Fetch.enable",
        { patterns: [{ requestStage: "Request" }] },
        sessionId,
      );
      let active = true;
      const listener = (event: {
        method: string;
        params?: unknown;
        sessionId?: string;
      }) => {
        if (
          !active ||
          event.sessionId !== sessionId ||
          event.method !== "Fetch.requestPaused"
        )
          return;
        const params = event.params;
        if (
          params === null ||
          typeof params !== "object" ||
          Array.isArray(params)
        )
          return;
        const record = params as {
          requestId?: unknown;
          request?: { url?: unknown };
        };
        if (
          typeof record.requestId !== "string" ||
          typeof record.request?.url !== "string"
        )
          return;
        void (async () => {
          try {
            const intercepted = await interceptor(
              record.request!.url as string,
            );
            if (!intercepted) {
              await send(
                "Fetch.continueRequest",
                { requestId: record.requestId },
                sessionId,
              );
              return;
            }
            await send(
              "Fetch.fulfillRequest",
              {
                requestId: record.requestId,
                responseCode: intercepted.status,
                responseHeaders: intercepted.headers,
                body: Buffer.from(intercepted.body).toString("base64"),
              },
              sessionId,
            );
          } catch {
            try {
              await send(
                "Fetch.continueRequest",
                { requestId: record.requestId },
                sessionId,
              );
            } catch {
              // Recovery is best effort when the intercepted target has already closed.
            }
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
        try {
          await send("Fetch.disable", {}, sessionId);
        } catch {
          // The interceptor listener is already removed; the target may have closed first.
        }
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
      getPlatformFonts,
      captureScreenshot,
      close,
      setViewport,
      setCssViewport,
      setOffline,
      setNetworkProfile,
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

  async function close(
    options: { readonly releaseLock?: boolean } = {},
  ): Promise<void> {
    if (closed) return;
    closed = true;
    for (const targetId of [...targetIds]) {
      try {
        await send("Target.closeTarget", { targetId }, undefined, {
          timeoutMs: CLOSE_CALL_TIMEOUT_MS,
        });
      } catch {
        // A target may already be closed; authoritative owned-process termination still runs below.
      }
      targetIds.delete(targetId);
    }
    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallback);
        resolve();
      };
      const fallback = setTimeout(finish, 1000);
      ws.addEventListener("close", finish, { once: true });
      try {
        ws.close();
      } catch {
        finish();
      }
    });
    try {
      await terminateOwnedChromeProcess(proc, OWNED_CHROME_TERMINATION_TIMEOUT_MS, processIdentity);
    } catch (error) {
      releaseBrowserLock.markCleanupFailed();
      closed = false;
      throw error;
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Owned-process termination already succeeded; profile deletion remains best effort on Windows.
    }
    if (options.releaseLock !== false) releaseLock();
  }

  return {
    port,
    userAgent,
    createTab,
    close,
    releaseLock,
  };
}
