import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { createConfirmationToken, decodeConfirmationToken } from "../domains/shortlet/src/index.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner, trueRestartedDatedApp, type DatedFixture } from "./helpers/guest-date-fixtures.js";

// Defect C (checkout investigation, 26bafd5): the Conditional Offer confirmation token was regenerated with a random salt
// whenever a new ConditionalOfferManager loaded the offer, so the token the browser held after a restore no longer matched.
// Owner decision (Option 2): only a SHA-256 digest of each issued token is persisted (ADR 0086: "stored only as a secure
// hash"). A presented token is accepted only when its digest is one of the offer's valid digests (ADR 0106: the gate stays
// authoritative and fails closed). Every test here runs a TRUE restart: a new LocalGuestEnvironment over the same SQLite
// file before each event, so the ConditionalOfferManager and its cache are rebuilt, as on the Worker.

const THREAD = "g-d1a0000401";
const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const PHONE = "+234 801 234 5678";
const SCRIPT = {
  [STAY_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: STAY_SEARCH },
};

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }

/** A true restart followed by the page load that precedes every event. */
function restart(f: DatedFixture, diagnostics?: AssistantDiagnosticEvent[]): DatedFixture {
  return trueRestartedDatedApp(f, scriptedPlanner({}).client, diagnostics);
}

/** A fresh conversation from search to an issued Conditional Offer, with a true restart before every event. */
async function issuedOffer(diagnostics?: AssistantDiagnosticEvent[]): Promise<{ current: DatedFixture; offer: Surface }> {
  let current = datedFixture(scriptedPlanner(SCRIPT).client, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const search = successOf(await current.app.handleTurn(THREAD, STAY_TEXT), "search");
  const tap = async (surface: Surface, label: string): Promise<GuestTurnSuccess> => {
    current = restart(current, diagnostics);
    return successOf(await current.app.handleEventAsync(THREAD, firstButtonAction(surface)), label);
  };
  const detail = await tap(search.surfaces[0]!, "View");
  const draft = await tap(detail.surfaces[0]!, "Request to Book");
  const phoneAsk = await tap(draft.surfaces[0]!, "Review request");
  const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
  current = restart(current, diagnostics);
  const saved = successOf(await current.app.handleEventAsync(THREAD, { ...phoneSave, context: { ...phoneSave.context, contactValue: PHONE } }), "Save phone");
  const sent = await tap(saved.surfaces[0]!, "Send booking request");
  const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
  current.environment.simulateOperatorAcceptance(requestId);
  current = restart(current, diagnostics);
  const state = current.app.getState(THREAD);
  assert.ok(state, "the conversation is readable after acceptance");
  const offer = state.surfaces[0];
  assert.ok(offer, "the request shows its offer");
  assert.match(offer.summary ?? "", /Offer/i, "the request shows its offer");
  return { current, offer: offer as Surface };
}

/** The accept action exactly as the guest's surface carries it: the browser-held token. */
function heldAccept(surface: Surface) {
  const action = firstButtonAction(surface);
  return {
    action,
    offerId: String(action.context.offerId),
    confirmationToken: String(action.context.confirmationToken),
    offerVersion: Number(action.context.offerVersion),
  };
}

function storedOfferRecord(f: DatedFixture, offerId: string): { readonly offer_json: string } {
  const row = f.environment.database
    .prepare("SELECT offer_json FROM guest_conditional_offers WHERE offer_id = $offerId")
    .get({ $offerId: offerId }) as { offer_json: string } | undefined;
  assert.ok(row, "the offer is persisted");
  return row;
}

test("a token the browser holds before a true restart is accepted after it, and payment is ready", async () => {
  const { current, offer } = await issuedOffer();
  try {
    const held = heldAccept(offer);
    const next = restart(current);
    const accepted = successOf(await next.app.handleEventAsync(THREAD, held.action), "Accept with the held token");
    assert.match(accepted.surfaces[0]!.summary ?? "", /payment/i, "accepting the held token opens payment");
    next.close();
  } finally { current.close(); }
});

test("a token issued by one environment is accepted by a restarted environment over the same database file", async () => {
  const { current, offer } = await issuedOffer();
  const held = heldAccept(offer);
  const next = restart(current);
  try {
    const principal = next.environment.guestPrincipal();
    next.environment.conditionalOfferApp.accept({ offerId: held.offerId, confirmationToken: held.confirmationToken, expectedVersion: held.offerVersion, principal });
    assert.equal(next.environment.conditionalOfferApp.getArtifact(held.offerId, principal).facts.status, "accepted");
  } finally { next.close(); }
});

test("a second Accept with the same token is rejected after a restore (single use)", async () => {
  const { current, offer } = await issuedOffer();
  const held = heldAccept(offer);
  const first = restart(current);
  try {
    successOf(await first.app.handleEventAsync(THREAD, held.action), "first Accept");
    const second = restart(first);
    try {
      const replay = await second.app.handleEventAsync(THREAD, held.action);
      assert.equal(replay.ok, false, "the replayed token must not accept again");
    } finally { second.close(); }
  } finally { first.close(); }
});

test("a forged token is rejected after a restore and the offer stays issued", async () => {
  const { current, offer } = await issuedOffer();
  const held = heldAccept(offer);
  const next = restart(current);
  try {
    const forged = { ...held.action, context: { ...held.action.context, confirmationToken: `tok_${Buffer.from("{}").toString("base64url")}.00` } };
    const rejected = await next.app.handleEventAsync(THREAD, forged);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.ok ? "" : rejected.code, "ACTION_NOT_AUTHORIZED");
    const principal = next.environment.guestPrincipal();
    assert.equal(next.environment.conditionalOfferApp.getArtifact(held.offerId, principal).facts.status, "issued");
  } finally { next.close(); }
});

