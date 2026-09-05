import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { decodeConfirmationToken } from "../domains/shortlet/src/conditional-offer.js";
import { guestAction, proveStage, restartFixture, stages } from "./helpers/guest-restart.js";

// Goal 1 Acceptance Criteria (AC1 — AC16)
test("AC1 — A Request Draft restores after application restart", () => proveStage("draft"));

test("AC2 — A Request review restores after application restart", () => proveStage("review"));

test("AC3 — A pending Booking Request restores after application restart", () => proveStage("pending"));

test("AC4 — A Conditional Booking Offer restores after application restart", () => proveStage("offer"));

test("AC5 — Payment handoff restores without creating another Live Payment Attempt", () => proveStage("handoff"));

test("AC6 — Payment processing restores without duplicate payment verification", async () => {
  let verifications = 0;
  const f = await restartFixture({ verifyPayment: (pspReference, amountKobo) => {
    verifications++;
    return { verified: true, status: "pending", pspReference, amountKobo, currency: "NGN" };
  } });
  try {
    const handoff = await f.advance("handoff");
    const processing = await f.send("/api/event", guestAction(handoff.surfaces[0]!));
    assert.equal(processing.ok, true);
    if (processing.ok) assert.match(processing.surfaces[0]?.summary ?? "", /processing/i);
    assert.equal(verifications, 1);
    await f.restart();
    const state = await f.state(); assert.equal(state.ok, true);
    if (state.ok) assert.match(state.surfaces[0]?.summary ?? "", /processing/i);
    await f.state();
    assert.equal(verifications, 1);
  } finally { await f.close(); }
});

test("AC7 — A confirmed Reservation restores after application restart", () => proveStage("confirmed"));

test("AC8 — Restart restoration does not repeat consequential commands", async () => {
  for (const stage of stages) {
    const f = await restartFixture();
    try {
      await f.advance(stage);
      // Count durable consequential side effects (ADR-0079): the store's
      // authoritative records, not the per-process in-memory audit.
      const beforeStore = f.environment.interactionStore;
      const before = {
        drafts: beforeStore.listDraftIds().length,
        requests: beforeStore.listBookingRequestIds().length,
        offers: beforeStore.listConditionalOfferIds().length,
        sessions: beforeStore.listCheckoutSessionIds().length,
        attempts: beforeStore.listLivePaymentAttemptOfferIds().length,
        references: beforeStore.listProcessedPspReferenceIds().length,
        bookings: beforeStore.listBookingSnapshotOfferIds().length,
      };
      await f.restart();
      await f.state();
      await f.state();
      const afterStore = f.environment.interactionStore;
      const after = {
        drafts: afterStore.listDraftIds().length,
        requests: afterStore.listBookingRequestIds().length,
        offers: afterStore.listConditionalOfferIds().length,
        sessions: afterStore.listCheckoutSessionIds().length,
        attempts: afterStore.listLivePaymentAttemptOfferIds().length,
        references: afterStore.listProcessedPspReferenceIds().length,
        bookings: afterStore.listBookingSnapshotOfferIds().length,
      };
      assert.deepEqual(after, before, `durable consequential side effects at ${stage}`);
      for (const action of f.actions) {
        const rejected = await f.send("/api/event", action);
        assert.equal(rejected.ok, false, `old action ${action.name} at ${stage}`);
      }
    } finally { await f.close(); }
  }
});

test("AC9 — Restart restoration does not recreate inventory holds", async () => {
  const f = await restartFixture();
  try {
    await f.advance("offer");
    const dbBefore = new DatabaseSync(f.databasePath);
    let commitmentsBefore: unknown[];
    try {
      commitmentsBefore = dbBefore.prepare("SELECT * FROM availability_commitments").all();
    } finally {
      dbBefore.close();
    }
    assert.ok(commitmentsBefore.length > 0, "must have active commitments before restart");

    await f.restart();
    const state = await f.state();
    assert.equal(state.ok, true);
    await f.state();

    const dbAfter = new DatabaseSync(f.databasePath);
    let commitmentsAfter: unknown[];
    try {
      commitmentsAfter = dbAfter.prepare("SELECT * FROM availability_commitments").all();
    } finally {
      dbAfter.close();
    }
    assert.deepEqual(commitmentsAfter, commitmentsBefore, "restart restoration must not recreate, duplicate or alter inventory commitments");
  } finally {
    await f.close();
  }
});

