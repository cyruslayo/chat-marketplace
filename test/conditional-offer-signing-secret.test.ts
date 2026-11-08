import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createConfirmationToken, decodeConfirmationToken } from "../domains/shortlet/src/conditional-offer.js";
import { loadPilotCoreConfiguration } from "../apps/pilot/src/pilot-config-core.js";
import { loadCloudflareConfiguration, type CloudflareEnv } from "../apps/cloudflare/src/cloudflare-config.js";
import { DEMO_STAGING_SOURCE } from "./helpers/demo-mode-fixture.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, trueRestartedDatedApp, scriptedPlanner } from "./helpers/guest-date-fixtures.js";

const KEY_A = "local-test-offer-key-A-0123456789abcdef";
const KEY_B = "local-test-offer-key-B-0123456789abcdef";
const payload = { actorId: "guest-test", tenantId: "tenant-test", offerId: "offer-test", offerVersion: 1, quoteVersion: "quote-v1", totalAmountDueNowKobo: 42_000, expiresAt: "2026-12-14T12:00:00Z" };

test("AC1: No source file outside tests contains the literal conditional_offer_secret", () => {
  const inspect = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = `${path}/${entry.name}`;
      if (entry.isDirectory()) inspect(file);
      else if (/\.(?:ts|js|mjs|mts)$/.test(entry.name)) assert.equal(readFileSync(file, "utf8").includes("conditional_offer_secret"), false, file);
    }
  };
  for (const root of ["domains/shortlet/src", "apps/local-guest/src", "apps/local-owner/src", "apps/web/src", "apps/pilot/src", "apps/cloudflare/src"]) inspect(root);
});

test("AC2: A token signed with one key fails verification under another key", () => {
  const token = createConfirmationToken(payload, KEY_A);
  const decoded = decodeConfirmationToken(token, KEY_A);
  assert.deepEqual(Object.fromEntries(Object.entries(decoded).filter(([name]) => name !== "salt")), payload);
  assert.ok("salt" in decoded);
  assert.throws(() => decodeConfirmationToken(token, KEY_B), /signature|Invalid confirmation token/i);
  assert.throws(() => decodeConfirmationToken(`${token}tampered`, KEY_A), /signature|Invalid confirmation token/i);
});

test("AC3 failure path: staging and production startup refuse a missing or short key", () => {
  const production = { ...DEMO_STAGING_SOURCE, SHORTLET_DEPLOYMENT: "production", SHORTLET_DEMO: "disabled", PAYSTACK_SECRET_KEY: "sk_live_offline-only", PAYSTACK_ENVIRONMENT: "live" };
  for (const source of [DEMO_STAGING_SOURCE, production]) {
    for (const key of [undefined, "short-key", "x".repeat(31)]) {
      const settings = { ...source, SHORTLET_CONDITIONAL_OFFER_KEY: key };
      assert.throws(() => loadPilotCoreConfiguration(settings), /SHORTLET_CONDITIONAL_OFFER_KEY/);
      assert.throws(() => loadCloudflareConfiguration(settings as unknown as CloudflareEnv), /SHORTLET_CONDITIONAL_OFFER_KEY/);
    }
    assert.equal(loadPilotCoreConfiguration({ ...source, SHORTLET_CONDITIONAL_OFFER_KEY: KEY_A }).conditionalOfferSigningKey, KEY_A);
  }
});

test("AC4: An offer issued before a cold restore can still be accepted after it with the same configured key", async () => {
  const text = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
  const planner = scriptedPlanner({ [text]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } } });
  let current = datedFixture(planner.client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true, conditionalOfferSigningKey: KEY_A });
  assert.equal(current.environment.config.conditionalOfferSigningKey, KEY_A);
  const threadId = "g-d1a0000399";
  const cold = () => { current = trueRestartedDatedApp(current, scriptedPlanner({}).client); current.app.getState(threadId); return current.app; };
  const tap = async (surface: { surfaceId: string; a2uiMessages: readonly unknown[] }) => {
    const result = await cold().handleEventAsync(threadId, firstButtonAction(surface));
    assert.equal(result.ok, true, result.ok ? "" : result.code);
    if (!result.ok) throw new Error("unreachable");
    return result;
  };
  try {
    const search = await current.app.handleTurn(threadId, text);
    assert.equal(search.ok, true);
    if (!search.ok) throw new Error("unreachable");
    const detail = await tap(search.surfaces[0]!);
    const draft = await tap(detail.surfaces[0]!);
    const phoneAsk = await tap(draft.surfaces[0]!);
    const save = firstButtonAction(phoneAsk.surfaces[0]!);
    const saved = await cold().handleEventAsync(threadId, { ...save, context: { ...save.context, contactValue: "+234 801 234 5678" } });
    assert.equal(saved.ok, true);
    if (!saved.ok) throw new Error("unreachable");
    const sent = await tap(saved.surfaces[0]!);
    const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
    current.environment.simulateOperatorAcceptance(requestId);
    const offer = cold().getState(threadId);
    assert.ok(offer);
    const heldAction = firstButtonAction(offer.surfaces[0]!);
    const heldToken = String(heldAction.context.confirmationToken);
    assert.ok(heldToken.startsWith("tok_"));
    const issuedOfferId = String(heldAction.context.offerId);
    assert.equal(current.environment.conditionalOfferApp.getArtifact(issuedOfferId, current.environment.guestPrincipal()).facts.status, "issued");
    const payment = await tap(offer.surfaces[0]!);
    assert.match(payment.surfaces[0]!.summary ?? "", /payment/i);
    assert.equal(current.environment.conditionalOfferApp.getArtifact(issuedOfferId, current.environment.guestPrincipal()).facts.status, "accepted");
    const replay = await cold().handleEventAsync(threadId, heldAction);
    assert.equal(replay.ok, false, "the accepted token cannot be replayed after another cold restore");
  } finally { current.close(); }
});
