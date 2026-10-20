import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireBrowserLock, BROWSER_LOCK_WAIT_MS } from "./helpers/chrome-devtools.js";

// The real-browser lock serialises browser launches across processes (and worktrees, through the shared tmp directory).
// Its owner file records the holder's PID and start time, a dead holder is taken over, and a wait is bounded.

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "browser-lock-test-"));
}

// A PID that belonged to a process that has exited.
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  return child.pid ?? 0;
}

test("The lock records its holder's PID and start time in the owner file", async () => {
  const dir = freshDir();
  const lockDir = join(dir, "lock");
  const release = await acquireBrowserLock({ lockDir, waitMs: 1000, log: () => {} });
  try {
    const owner = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(join(lockDir, "owner"), "utf8"))) as { pid: number; startedAt: string };
    assert.equal(owner.pid, process.pid);
    assert.ok(!Number.isNaN(Date.parse(owner.startedAt)), `startedAt is a timestamp: ${owner.startedAt}`);
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

test("The default wait bound is a few minutes, longer than any single browser test", () => {
  assert.ok(BROWSER_LOCK_WAIT_MS >= 120_000 && BROWSER_LOCK_WAIT_MS <= 600_000, `default ${BROWSER_LOCK_WAIT_MS} ms`);
});
