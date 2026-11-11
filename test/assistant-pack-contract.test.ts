import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { COMMERCE_TEST_REFERENCE_KEYS, migrateCommerceDatabase } from "./helpers/commerce-database.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { createStubPack } from "./helpers/stub-domain-pack.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createInitialTaskState, type AssistantTaskState } from "../apps/local-guest/src/assistant/assistant-state.js";
import {
  AssistantPackRegistry,
  composeSystemInstruction,
  packAtRisk,
  renderPackSurface,
  scopeContextFor,
  type AssistantDomainPack,
} from "../apps/local-guest/src/assistant/assistant-platform.js";
import { createCommerceAssistantPack } from "../apps/local-guest/src/assistant/commerce-assistant-pack.js";
import { ASSISTANT_SYSTEM_INSTRUCTION, createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import type { PendingAssistantAction } from "../apps/local-guest/src/assistant/pending-actions.js";
import { GUEST_MODES } from "../apps/web-agent/src/guest-content.js";
import { bookingContractRenderArtifact, bookingRequestRenderArtifact, cardPaymentRenderArtifact, conditionalOfferRenderArtifact } from "./helpers/booking-render-fixtures.js";

// ADR 0107 decisions 1 and 3, ADR 0099 decision 4, ADR 0074, ADR 0104. Issue 03a (neutral pack contract).

/**
 * Recorded before the first code change of issue 03a: sha256 and length of `composeSystemInstruction(commercePack)`.
 * The commerce pack is not edited by this issue, so the composed instruction must not move (ADR 0104).
 */
const COMMERCE_COMPOSED_SHA256 = "fdfcac01229706caf06956f298d92fbd71dd93b72ac35abbc9456beeb348d8d2";
const COMMERCE_COMPOSED_LENGTH = 766;

function pendingAction(overrides: Partial<PendingAssistantAction> = {}): PendingAssistantAction {
  return {
    id: "pa-contract-1",
    threadId: "thread-contract",
    guestActorId: "guest-contract",
    tenantId: "tenant-contract",
    type: "request_to_book",
    authoritativeReferences: { stayRef: "stay-1", unitId: "unit-1", checkIn: "2026-11-20", checkOut: "2026-11-23", partySize: 2 },
    summary: "Request to book",
    createdAt: "2026-10-27T10:00:00.000Z",
    expiresAt: "2026-10-27T10:20:00.000Z",
    executed: false,
    ...overrides,
  };
}

function taskState(overrides: Partial<AssistantTaskState> = {}): AssistantTaskState {
  return { ...createInitialTaskState(), ...overrides };
}

test("AC1: A pack declaring a valid presentation registers; a pack whose presentation has an unknown key or an over-length string is refused at registration, and the error names the pack id and no value.", () => {
  const registry = new AssistantPackRegistry();
  registry.register({ ...createFakeShopPack(), presentation: GUEST_MODES.stays });
  assert.equal(registry.size, 1);

  const unknownKey = { ...GUEST_MODES.stays, sentinelField: "SENTINEL-UNKNOWN-KEY" } as unknown as typeof GUEST_MODES.stays;
  assert.throws(
    () => new AssistantPackRegistry().register({ ...createFakeShopPack(), presentation: unknownKey }),
    (error: unknown) => error instanceof Error && error.message.includes("shop") && !error.message.includes("SENTINEL-UNKNOWN-KEY"),
  );

  const longLabel = "SENTINEL-" + "x".repeat(400);
  const overLength = { ...GUEST_MODES.stays, label: longLabel };
  assert.throws(
    () => new AssistantPackRegistry().register({ ...createFakeShopPack(), presentation: overLength }),
    (error: unknown) => error instanceof Error && error.message.includes("shop") && !error.message.includes("SENTINEL-"),
  );
});

test("AC2: A pack that declares surfaces renders a declared stage kind; an undeclared kind returns no A2UI and does not fall through to a legacy method.", () => {
  const artifact = { marker: "artifact" };
  const pack: AssistantDomainPack = {
    ...createFakeShopPack(),
    surfaces: { booking_request: (value, surfaceId) => [{ declared: value, surfaceId }] },
    bookingRequestSurface: () => [{ legacy: true }],
    cardPaymentSurface: () => [{ legacy: true }],
  };

  assert.deepEqual(renderPackSurface(pack, "booking_request", artifact, "s-1"), [{ declared: artifact, surfaceId: "s-1" }]);
  assert.deepEqual(renderPackSurface(pack, "card_payment", artifact, "s-1"), [], "an undeclared kind renders nothing");
  assert.deepEqual(renderPackSurface(createFakeShopPack(), "booking_request", artifact, "s-1"), [], "a pack without booking methods renders nothing");
});

test("AC3: parseState returns undefined for an unknown shape and for a null or array input; a restore that cannot parse its state creates no task.", () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`pack_contract_parse_${Date.now()}.sqlite`) });
  try {
    const stays = createShortletAssistantPack(env);
    const parse = stays.parseState;
    assert.ok(parse, "the stays pack declares parseState");
    assert.equal(parse(null), undefined);
    assert.equal(parse([]), undefined);
    assert.equal(parse("not a state"), undefined);
    assert.equal(parse({ goal: "unknown_goal", stayIntent: {}, shortlist: [] }), undefined);
    assert.equal(parse({ goal: null, stayIntent: "text", shortlist: [] }), undefined);
    assert.deepEqual(parse(createInitialTaskState()), createInitialTaskState(), "a valid state is returned unchanged, never coerced");

    const fake = createFakeShopPack();
    assert.equal(fake.parseState?.(null), undefined);
    assert.equal(fake.parseState?.(["shop"]), undefined);
    assert.equal(fake.parseState?.({ items: "not a list" }), undefined);
  } finally {
    env.close();
  }
});

