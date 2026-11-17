import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LANE_CACHE_LIMIT, LaneCache, planSwitch, timelinesEqual } from "../apps/local-guest/src/lane-cache.js";

// Issue 03i (ADR 0107 decision 11, analysis 5.5 and 11.5): the client keeps each visited lane in memory with its scroll position.
// The cache is a pure module; the client keeps only DOM glue. The server response stays the authority for every lane.

const LANE_CACHE_SOURCE = readFileSync(new URL("../apps/local-guest/src/lane-cache.ts", import.meta.url), "utf8");

const SERVER_TASKS = ["task-stays", "task-shop"] as const;

function cacheWith(...ids: string[]): LaneCache<string> {
  const cache = new LaneCache<string>("g-03i0000001");
  for (const id of ids) cache.put(id, `body:${id}`);
  return cache;
}

test("AC1: Switching to a visited lane shows its transcript from memory before the server answers (the switch event is still sent)", () => {
  const cache = cacheWith("task-stays", "task-shop");
  const plan = planSwitch(cache, { target: "task-stays", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: false });
  assert.equal(plan.show, "cached", "the visited lane is shown from memory");
  assert.equal(plan.sendEvent, true, "the platform.task.switch event still goes to the server, which owns the active task (ADR 0107 decision 2)");
});

test("AC2: Switching back to a lane restores the scroll position the guest left it at", () => {
  const cache = cacheWith("task-stays", "task-shop");
  cache.remember("task-stays", { scrollTop: 480 });
  cache.remember("task-shop", { scrollTop: 12 });
  const plan = planSwitch(cache, { target: "task-stays", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: false });
  assert.equal(plan.scrollTop, 480);
  assert.equal(plan.scroll, "restore");
});

test("AC3: A lane switch replaces the history entry: history.length is unchanged and pushState is not called", () => {
  for (const origin of ["switcher", "chip", "server"] as const) {
    const cache = cacheWith("task-stays");
    const plan = planSwitch(cache, { target: "task-stays", serverTaskIds: SERVER_TASKS, origin, reducedMotion: false });
    assert.equal(plan.history, "replace", `a ${origin} switch replaces the entry`);
  }
});

test("AC4: A cached lane whose taskId is missing from the server's task list is dropped and is not shown (fail closed)", () => {
  const cache = cacheWith("task-stays", "task-gone");
  const dropped = cache.retain(SERVER_TASKS);
  assert.deepEqual(dropped, ["body:task-gone"], "the lane missing from the server list is dropped");
  assert.equal(cache.has("task-gone"), false);
  const plan = planSwitch(cache, { target: "task-gone", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: false });
  assert.equal(plan.show, "none", "a lane the server no longer lists is never shown");
});

test("AC5: Changing the thread id clears every cached lane", () => {
  const cache = cacheWith("task-stays", "task-shop");
  const dropped = cache.bindThread("g-03i0000002");
  assert.deepEqual([...dropped].sort(), ["body:task-shop", "body:task-stays"]);
  assert.equal(cache.size, 0);
  cache.bindThread("g-03i0000002");
  assert.equal(cache.size, 0, "rebinding the same thread keeps the (empty) cache");
});

test("AC6: An unknown or forged task id never shows a cached lane", () => {
  const cache = cacheWith("task-stays");
  assert.equal(cache.has("task-forged"), false);
  const plan = planSwitch(cache, { target: "task-forged", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: false });
  assert.equal(plan.show, "none");
  // A cached id that the server does not list at the moment of the switch is not shown either, even if the cache holds it.
  const plan2 = planSwitch(cache, { target: "task-stays", serverTaskIds: ["task-shop"], origin: "switcher", reducedMotion: false });
  assert.equal(plan2.show, "none");
});

test("AC7: No lane content is written to localStorage, sessionStorage or IndexedDB", () => {
  assert.doesNotMatch(LANE_CACHE_SOURCE, /localStorage|sessionStorage|indexedDB/i, "the lane cache module never touches browser storage");
});

test("AC8: The cache never holds more lanes than the owner's cap, and the least recently used lane is dropped first", () => {
  assert.equal(LANE_CACHE_LIMIT, 4, "the owner's cap (decision 1) is four lanes");
  const cache = new LaneCache<string>("g-03i0000001");
  cache.put("a", "body:a");
  cache.put("b", "body:b");
  cache.put("c", "body:c");
  cache.put("d", "body:d");
  assert.deepEqual(cache.order(), ["a", "b", "c", "d"]);
  assert.equal(cache.get("a")?.handle, "body:a", "a read makes the lane most recently used");
  const evicted = cache.put("e", "body:e");
  assert.deepEqual(evicted, ["body:b"], "the least recently used lane (b) is dropped first");
  assert.equal(cache.size, LANE_CACHE_LIMIT);
  assert.deepEqual(cache.order(), ["c", "d", "a", "e"]);
});

test("AC9: Focus moves to the lane heading only when the switch came from the switcher, and stays put after a chip-driven switch", () => {
  const cache = cacheWith("task-stays", "task-shop");
  const fromSwitcher = planSwitch(cache, { target: "task-shop", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: false });
  assert.equal(fromSwitcher.focus, "lane-heading");
  const fromChip = planSwitch(cache, { target: "task-shop", serverTaskIds: SERVER_TASKS, origin: "chip", reducedMotion: false });
  assert.equal(fromChip.focus, "keep");
  const fromServer = planSwitch(cache, { target: "task-shop", serverTaskIds: SERVER_TASKS, origin: "server", reducedMotion: false });
  assert.equal(fromServer.focus, "keep", "a switch the server made during a turn never moves focus");
});

test("Scroll restore is instant under prefers-reduced-motion and follows the CSS behaviour otherwise", () => {
  const cache = cacheWith("task-stays");
  cache.remember("task-stays", { scrollTop: 200 });
  const reduced = planSwitch(cache, { target: "task-stays", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: true });
  assert.equal(reduced.scrollBehavior, "instant");
  const normal = planSwitch(cache, { target: "task-stays", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: false });
  assert.equal(normal.scrollBehavior, "auto");
});

test("A fresh lane (not cached) has no scroll to restore and asks the server for its timeline", () => {
  const cache = cacheWith("task-stays");
  const plan = planSwitch(cache, { target: "task-shop", serverTaskIds: SERVER_TASKS, origin: "switcher", reducedMotion: false });
  assert.equal(plan.show, "fresh");
  assert.equal(plan.scroll, "none");
  assert.equal(plan.sendEvent, true);
});

test("timelinesEqual compares the server's role and text in order", () => {
  const a = [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }];
  assert.equal(timelinesEqual(a, [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]), true);
  assert.equal(timelinesEqual(a, [{ role: "assistant", text: "hello" }, { role: "user", text: "hi" }]), false);
  assert.equal(timelinesEqual(a, [{ role: "user", text: "hi" }]), false);
});