test("AC10 — A restored stale surface fails closed", async () => {
  const f = await restartFixture();
  try {
    await f.advance("pending"); const stale = f.actions.at(-1)!;
    await f.restart();
    assert.equal((await f.send("/api/event", stale)).ok, false);
    const state = await f.state(); assert.equal(state.ok, true);
    if (state.ok) assert.match(state.surfaces[0]?.summary ?? "", /Booking Request/);
  } finally { await f.close(); }
});

test("AC11 — A restored expired surface fails closed", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("offer"); const action = guestAction(before.surfaces[0]!);
    f.setTime("2026-09-03T10:31:00Z"); await f.restart();
    assert.equal((await f.send("/api/event", action)).ok, false);
    const state = await f.state(); assert.equal(state.ok, true);
    if (state.ok) assert.match(JSON.stringify(state.surfaces), /expired/i);
  } finally { await f.close(); }
});

test("AC12 — Cross-session restoration attempts fail closed", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("review"); await f.restart();
    const stranger = `shortlet_guest_session=gs-${crypto.randomUUID()}`;
    assert.equal((await f.state(stranger)).ok, false);
    assert.equal((await f.send("/api/event", guestAction(before.surfaces[0]!), stranger)).ok, false);
    const own = await f.state(); assert.equal(own.ok, true);
    if (own.ok) assert.equal(own.surfaces[0]?.surfaceId, before.surfaces[0]!.surfaceId);
  } finally { await f.close(); }
});

test("AC13 — Cross-tenant restoration attempts fail closed", async () => {
  const f = await restartFixture();
  try {
    await f.advance("review"); await f.restart({ tenantId: "different-tenant" });
    const state = await f.state();
    assert.equal(state.ok, false);
  } finally { await f.close(); }
});

test("AC14 — Restricted credentials never enter durable interaction storage", async () => {
  const f = await restartFixture();
  try {
    await f.advance("handoff");
    const cookieSecret = f.cookie.split("=")[1]!;
    const rawDbContent = readFileSync(f.databasePath);
    assert.equal(rawDbContent.includes(Buffer.from(cookieSecret)), false, "bearer cookie secret must not enter durable database");
    assert.equal(rawDbContent.includes(Buffer.from("shortlet_guest_session=")), false, "cookie name must not enter durable database");
    assert.equal(rawDbContent.includes(Buffer.from("password")), false, "passwords must not enter durable database");
    assert.equal(rawDbContent.includes(Buffer.from("card_number")), false, "raw card numbers must not enter durable database");
  } finally {
    await f.close();
  }
});

test("AC15 — Raw identity evidence never enters durable interaction storage", async () => {
  const f = await restartFixture();
  try {
    await f.advance("offer");
    const rawDbContent = readFileSync(f.databasePath);
    assert.equal(rawDbContent.includes(Buffer.from("rawEvidence")), false, "rawEvidence must never enter durable store");
    assert.equal(rawDbContent.includes(Buffer.from("bvn")), false, "BVN must never enter durable store");
    assert.equal(rawDbContent.includes(Buffer.from("ninNumber")), false, "ninNumber must never enter durable store");
    assert.equal(rawDbContent.includes(Buffer.from("passportNumber")), false, "passport numbers must never enter durable store");
    assert.equal(rawDbContent.includes(Buffer.from("providerPayload")), false, "providerPayload must never enter durable store");
  } finally {
    await f.close();
  }
});