test("AC4: Without scopeFacts, the classifier context carries the three existing booleans unchanged; with scopeFacts on the fake pack, its facts reach ScopeContext.", () => {
  const withoutFacts = scopeContextFor(createStubPack(), taskState());
  assert.deepEqual(withoutFacts, {
    domain: "stub",
    description: "Stub",
    hasShortlist: false,
    hasSelectedStay: false,
    hasOffer: false,
  });
  assert.equal("facts" in withoutFacts, false);

  const shop = createFakeShopPack();
  const withFacts = scopeContextFor(shop, taskState({ currentDraftId: "draft-1" }));
  assert.deepEqual(withFacts.facts, { hasCart: true });
  assert.equal(withFacts.hasShortlist, false, "the three existing booleans are still supplied");
});

test("AC5: Without atRisk, packAtRisk returns true; with atRisk, the hook's answer is returned.", () => {
  assert.equal(packAtRisk(createStubPack(), taskState()), true, "absent hook fails closed");

  const alwaysSafe: AssistantDomainPack = { ...createStubPack(), atRisk: () => false };
  assert.equal(packAtRisk(alwaysSafe, taskState()), false);

  const alwaysRisky: AssistantDomainPack = { ...createStubPack(), atRisk: () => true };
  assert.equal(packAtRisk(alwaysRisky, taskState()), true);

  const fake = createFakeShopPack();
  assert.equal(packAtRisk(fake, taskState()), false, "the fake pack reports no risk without a proposal");
  assert.equal(packAtRisk(fake, taskState({ pendingAction: pendingAction() })), true, "the fake pack reports risk with an open proposal");
});

test("AC6: The commerce pack's composed instruction equals the value recorded before this issue.", () => {
  const database = new NodeSqliteDatabase(temporaryDatabasePath(`pack_contract_commerce_${Date.now()}.sqlite`));
  try {
    migrateCommerceDatabase(database);
    const commerce = createCommerceAssistantPack({
      paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS,
      database,
      clock: () => new Date("2026-10-27T10:00:00Z"),
    });
    const composed = composeSystemInstruction(commerce);
    assert.equal(composed.length, COMMERCE_COMPOSED_LENGTH);
    assert.equal(createHash("sha256").update(composed).digest("hex"), COMMERCE_COMPOSED_SHA256);
  } finally {
    database.close();
  }
});

test("AC7: The stays pack's composeSystemInstruction equals ASSISTANT_SYSTEM_INSTRUCTION, and its surfaces output equals the legacy methods' output for the same artifact.", () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`pack_contract_stays_${Date.now()}.sqlite`) });
  try {
    const stays = createShortletAssistantPack(env);
    assert.equal(composeSystemInstruction(stays), ASSISTANT_SYSTEM_INSTRUCTION);
    assert.equal(stays.presentation, GUEST_MODES.stays);

    const action = pendingAction();
    const legacy = stays.pendingActionSurface?.(action, "pending-surface");
    assert.ok(legacy && legacy.length > 0, "the legacy pending action renderer produces A2UI");
    assert.deepEqual(renderPackSurface(stays, "pending_action", action, "pending-surface"), legacy);

    assert.ok(stays.surfaces, "the stays pack declares surfaces");
    for (const kind of ["booking_request", "conditional_offer", "card_payment", "booking_contract"] as const) {
      assert.ok(Object.hasOwn(stays.surfaces, kind), `${kind} is declared`);
    }
    assert.deepEqual(stays.surfaces.pending_action?.(action, "pending-surface"), legacy, "the declared renderer matches the legacy method");
  } finally {
    env.close();
  }
});

test("AC7 (booking kinds, issue 03a carried into 03b): for booking_request, conditional_offer, card_payment and booking_contract, renderPackSurface equals the legacy method's output for the same artifact.", () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`pack_contract_booking_kinds_${Date.now()}.sqlite`) });
  try {
    const stays = createShortletAssistantPack(env);
    const cases = [
      { kind: "booking_request", artifact: bookingRequestRenderArtifact(), legacy: stays.bookingRequestSurface },
      { kind: "conditional_offer", artifact: conditionalOfferRenderArtifact(), legacy: stays.conditionalOfferSurface },
      { kind: "card_payment", artifact: cardPaymentRenderArtifact(), legacy: stays.cardPaymentSurface },
      { kind: "booking_contract", artifact: bookingContractRenderArtifact(), legacy: stays.bookingContractSurface },
    ] as const;
    for (const { kind, artifact, legacy } of cases) {
      const rendered = renderPackSurface(stays, kind, artifact, `surface-${kind}`);
      assert.ok(rendered.length > 0, `${kind} renders A2UI on the stays pack`);
      assert.deepEqual(rendered, legacy?.call(stays, artifact, `surface-${kind}`), `${kind}: the declared renderer matches the legacy method`);
    }
  } finally {
    env.close();
  }
});
