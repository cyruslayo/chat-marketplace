import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolvePilotBaseUrl } from "../scripts/pilot-base-url.js";
import { assertOpsUrlAllowed } from "../apps/shortlet-ops/src/ops-client.js";

const LOCAL_ORIGIN = "http://127.0.0.1:3000";

test("15-prep AC1: with no base URL configured the harness keeps its own local origin and null is returned", () => {
  assert.equal(resolvePilotBaseUrl([], {}), null);
  assert.equal(resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "   " }), null);
  assert.equal(LOCAL_ORIGIN, "http://127.0.0.1:3000");
});

test("15-prep AC2: a base URL given by flag or by SHORTLET_BASE_URL resolves to its origin", () => {
  assert.deepEqual(resolvePilotBaseUrl(["--base-url", "https://staging.example.com"], {}), {
    origin: "https://staging.example.com",
    remote: true,
  });
  assert.deepEqual(resolvePilotBaseUrl(["--base-url=https://staging.example.com/"], {}), {
    origin: "https://staging.example.com",
    remote: true,
  });
  assert.deepEqual(resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "https://staging.example.com" }), {
    origin: "https://staging.example.com",
    remote: true,
  });
  assert.deepEqual(resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "http://localhost:3000" }), {
    origin: "http://localhost:3000",
    remote: true,
  });
});

test("15-prep AC3: a non-https, non-localhost base URL is refused before any request is made", () => {
  assert.throws(() => resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "http://staging.example.com" }), /https/);
  assert.throws(() => resolvePilotBaseUrl(["--base-url", "http://10.0.0.5:3000"], {}), /https/);
  assert.throws(() => resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "not a url" }), /absolute URL/);
});

test("15-prep AC4: a base URL with credentials, a query, a fragment or a path is refused", () => {
  assert.throws(() => resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "https://user:pass@staging.example.com" }), /credentials/);
  assert.throws(() => resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "https://staging.example.com/?token=x" }), /query/);
  assert.throws(() => resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "https://staging.example.com/#frag" }), /fragment/);
  assert.throws(() => resolvePilotBaseUrl([], { SHORTLET_BASE_URL: "https://staging.example.com/operator" }), /path/);
});

test("15-prep AC5: a flag and an environment value that disagree fail closed", () => {
  assert.throws(
    () => resolvePilotBaseUrl(["--base-url", "https://a.example.com"], { SHORTLET_BASE_URL: "https://b.example.com" }),
    /disagree/,
  );
  assert.deepEqual(
    resolvePilotBaseUrl(["--base-url", "https://a.example.com"], { SHORTLET_BASE_URL: "https://a.example.com" }),
    { origin: "https://a.example.com", remote: true },
  );
});

test("15-prep AC6: a flag without a value is refused rather than silently falling back to local", () => {
  assert.throws(() => resolvePilotBaseUrl(["--base-url"], {}), /requires a value/);
  assert.throws(() => resolvePilotBaseUrl(["--base-url="], {}), /requires a value/);
});

test("15-prep AC7: the ops CLI keeps its original SHORTLET_OPS_URL messages after the shared guard extraction", () => {
  assert.throws(() => assertOpsUrlAllowed("http://ops.example.com"), /SHORTLET_OPS_URL must use https/);
  assert.throws(() => assertOpsUrlAllowed("not a url"), /SHORTLET_OPS_URL must be an absolute URL/);
  assert.equal(assertOpsUrlAllowed("https://ops.example.com").protocol, "https:");
});

test("15-prep AC8: the in-process agent smoke refuses a base URL before any model call, and the refused value is not echoed", () => {
  const smoke = spawnSync(process.execPath, ["--import", "tsx", "scripts/pilot-agent-smoke.ts", "--base-url", "https://staging.example.com"], {
    cwd: process.cwd(),
    env: { ...process.env, GEMINI_API_KEY: "", LLM_API_KEY: "", SHORTLET_BASE_URL: "" },
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(smoke.status, 2);
  assert.match(smoke.stderr, /cannot target a base URL/);
  assert.doesNotMatch(smoke.stdout + smoke.stderr, /staging\.example\.com/, "the refused value is not echoed");
});
