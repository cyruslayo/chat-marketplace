import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachToOwnBrowser, inspectWindowsProcess, inspectWindowsProfileOwners, terminateOwnedChromeProcess, type DevToolsEndpoint, type ManagedProcessIdentity } from "./helpers/chrome-devtools.js";

// Before anything is sent to the browser, its /json/version must name the browser the profile directory named. Any failure
// on that path (a network error, a bad status, unreadable JSON, a different browser) must run the cleanup the launch
// depends on (kill Chrome, remove the profile, release the lock), and then be rethrown.

const endpoint: DevToolsEndpoint = { port: 51234, browserPath: "/devtools/browser/aaaa" };

function fakeChild(pid: number, onKill?: () => void) {
  const events = new EventEmitter();
  const child = Object.assign(events, {
    pid,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: (_signal?: NodeJS.Signals) => { onKill?.(); return true; },
  });
  return Object.assign(child, {
    setExit: (code: number) => { child.exitCode = code; },
  }) as unknown as import("node:child_process").ChildProcess & { setExit(code: number): void };
}

function stubFetch(respond: () => Response | Promise<Response>): typeof fetch {
  return (async () => respond()) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("A matching browser is attached to: nothing is cleaned up, and the reported version is returned", async () => {
  let cleanedUp = 0;
  const reported = await attachToOwnBrowser({
    endpoint,
    fetchImpl: stubFetch(() => json({ Browser: "Chrome/130", webSocketDebuggerUrl: "ws://127.0.0.1:51234/devtools/browser/aaaa" })),
    onFailure: () => { cleanedUp += 1; },
  });
  assert.equal(reported.Browser, "Chrome/130");
  assert.equal(cleanedUp, 0);
});

test("A network error on /json/version runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => { throw new TypeError("fetch failed"); }),
      onFailure: () => { cleanedUp += 1; },
    }),
    /fetch failed/
  );
  assert.equal(cleanedUp, 1);
});

test("A non-OK status runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => new Response("<html>nope</html>", { status: 500 })),
      onFailure: () => { cleanedUp += 1; },
    }),
    /answered 500 to \/json\/version/
  );
  assert.equal(cleanedUp, 1);
});

test("Unreadable JSON runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => new Response("not json", { status: 200 })),
      onFailure: () => { cleanedUp += 1; },
    }),
    (error: unknown) => error instanceof Error
  );
  assert.equal(cleanedUp, 1);
});

test("A different browser on the port runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => json({ webSocketDebuggerUrl: "ws://127.0.0.1:51234/devtools/browser/someone-else" })),
      onFailure: () => { cleanedUp += 1; },
    }),
    /not the browser this run launched/
  );
  assert.equal(cleanedUp, 1);
});

test("A rejected browser endpoint does not disclose its path, query, or fragment", async () => {
  const secret = "sentinel-private-reference";
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => json({ webSocketDebuggerUrl: `ws://127.0.0.1:51234/devtools/browser/${secret}?reference=${secret}#${secret}` })),
      onFailure: () => {},
    }),
    (error: unknown) => error instanceof Error && !error.message.includes(secret)
  );
});

test("A stalled DevTools fetch aborts within its bound and runs cleanup once", async () => {
  let cleanedUp = 0;
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
  })) as typeof fetch;
  await assert.rejects(
    attachToOwnBrowser({ endpoint, fetchImpl, timeoutMs: 20, onFailure: () => { cleanedUp += 1; } }),
    /did not answer \/json\/version within 20 ms/
  );
  assert.equal(cleanedUp, 1);
});

test("A stalled DevTools JSON body is bounded and runs cleanup once", async () => {
  let cleanedUp = 0;
  const fetchImpl = (async () => ({ ok: true, json: () => new Promise<unknown>(() => {}) }) as Response) as typeof fetch;
  await assert.rejects(
    attachToOwnBrowser({ endpoint, fetchImpl, timeoutMs: 20, onFailure: () => { cleanedUp += 1; } }),
    /did not answer \/json\/version within 20 ms/
  );
  assert.equal(cleanedUp, 1);
});

