import test from "node:test";
import assert from "node:assert/strict";
import { operatorGet, operatorPost, startSignedInOperator } from "./helpers/operator-session.js";

// One malformed request must never stop the back office (ADR 0086: pages redirect to sign-in, actions answer 401).

const MALFORMED = "%E0%A4%A";

async function stillServing(base: string, cookie: string) {
  const response = await fetch(`${base}/operator`, { headers: { cookie }, redirect: "manual" });
  assert.equal(response.status, 200, "the server keeps serving signed-in pages");
}

test("A malformed session cookie is treated as signed out, and the server keeps serving", async () => {
  const f = await startSignedInOperator();
  try {
    const bad = `shortlet_operator_session=${MALFORMED}; shortlet_operator_secret=${MALFORMED}`;
    const page = await fetch(`${f.session.base}/operator`, { headers: { cookie: bad }, redirect: "manual" });
    assert.equal(page.status, 303);
    assert.match(page.headers.get("location") ?? "", /^\/operator\/login/);
    assert.equal((await operatorPost(f.session, "/operator/requests/request-1/confirm", bad, {}, {})).status, 401);
    await stillServing(f.session.base, f.session.cookie);
  } finally { await f.close(); }
});

test("A malformed id on any back-office path is not found, and the server keeps serving", async () => {
  const f = await startSignedInOperator();
  try {
    for (const path of [`/operator/requests/${MALFORMED}/confirm`, `/operator/bookings/${MALFORMED}/verified-access`, `/operator/transfers/${MALFORMED}/confirm`, `/operator/payouts/${MALFORMED}`]) {
      assert.equal((await operatorPost(f.session, path, f.session.cookie, {}, {})).status, 404, path);
    }
    for (const path of [`/operator/requests/${MALFORMED}`, `/operator/bookings/${MALFORMED}`, `/operator/transfers/${MALFORMED}/receipt`]) {
      assert.equal((await operatorGet(f.session, path)).status, 404, path);
    }
    await stillServing(f.session.base, f.session.cookie);
  } finally { await f.close(); }
});

test("An unexpected error answers 500 without stopping the server", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const original = env.listOperatorRequestArtifacts.bind(env);
    env.listOperatorRequestArtifacts = () => { throw new Error("boom"); };
    const failed = await operatorGet(f.session, "/operator");
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /boom/, "no internal detail reaches the browser");
    env.listOperatorRequestArtifacts = original;
    await stillServing(f.session.base, f.session.cookie);
  } finally { await f.close(); }
});
