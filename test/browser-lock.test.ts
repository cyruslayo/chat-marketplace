import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireBrowserLock, BROWSER_LOCK_WAIT_MS, takeOverStaleLock, type BrowserLockEntry } from "./helpers/chrome-devtools.js";

// The real-browser lock serialises browser launches across processes (and worktrees, through the shared tmp directory).
// Its owner file records the holder's PID and start time, a dead holder is taken over, and a wait is bounded.

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "browser-lock-test-"));
}

function markerPath(lockDir: string): string {
  const marker = readdirSync(lockDir).find((name) => name.startsWith("owner-") && name.endsWith(".json"));
  return marker ? join(lockDir, marker) : join(lockDir, "owner");
}

// A PID that belonged to a process that has exited.
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  return child.pid ?? 0;
}

function startLockHolder(lockDir: string, eventsPath: string): Promise<void> {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const loader = pathToFileURL(join(root, "node_modules", "tsx", "dist", "loader.mjs")).href;
  const helper = pathToFileURL(join(root, "test", "helpers", "chrome-devtools.ts")).href;
  const source = `import { appendFileSync } from "node:fs";
import { acquireBrowserLock } from ${JSON.stringify(helper)};
const release = await acquireBrowserLock({ lockDir: ${JSON.stringify(lockDir)}, waitMs: 5000, log: () => {} });
appendFileSync(${JSON.stringify(eventsPath)}, "start " + process.pid + "\\n");
await new Promise((resolve) => setTimeout(resolve, 100));
appendFileSync(${JSON.stringify(eventsPath)}, "end " + process.pid + "\\n");
release();`;
  const child = spawn(process.execPath, ["--import", loader, "--input-type=module", "--eval", source], { cwd: root, stdio: "ignore" });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Lock-holder child exited ${code}`)));
  });
}

test("The lock records its holder's PID and start time in the owner file", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  const release = await acquireBrowserLock({ lockDir, waitMs: 1000, log: () => {} });
  try {
    const owner = JSON.parse(readFileSync(markerPath(lockDir), "utf8")) as { pid: number; startedAt: string; lockToken: string };
    assert.equal(owner.pid, process.pid);
    assert.ok(!Number.isNaN(Date.parse(owner.startedAt)), `startedAt is a timestamp: ${owner.startedAt}`);
    assert.match(owner.lockToken, /^[0-9a-f-]{36}$/i);
  } finally {
    release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A cleanup failure poisons the live lock and blocks the next browser file immediately", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  const release = await acquireBrowserLock({ lockDir, waitMs: 5000, log: () => {} });
  try {
    release.setProfileIntent("C:\\Temp\\guest-chrome-owned");
    assert.equal(JSON.parse(readFileSync(markerPath(lockDir), "utf8")).profileIntent, "C:\\Temp\\guest-chrome-owned");
    release.setProcessIdentity({ pid: process.pid, executable: process.execPath, creationTime: "test-process", profile: "C:\\Temp\\guest-chrome-owned" });
    release.markCleanupFailed();
    const retained = JSON.parse(readFileSync(markerPath(lockDir), "utf8"));
    assert.equal(retained.profileIntent, "C:\\Temp\\guest-chrome-owned");
    assert.equal(retained.processIdentity.pid, process.pid);
    await assert.rejects(
      acquireBrowserLock({ lockDir, waitMs: 5000, log: () => {} }),
      /records failed cleanup/,
    );
  } finally {
    release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A dead poisoned lock is recovered only after its recorded browser profile has no owners", { skip: process.platform !== "win32" }, async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  const deadWorker = deadPid();
  const deadChrome = deadPid();
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, "owner"), JSON.stringify({
    pid: deadWorker,
    startedAt: "2026-10-25T00:00:00.000Z",
    lockToken: "abandoned-cleanup",
    cleanupFailed: true,
    profileIntent: join(dir, "profile that never launched"),
    processIdentity: {
      pid: deadChrome,
      executable: process.execPath,
      creationTime: "no-such-process",
      profile: join(dir, "profile that never launched"),
    },
  }), "utf8");
  const release = await acquireBrowserLock({ lockDir, waitMs: 1000, log: () => {} });
  try {
    assert.equal(readdirSync(lockDir).some((name) => name.startsWith("owner-")), true);
  } finally {
    release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A lock whose holder PID is no longer running is taken over, and the takeover is logged", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  const pid = deadPid();
  assert.ok(pid > 0);
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, "owner"), JSON.stringify({ pid, startedAt: "2026-10-19T10:00:00.000Z" }), "utf8");
  const logged: string[] = [];
  const release = await acquireBrowserLock({ lockDir, waitMs: 2000, log: (message) => logged.push(message) });
  try {
    assert.equal(logged.length, 1, "the takeover is logged once");
    assert.match(logged[0]!, new RegExp(`Took over the stale real-browser lock at .*lock: holder PID ${pid} `));
  } finally {
    release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A wait for a live holder is bounded: it fails naming the lock path and the holder's PID and start time", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  mkdirSync(lockDir);
  // The holder is this process, which is alive, and its heartbeat is fresh, so the lock is not stale.
  writeFileSync(join(lockDir, "owner"), JSON.stringify({ pid: process.pid, startedAt: "2026-10-19T10:00:00.000Z" }), "utf8");
  const now = new Date();
  utimesSync(join(lockDir, "owner"), now, now);
  const started = Date.now();
  try {
    await assert.rejects(
      acquireBrowserLock({ lockDir, waitMs: 300, log: () => {} }),
      (error: unknown) => error instanceof Error &&
        error.message.includes(`waiting for the real-browser lock at ${lockDir}`) &&
        error.message.includes(`holder PID ${process.pid} (started 2026-10-19T10:00:00.000Z)`)
    );
    assert.ok(Date.now() - started < 10_000, "the wait ended at its bound");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A fresh lock directory without an owner record is not reclaimed", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  mkdirSync(lockDir);
  try {
    await assert.rejects(acquireBrowserLock({ lockDir, waitMs: 200, log: () => {} }), /no recorded holder/);
    assert.equal(existsSync(lockDir), true);
    assert.equal(existsSync(join(lockDir, "owner")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A stale unowned lock directory is reclaimed", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  mkdirSync(lockDir);
  const stale = new Date(Date.now() - 5 * 60_000);
  utimesSync(lockDir, stale, stale);
  const release = await acquireBrowserLock({ lockDir, waitMs: 1000, log: () => {} });
  try {
    assert.ok(JSON.parse(readFileSync(markerPath(lockDir), "utf8")).lockToken);
  } finally {
    release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A live holder is not evicted when its owner file has an old heartbeat", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  mkdirSync(lockDir);
  const ownerPath = join(lockDir, "owner");
  const owner = { pid: process.pid, startedAt: "2026-10-19T10:00:00.000Z", lockToken: "live-owner-token" };
  writeFileSync(ownerPath, JSON.stringify(owner), "utf8");
  const stale = new Date(Date.now() - 5 * 60_000);
  utimesSync(ownerPath, stale, stale);
  try {
    await assert.rejects(acquireBrowserLock({ lockDir, waitMs: 200, log: () => {} }), /Timed out after 200 ms/);
    assert.deepEqual(JSON.parse(readFileSync(ownerPath, "utf8")), owner);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("An old release cannot remove a replacement owner's lock", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  const releaseOld = await acquireBrowserLock({ lockDir, waitMs: 1000, log: () => {} });
  try {
    const oldOwnerPath = markerPath(lockDir);
    const replacement = { pid: process.pid, startedAt: new Date().toISOString(), lockToken: "replacement-owner-token" };
    unlinkSync(oldOwnerPath);
    const replacementPath = join(lockDir, "owner-replacement-owner-token.json");
    writeFileSync(replacementPath, JSON.stringify(replacement), "utf8");
    releaseOld();
    assert.equal(JSON.parse(readFileSync(replacementPath, "utf8")).lockToken, replacement.lockToken);
  } finally {
    releaseOld();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A delayed stale observation cannot remove a newly acquired lock", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  mkdirSync(lockDir);
  const staleOwner = { pid: deadPid(), startedAt: "2026-10-19T10:00:00.000Z", lockToken: "stale-observation-token" };
  const staleOwnerPath = join(lockDir, `owner-${staleOwner.lockToken}.json`);
  writeFileSync(staleOwnerPath, JSON.stringify(staleOwner), "utf8");
  const staleEntry: BrowserLockEntry = { ownerPath: staleOwnerPath, owner: staleOwner };
  unlinkSync(staleOwnerPath);
  rmdirSync(lockDir);
  const releaseReplacement = await acquireBrowserLock({ lockDir, waitMs: 1000, log: () => {} });
  try {
    const replacementPath = markerPath(lockDir);
    const replacement = JSON.parse(readFileSync(replacementPath, "utf8")) as { lockToken: string };
    takeOverStaleLock(lockDir, staleEntry, () => {}, "delayed stale observation");
    assert.equal(existsSync(replacementPath), true);
    assert.notEqual(replacement.lockToken, staleOwner.lockToken);
    await assert.rejects(acquireBrowserLock({ lockDir, waitMs: 100, log: () => {} }), /Timed out after 100 ms/);
  } finally {
    releaseReplacement();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("The default wait bound is a few minutes, longer than any single browser test", () => {
  assert.ok(BROWSER_LOCK_WAIT_MS >= 120_000 && BROWSER_LOCK_WAIT_MS <= 600_000, `default ${BROWSER_LOCK_WAIT_MS} ms`);
});

test("The stale threshold is 30 s or more, above any browser test's synchronous work", async () => {
  const { BROWSER_LOCK_STALE_MS } = await import("./helpers/chrome-devtools.js");
  assert.ok(BROWSER_LOCK_STALE_MS >= 30_000, `stale threshold ${BROWSER_LOCK_STALE_MS} ms`);
});

test("Two waiters on one stale lock: exactly one takes it over, and the other waits until the first releases", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, "owner"), JSON.stringify({ pid: deadPid(), startedAt: "2026-10-19T10:00:00.000Z" }), "utf8");
  const logged: string[] = [];
  const log = (message: string) => logged.push(message);
  const first = acquireBrowserLock({ lockDir, waitMs: 5000, log });
  const second = acquireBrowserLock({ lockDir, waitMs: 5000, log });
  const winner = await Promise.race([
    first.then((release) => ({ who: "first", release })),
    second.then((release) => ({ who: "second", release })),
  ]);
  let loserDone = false;
  const loser = (winner.who === "first" ? second : first).then((release) => {
    loserDone = true;
    return release;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(loserDone, false, "the other waiter does not hold the lock while the winner holds it");
    assert.equal(logged.length, 1, "exactly one takeover is logged");
    winner.release();
    const release = await loser;
    release();
  } finally {
    winner.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Competing processes serialize stale-lock takeover and hold intervals", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  const eventsPath = join(dir, "events.txt");
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, "owner"), JSON.stringify({ pid: deadPid(), startedAt: "2026-10-19T10:00:00.000Z", lockToken: "dead-token" }), "utf8");
  const stale = new Date(Date.now() - 5 * 60_000);
  utimesSync(join(lockDir, "owner"), stale, stale);
  try {
    await Promise.all([startLockHolder(lockDir, eventsPath), startLockHolder(lockDir, eventsPath)]);
    const events = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/).map((line) => line.split(" "));
    assert.deepEqual(events.map(([kind]) => kind), ["start", "end", "start", "end"]);
    assert.equal(events[0]?.[1], events[1]?.[1], "the first process releases before the next process enters");
    assert.equal(events[2]?.[1], events[3]?.[1], "the second process releases before it exits");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