test("Fetch and JSON timeouts await asynchronous cleanup before rejecting once", async () => {
  for (const stage of ["fetch", "json"] as const) {
    let cleanupCalls = 0;
    let finishCleanup!: () => void;
    let settled = false;
    const fetchImpl = stage === "fetch"
      ? (((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
        })) as typeof fetch)
      : ((async () => ({ ok: true, json: () => new Promise<unknown>(() => {}) }) as Response) as typeof fetch);
    const attachment = attachToOwnBrowser({
      endpoint,
      fetchImpl,
      timeoutMs: 20,
      onFailure: async () => {
        cleanupCalls += 1;
        await new Promise<void>((resolve) => { finishCleanup = resolve; });
      },
    });
    const observed = attachment.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(cleanupCalls, 1, `${stage} timeout invokes cleanup once`);
    assert.equal(settled, false, `${stage} timeout waits while cleanup remains pending`);
    finishCleanup();
    await assert.rejects(attachment, /did not answer \/json\/version within 20 ms/);
    await observed;
    assert.equal(settled, true);
  }
});

test("Owned-browser termination waits for the launched process to exit", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  assert.ok(child.pid !== undefined);
  try {
    const identity = {
      pid: child.pid,
      executable: process.execPath,
      creationTime: "test-owned-process",
      profile: "test-owned-process-token",
    };
    await terminateOwnedChromeProcess(child, 3000, identity, {
      inspect: (pid) => pid === identity.pid ? identity : undefined,
      inspectProfileOwners: () => [],
      terminate: (pid) => { if (pid === child.pid) child.kill("SIGKILL"); },
    });
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error("verified child did not exit")), 3000)),
      ]);
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

test("PID reuse and missing inspection produce zero process signals", async () => {
  const expected: ManagedProcessIdentity = { pid: 42, executable: "C:\\Chrome\\chrome.exe", creationTime: "one", profile: "C:\\Temp\\profile" };
  const reused: ManagedProcessIdentity = { ...expected, creationTime: "two" };
  let signals = 0;
  const child = fakeChild(42);
  await terminateOwnedChromeProcess(child, 5, expected, {
    platform: "win32",
    inspect: () => reused,
    inspectProfileOwners: () => [],
    terminate: () => { signals += 1; },
  });
  assert.equal(signals, 0);
  await assert.rejects(terminateOwnedChromeProcess(child, 5, expected, {
    platform: "win32",
    inspect: () => undefined,
    inspectProfileOwners: () => undefined,
    terminate: () => { signals += 1; },
  }), /could not be inspected/);
  assert.equal(signals, 0);
});

test("Every verified profile owner is signalled after the full owner set passes inspection", async () => {
  const root: ManagedProcessIdentity = { pid: 51, executable: "C:\\Chrome\\chrome.exe", creationTime: "root", profile: "C:\\Temp\\profile" };
  const renderer: ManagedProcessIdentity = { ...root, pid: 52, creationTime: "renderer" };
  const all = new Map([[root.pid, root], [renderer.pid, renderer]]);
  let signals = 0;
  const child = fakeChild(root.pid, () => {
    child.setExit(0);
    child.emit("exit", 0, null);
  });
  const resultOwners = [root, renderer];
  await terminateOwnedChromeProcess(child, 20, root, {
    platform: "win32",
    inspect: (pid) => all.get(pid),
    inspectProfileOwners: () => resultOwners.splice(0),
    terminate: () => { signals += 1; },
  });
  assert.equal(signals, 2);
});

test("An unverified child profile owner blocks every signal", async () => {
  const root: ManagedProcessIdentity = { pid: 71, executable: "C:\\Chrome\\chrome.exe", creationTime: "root", profile: "C:\\Temp\\profile" };
  const childOwner: ManagedProcessIdentity = { ...root, pid: 72, creationTime: "child" };
  let signals = 0;
  await assert.rejects(terminateOwnedChromeProcess(fakeChild(root.pid), 5, root, {
    platform: "win32",
    inspect: (pid) => pid === root.pid ? root : undefined,
    inspectProfileOwners: () => [root, childOwner],
    terminate: () => { signals += 1; },
  }), /profile owner could not be verified/);
  assert.equal(signals, 0);
});