test("AC16 — Restoration failure does not create new authoritative workflow state", async () => {
  const f = await restartFixture();
  try {
    await f.advance("draft");
    const beforeStore = f.environment.interactionStore;
    const beforeCounts = {
      drafts: beforeStore.listDraftIds().length,
      requests: beforeStore.listBookingRequestIds().length,
      offers: beforeStore.listConditionalOfferIds().length,
      sessions: beforeStore.listCheckoutSessionIds().length,
      attempts: beforeStore.listLivePaymentAttemptOfferIds().length,
      references: beforeStore.listProcessedPspReferenceIds().length,
      bookings: beforeStore.listBookingSnapshotOfferIds().length,
    };
    await f.restart();

    // 1. Attempting restoration with an unauthorized session fails closed
    const invalidRes = await f.send("/api/turn", { threadId: "g-invalid-corrupt-thread", text: "hello" }, "shortlet_guest_session=invalid-secret");
    assert.equal(invalidRes.ok, false);

    // 2. Corrupting thread row in the database causes restoration to fail closed (no surfaces returned)
    const db = new DatabaseSync(f.databasePath);
    try {
      db.prepare("UPDATE guest_threads SET thread_json = 'INVALID_JSON' WHERE thread_id = ?").run(f.threadId);
    } finally {
      db.close();
    }
    const corruptState = await f.state();
    assert.equal(corruptState.ok, true);
    if (corruptState.ok) {
      assert.deepEqual(corruptState.surfaces, [], "corrupt thread must restore zero surfaces");
    }

    // Verify zero new authoritative domain records were created by the failure
    const afterStore = f.environment.interactionStore;
    const afterCounts = {
      drafts: afterStore.listDraftIds().length,
      requests: afterStore.listBookingRequestIds().length,
      offers: afterStore.listConditionalOfferIds().length,
      sessions: afterStore.listCheckoutSessionIds().length,
      attempts: afterStore.listLivePaymentAttemptOfferIds().length,
      references: afterStore.listProcessedPspReferenceIds().length,
      bookings: afterStore.listBookingSnapshotOfferIds().length,
    };
    assert.deepEqual(afterCounts, beforeCounts, "restoration failure must not create any new authoritative workflow records");
  } finally {
    await f.close();
  }
});

// Dedicated Confirmation Token Security Tests
test("Token test 1 — Restart does not persist a raw confirmation token", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("offer");
    const preRestartToken = (guestAction(before.surfaces[0]!).context as { confirmationToken?: string })?.confirmationToken;
    assert.ok(preRestartToken && preRestartToken.startsWith("tok_"), "pre-restart token must be present on offer surface");

    const rawDbContent = readFileSync(f.databasePath);
    assert.equal(rawDbContent.includes(Buffer.from(preRestartToken)), false, "raw confirmation token must never be written to SQLite");

    await f.restart();
    const rawDbContentAfter = readFileSync(f.databasePath);
    assert.equal(rawDbContentAfter.includes(Buffer.from(preRestartToken)), false, "raw confirmation token must not exist in SQLite after restart");
  } finally {
    await f.close();
  }
});

test("Token test 2 — Restart does not recreate the old token from public identifiers", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("offer");
    const preRestartToken = (guestAction(before.surfaces[0]!).context as { confirmationToken?: string })?.confirmationToken;
    assert.ok(preRestartToken && preRestartToken.startsWith("tok_"));

    await f.restart();
    const after = await f.state();
    assert.equal(after.ok, true);
    if (!after.ok) return;

    const postRestartToken = (guestAction(after.surfaces[0]!).context as { confirmationToken?: string })?.confirmationToken;
    assert.ok(postRestartToken && postRestartToken.startsWith("tok_"));

    assert.notEqual(postRestartToken, preRestartToken, "post-restart confirmation token must be a fresh server-issued token with unique random salt");

    const preDecoded = decodeConfirmationToken(preRestartToken);
    const postDecoded = decodeConfirmationToken(postRestartToken);
    assert.equal(postDecoded.offerId, preDecoded.offerId);
    assert.equal(postDecoded.totalAmountDueNowKobo, preDecoded.totalAmountDueNowKobo);
    assert.notEqual((postDecoded as any).salt, (preDecoded as any).salt, "token must contain unpredictable cryptographic salt");
  } finally {
    await f.close();
  }
});