test("a token whose claims name another offer is rejected after a restore", async () => {
  const { current, offer } = await issuedOffer();
  const held = heldAccept(offer);
  const claims = decodeConfirmationToken(held.confirmationToken);
  const otherOffer = createConfirmationToken({ ...claims, offerId: "offer-someone-else" });
  const next = restart(current);
  try {
    const rejected = await next.app.handleEventAsync(THREAD, { ...held.action, context: { ...held.action.context, confirmationToken: otherOffer } });
    assert.equal(rejected.ok, false);
  } finally { next.close(); }
});

test("an offer whose payment window has passed rejects its token after a restore", async () => {
  const { current, offer } = await issuedOffer();
  const held = heldAccept(offer);
  const late = trueRestartedDatedApp(current, scriptedPlanner({}).client, undefined, { clock: () => new Date("2026-10-27T14:00:00Z") });
  try {
    assert.throws(
      () => late.environment.conditionalOfferApp.accept({ offerId: held.offerId, confirmationToken: held.confirmationToken, expectedVersion: held.offerVersion, principal: late.environment.guestPrincipal() }),
      /expired|window/i,
    );
  } finally { late.close(); }
});

test("the token and its salt never reach the database or diagnostics; only a SHA-256 digest is persisted", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const { current, offer } = await issuedOffer(diagnostics);
  try {
    const held = heldAccept(offer);
    const json = storedOfferRecord(current, held.offerId).offer_json;
    const salt = (decodeConfirmationToken(held.confirmationToken) as unknown as { salt?: unknown }).salt;
    assert.equal(json.includes(held.confirmationToken), false, "the stored offer never holds the token");
    assert.equal(typeof salt === "string" && json.includes(salt), false, "nothing persisted holds the salt that would recompute the token");
    const digest = createHash("sha256").update(held.confirmationToken).digest("hex");
    assert.ok((JSON.parse(json).confirmationTokenDigests as string[]).includes(digest), "the stored offer holds the SHA-256 digest of the issued token");
    assert.equal(JSON.stringify(diagnostics).includes(held.confirmationToken), false, "diagnostics never carry the token");
  } finally { current.close(); }
});

test("the set of valid token digests stays bounded across many restores, and the newest token still accepts", async () => {
  const { current, offer } = await issuedOffer();
  const held = heldAccept(offer);
  let next = current;
  for (let i = 0; i < 40; i += 1) next = restart(next);
  try {
    const digests = JSON.parse(storedOfferRecord(next, held.offerId).offer_json).confirmationTokenDigests as string[];
    assert.ok(digests.length >= 1 && digests.length <= 16, `digests bounded to 16, saw ${digests.length}`);
    const principal = next.environment.guestPrincipal();
    const latest = next.environment.conditionalOfferApp.getArtifact(held.offerId, principal).actions[0];
    assert.ok(latest, "the restored offer still offers Accept");
    next.environment.conditionalOfferApp.accept({ offerId: held.offerId, confirmationToken: latest.confirmationToken, expectedVersion: held.offerVersion, principal });
    assert.equal(next.environment.conditionalOfferApp.getArtifact(held.offerId, principal).facts.status, "accepted");
  } finally { next.close(); }
});