test("A remaining profile child retains the cleanup lock after root exit", async () => {
  const root: ManagedProcessIdentity = { pid: 81, executable: "C:\\Chrome\\chrome.exe", creationTime: "root", profile: "C:\\Temp\\profile" };
  const renderer: ManagedProcessIdentity = { ...root, pid: 82, creationTime: "renderer" };
  let ownerChecks = 0;
  const child = fakeChild(root.pid, () => {
    child.setExit(0);
    child.emit("exit", 0, null);
  });
  await assert.rejects(terminateOwnedChromeProcess(child, 5, root, {
    platform: "win32",
    inspect: (pid) => pid === root.pid ? root : renderer,
    inspectProfileOwners: () => ++ownerChecks === 1 ? [root, renderer] : [renderer],
    terminate: () => {},
  }), /profile owners remain/);
});

test("A missing child exit event releases only after CIM confirms zero profile owners", async () => {
  const identity: ManagedProcessIdentity = { pid: 61, executable: "C:\\Chrome\\chrome.exe", creationTime: "one", profile: "C:\\Temp\\profile" };
  let signals = 0;
  const child = fakeChild(identity.pid);
  await terminateOwnedChromeProcess(child, 5, identity, {
    platform: "win32",
    inspect: () => identity,
    inspectProfileOwners: () => [],
    terminate: () => { signals += 1; },
  });
  assert.equal(signals, 1);
});

test("Windows CIM reads exact profile arguments with and without spaces", { skip: process.platform !== "win32" }, () => {
  for (const profile of [join(tmpdir(), `chrome-profile-${randomUUID()}`), join(tmpdir(), `chrome profile ${randomUUID()}`)]) {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", `--user-data-dir=${profile}`], { stdio: "ignore" });
    try {
      assert.ok(child.pid !== undefined);
      const identity = inspectWindowsProcess(child.pid);
      assert.ok(identity, `CIM identified PID ${child.pid}`);
      assert.equal(identity.profile.toLocaleLowerCase("en-US"), profile.toLocaleLowerCase("en-US"));
      const owners = inspectWindowsProfileOwners(profile);
      assert.ok(owners?.some((owner) => owner.pid === child.pid));
    } finally {
      child.kill("SIGKILL");
    }
  }
});

test("Windows CIM includes same-executable descendants without their own profile argument", { skip: process.platform !== "win32" }, async () => {
  const profile = join(tmpdir(), `chrome ancestry profile ${randomUUID()}`);
  const code = `const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); process.stdout.write(String(c.pid)+"\\n"); process.on("SIGTERM",()=>{c.kill("SIGTERM");process.exit(0)}); setInterval(()=>{},1000)`;
  const parent = spawn(process.execPath, ["-e", code, "--", `--user-data-dir=${profile}`], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const childPid = await new Promise<number>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("owned child PID was not reported")), 5000);
      parent.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const value = Number(output.trim());
        if (Number.isSafeInteger(value) && value > 0) { clearTimeout(timer); resolve(value); }
      });
      parent.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    assert.equal(inspectWindowsProcess(childPid), undefined, "the child has no direct profile argument");
    const owners = inspectWindowsProfileOwners(profile);
    assert.ok(owners?.some((owner) => owner.pid === parent.pid));
    assert.ok(owners?.some((owner) => owner.pid === childPid && owner.parentProcessId === parent.pid));
  } finally {
    parent.kill("SIGTERM");
  }
});

test("Owned-browser termination accepts a stopped Windows process before its exit event arrives", { skip: process.platform !== "win32" }, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  assert.ok(child.pid !== undefined);
  try {
    // taskkill is synchronous; a zero deadline exposes a delayed Node exit event after the OS has stopped the child.
    await terminateOwnedChromeProcess(child, 0);
    assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
  } finally {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) killProcessTree(child.pid);
  }
});