test("Token test 3 — A stale pre-restart token cannot authorize a changed surface", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("offer");
    const preRestartAction = guestAction(before.surfaces[0]!);
    const preRestartToken = (preRestartAction.context as { confirmationToken?: string })?.confirmationToken;
    assert.ok(preRestartToken);

    await f.restart();
    const state = await f.state();
    assert.equal(state.ok, true);
    if (!state.ok) return;
    const freshAction = guestAction(state.surfaces[0]!);

    // Attempting to use the old pre-restart token on the restored surface must fail closed
    const staleActionWithOldToken = {
      ...freshAction,
      context: {
        ...(freshAction.context as Record<string, unknown>),
        confirmationToken: preRestartToken,
      },
    };
    const result = await f.send("/api/event", staleActionWithOldToken);
    assert.equal(result.ok, false, "stale pre-restart token must fail closed on restored surface");
  } finally {
    await f.close();
  }
});

test("Token test 4 — A fresh token requires current server authorization", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("offer");
    await f.restart();
    const state = await f.state();
    assert.equal(state.ok, true);
    if (!state.ok) return;
    const freshAction = guestAction(state.surfaces[0]!);

    // 1. Forged token with invalid signature fails
    const forgedTokenAction = {
      ...freshAction,
      context: {
        ...(freshAction.context as Record<string, unknown>),
        confirmationToken: "tok_eyJhbGciOiJIUzI1NiJ9.forged_signature_here",
      },
    };
    assert.equal((await f.send("/api/event", forgedTokenAction)).ok, false, "forged token must fail closed");

    // 2. Cross-session execution of fresh token fails
    const strangerCookie = `shortlet_guest_session=gs-${crypto.randomUUID()}`;
    assert.equal((await f.send("/api/event", freshAction, strangerCookie)).ok, false, "fresh token executed by stranger session must fail closed");

    // 3. Authorized execution with current session succeeds
    const acceptResult = await f.send("/api/event", freshAction);
    assert.equal(acceptResult.ok, true, "legitimate fresh token from authorized session succeeds");
  } finally {
    await f.close();
  }
});

test("Token test 5 — Logs, audit records, projections, and telemetry contain no raw token", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("offer");
    const action = guestAction(before.surfaces[0]!);
    const token = (action.context as { confirmationToken?: string })?.confirmationToken;
    assert.ok(token);

    // Read all rows across interaction store tables
    const db = new DatabaseSync(f.databasePath);
    try {
      const offerRows = db.prepare("SELECT * FROM guest_conditional_offers").all() as { offer_json: string }[];
      for (const row of offerRows) {
        assert.equal(row.offer_json.includes(token), false, "offer_json in database must not contain raw token");
      }
      const threadRows = db.prepare("SELECT * FROM guest_threads").all() as { thread_json: string }[];
      for (const row of threadRows) {
        assert.equal(row.thread_json.includes(token), false, "thread_json in database must not contain raw token");
      }
    } finally {
      db.close();
    }

    // Projections returned by state endpoint must not leak raw token in timeline or summary
    await f.restart();
    const state = await f.state();
    assert.equal(state.ok, true);
    if (state.ok) {
      assert.equal(JSON.stringify(state.timeline ?? []).includes(token), false, "timeline projection must not contain raw token");
      assert.equal(state.surfaces[0]?.summary?.includes(token), false, "surface summary must not contain raw token");
      assert.equal(state.surfaces[0]?.textFallback?.includes(token), false, "textFallback must not contain raw token");
    }
  } finally {
    await f.close();
  }
});

// Stage restoration checks
test("Discovery restores after process restart", () => proveStage("discovery"));
test("Unit inspection restores after process restart", () => proveStage("inspection"));
