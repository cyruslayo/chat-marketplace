import test from "node:test";
import assert from "node:assert/strict";
import {
  processIdentityMatches,
  resolveChromeLaunch,
} from "./helpers/chrome-devtools.js";

const DEFAULT_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

test("the default Chrome path is used when SHORTLET_CHROME_PATH is not set", () => {
  assert.equal(resolveChromeLaunch({}).executable, DEFAULT_CHROME_PATH);
});

test("SHORTLET_CHROME_PATH overrides the default Chrome path", () => {
  assert.equal(resolveChromeLaunch({ SHORTLET_CHROME_PATH: "/opt/chromium/chrome" }).executable, "/opt/chromium/chrome");
});

test("a blank SHORTLET_CHROME_PATH falls back to the default Chrome path", () => {
  assert.equal(resolveChromeLaunch({ SHORTLET_CHROME_PATH: "   " }).executable, DEFAULT_CHROME_PATH);
});

test("--no-sandbox is not passed by default", () => {
  assert.deepEqual(resolveChromeLaunch({}).sandboxArgs, []);
});

test("--no-sandbox is passed only when SHORTLET_CHROME_NO_SANDBOX is exactly 1", () => {
  assert.deepEqual(resolveChromeLaunch({ SHORTLET_CHROME_NO_SANDBOX: "1" }).sandboxArgs, ["--no-sandbox"]);
  for (const value of ["0", "true", "yes", ""]) {
    assert.deepEqual(resolveChromeLaunch({ SHORTLET_CHROME_NO_SANDBOX: value }).sandboxArgs, [], `value ${JSON.stringify(value)}`);
  }
});

test("owned-process identity requires the same executable, creation time, and exact profile", () => {
  const expected = {
    pid: 42,
    executable: "C:\\Chrome\\chrome.exe",
    creationTime: "2026-10-25T00:00:00.000Z",
    profile: "C:\\Temp\\guest-chrome-abc",
  };
  assert.equal(processIdentityMatches(expected, { ...expected }), true);
  assert.equal(processIdentityMatches(expected, { ...expected, pid: 43 }), false);
  assert.equal(processIdentityMatches(expected, { ...expected, creationTime: "2026-10-25T00:01:00.000Z" }), false);
  assert.equal(processIdentityMatches(expected, { ...expected, executable: "C:\\Other\\chrome.exe" }), false);
  assert.equal(processIdentityMatches(expected, { ...expected, profile: "C:\\Temp\\guest-chrome-other" }), false);
});

test("unknown process inspection never authorizes a PID signal", () => {
  assert.equal(processIdentityMatches(undefined, undefined), false);
  assert.equal(processIdentityMatches({ pid: 42, executable: "x", creationTime: "t", profile: "p" }, undefined), false);
});
