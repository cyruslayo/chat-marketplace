import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crossOriginPost, operatorGet, operatorPost, revokeOperatorSession, revokeRepresentativeGrant, signInOperator, signOutOperator, startOperatorServer, type OperatorServer, type OperatorSession } from "./helpers/operator-session.js";

// Each B1–B3 action must test these failure paths (map delivery rules; ADR 0082, ADR 0086).
// Since B1, a page GET without a usable session is a 303 to sign-in (with a fixed reason when known);
// an action POST without one stays a 401.

async function signedIn(start = "2026-09-03T10:00:00Z") {
  const dir = await mkdtemp(join(tmpdir(), "operator-session-helper-"));
  let now = new Date(start);
  const server = await startOperatorServer({ databasePath: join(dir, "pilot.sqlite"), clock: () => now });
  const request = server.environment.createDemoIncomingBookingRequest({ checkIn: "2026-09-10", checkOut: "2026-09-13" });
  const session: OperatorSession = { base: server.base, cookie: await signInOperator(server) };
  return { dir, server, session, requestId: request.facts.requestId, advance(ms: number) { now = new Date(now.getTime() + ms); } };
}
async function done(f: { server: OperatorServer; dir: string }) { await f.server.close(); await rm(f.dir, { recursive: true, force: true }); }
const status = (f: Awaited<ReturnType<typeof signedIn>>) => f.server.environment.bookingRequestApp.manager.getRequest(f.requestId).status;

test("The helper signs in: a signed-in operator can open the inbox and the request", async () => {
  const f = await signedIn();
  try {
    assert.equal((await operatorGet(f.session, "/operator/requests")).status, 200);
    assert.equal((await operatorGet(f.session, `/operator/requests/${f.requestId}`)).status, 200);
    assert.equal(status(f), "disclosed");
  } finally { await done(f); }
});

async function redirectsToSignIn(response: Response, location = "/operator/login") {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), location);
}

test("No session: pages go to sign-in and actions are refused with 401", async () => {
  const f = await signedIn();
  try {
    await redirectsToSignIn(await operatorGet(f.session, "/operator", ""));
    await redirectsToSignIn(await operatorGet(f.session, "/operator/requests", ""));
    assert.equal((await operatorPost(f.session, `/operator/requests/${f.requestId}/confirm`, "")).status, 401);
    assert.equal(status(f), "disclosed");
  } finally { await done(f); }
});

test("Logout: the old cookie is sent to sign-in and refused for actions", async () => {
  const f = await signedIn();
  try {
    const out = await signOutOperator(f.session);
    assert.equal(out.status, 302);
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
    await redirectsToSignIn(await operatorGet(f.session, "/operator/requests"), "/operator/login?reason=signed-out");
    assert.equal((await operatorPost(f.session, `/operator/requests/${f.requestId}/confirm`)).status, 401);
  } finally { await done(f); }
});

test("Revoked session: a session revoked server-side is sent to sign-in and refused for actions", async () => {
  const f = await signedIn();
  try {
    revokeOperatorSession(f.server.environment, f.session.cookie);
    await redirectsToSignIn(await operatorGet(f.session, "/operator/requests"), "/operator/login?reason=signed-out");
    assert.equal((await operatorPost(f.session, `/operator/requests/${f.requestId}/confirm`)).status, 401);
  } finally { await done(f); }
});

test("Expired session: after the 12-hour session lifetime (ADR 0086) the cookie is sent to sign-in and refused for actions", async () => {
  const f = await signedIn();
  try {
    f.advance(12 * 60 * 60 * 1000);
    await redirectsToSignIn(await operatorGet(f.session, "/operator"), "/operator/login?reason=expired");
    await redirectsToSignIn(await operatorGet(f.session, "/operator/requests"), "/operator/login?reason=expired");
    assert.equal((await operatorPost(f.session, `/operator/requests/${f.requestId}/confirm`)).status, 401);
  } finally { await done(f); }
});

test("Cross-origin POST: a signed-in action from a foreign Origin is refused with 403", async () => {
  const f = await signedIn();
  try {
    assert.equal((await crossOriginPost(f.session, `/operator/requests/${f.requestId}/confirm`)).status, 403);
    assert.equal((await crossOriginPost(f.session, "/operator/logout")).status, 403);
    assert.equal(status(f), "disclosed");
    assert.equal((await operatorGet(f.session, "/operator/requests")).status, 200);
  } finally { await done(f); }
});

test("Revoked grant: a confirm is refused and the request stays pending (ADR 0082)", async () => {
  const f = await signedIn();
  try {
    const revoked = revokeRepresentativeGrant(f.server.environment);
    assert.ok(revoked.length > 0 && revoked.every((grant) => grant.revokedAtIso));
    assert.equal((await operatorPost(f.session, `/operator/requests/${f.requestId}/confirm`)).status, 409);
    assert.equal(status(f), "disclosed");
  } finally { await done(f); }
});
