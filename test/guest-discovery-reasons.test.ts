import test from "node:test";
import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@weaver/core";
import { discoveryArtifactToA2UI, fitReasons, formatGuestDate, guestAmenityLabel, type DiscoveryUnitProjection } from "../apps/web-agent/src/index.js";
import { INDICATIVE_RATES_DISCLOSURE } from "../domains/shortlet/src/browse.js";
import type { GuestTurnResult } from "../apps/local-guest/src/guest-server.js";
import { restartFixture } from "./helpers/guest-restart.js";

function success(result: GuestTurnResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function texts(messages: readonly A2UIServerMessage[]): string[] {
  const update = messages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  return ((update?.updateComponents.components ?? []) as readonly { text?: string }[]).flatMap((component) => typeof component.text === "string" ? [component.text] : []);
}

const DATED = { location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2 } as const;

test("AC1: Every fit reason can be traced to a unit field. Units without data show no reason.", async () => {
  const fixture = await restartFixture();
  try {
    const artifact = fixture.environment.discoveryQuery.search({ ...DATED, bedrooms: 2 });
    assert.ok(artifact.facts.results.length > 0);
    for (const unit of artifact.facts.results) {
      const reasons = fitReasons(unit, artifact.facts.filters);
      assert.ok(reasons.length <= 3, "at most three reasons");
      for (const reason of reasons) {
        // Each reason is re-derived from the field it names.
        if (reason.source === "capacity") assert.match(reason.text, unit.capacity === 2 ? /^Sleeps 2 exactly$/ : new RegExp(`^Room for 2 \\(sleeps ${unit.capacity}\\)$`));
        else if (reason.source === "bedrooms") assert.equal(reason.text, `${unit.bedrooms} bedrooms, as asked`);
        else if (reason.source === "amenities") assert.ok(unit.amenities.some((amenity: string) => guestAmenityLabel(amenity) === reason.text), reason.text);
        else assert.equal(reason.text, `Physically inspected ${formatGuestDate(unit.trust.inspection.inspectedAt)}`);
      }
      const card = texts(discoveryArtifactToA2UI({ artifact, surfaceId: "s" })).find((text) => text.startsWith("Why it fits:"));
      assert.ok(card, "the card shows its reasons");
    }
    const ikoyi = artifact.facts.results.find((unit) => unit.id === "unit-lagos-ikoyi-001")!;
    assert.deepEqual(fitReasons(ikoyi, artifact.facts.filters).map((reason) => reason.source), ["capacity", "bedrooms", "amenities"]);
  } finally { await fixture.close(); }

  // Failure path: a unit without the data, against a search without the criteria, has no reason and no line.
  const bare: DiscoveryUnitProjection = {
    id: "unit-bare", title: "Bare flat", location: { city: "Lagos", neighbourhood: "Yaba" }, capacity: 2, bathrooms: 1, description: "", amenities: ["wifi"], photoUrls: [],
    price: { nightlyKobo: 1, allInStayTotalKobo: 3, mandatoryFeesKobo: 0, refundableSecurityDepositKobo: 0, amountDueNowKobo: 3, currency: "NGN", pricingVersion: "v1" },
    trust: { inspection: { status: "expired", inspectedAt: "2025-01-01", expiresAt: "2026-01-01", scope: [] }, managementAuthority: { status: "current", verifiedAt: "2026-01-01" }, occupancyModel: "entire-place" },
  };
  assert.deepEqual(fitReasons(bare, { location: "Lagos" }), []);
  assert.deepEqual(fitReasons(bare, { partySize: 3 }), [], "too small for the party is not a fit");
  assert.deepEqual(fitReasons({ ...bare, bedrooms: 1 }, { bedrooms: 2 }), [], "a different bedroom count is not a fit");
  const artifact = { id: "a", kind: "k", schemaVersion: "v", projectionVersion: 1, domainReferences: [], policyVersions: {}, disclosures: [], facts: { filters: { location: "Lagos" }, results: [bare] }, amounts: [], actions: [], acknowledgements: [], sensitivity: "public" };
  assert.equal(texts(discoveryArtifactToA2UI({ artifact, surfaceId: "s" })).some((text) => text.startsWith("Why it fits:")), false);
});

test("AC2: The footnote is absent when dates and party size are known", async () => {
  const fixture = await restartFixture();
  try {
    const dated = fixture.environment.discoveryQuery.search(DATED);
    assert.deepEqual(dated.disclosures, []);
    assert.equal(texts(discoveryArtifactToA2UI({ artifact: dated, surfaceId: "s" })).some((text) => /indicative/i.test(text)), false);
    const turn = success(await fixture.send("/api/turn", { text: "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people" }));
    assert.doesNotMatch(JSON.stringify(turn.surfaces[0]!.a2uiMessages), /Rates without dates/);

    // Failure paths: without dates, or with dates but no party size, the caveat stays.
    assert.deepEqual(fixture.environment.discoveryQuery.search({ location: "Lagos" }).disclosures, [INDICATIVE_RATES_DISCLOSURE]);
    assert.deepEqual(fixture.environment.discoveryQuery.search({ location: "Lagos", checkIn: DATED.checkIn, checkOut: DATED.checkOut }).disclosures, [INDICATIVE_RATES_DISCLOSURE]);
  } finally { await fixture.close(); }
});

test("AC3: After a clarify reply, the quick replies match the missing criterion", async () => {
  const fixture = await restartFixture();
  const cases = [
    { prefix: [] as string[], opener: "hello, I need a place", asks: /where you want to stay/, filled: "where" },
    { prefix: [], opener: "I need a place in Lagos", asks: /how many guests/, filled: "guests" },
    { prefix: [], opener: "I need a place in Lagos for 2 guests", asks: /what date you arrive/, filled: "when" },
    { prefix: [], opener: "I need a place in Lagos for 2 guests from 10 Sept", asks: /how many nights/, filled: "nights" },
  ] as const;
  try {
    for (const scenario of cases) {
      const threadId = `g-${crypto.randomUUID()}`;
      const clarify = success(await fixture.send("/api/turn", { threadId, text: scenario.opener }));
      assert.match(clarify.messages.join(" "), scenario.asks);
      const replies = clarify.quickReplies ?? [];
      assert.ok(replies.length >= 3, `${scenario.filled}: offers quick replies`);
      // Each quick reply, sent as the next message, answers exactly that question.
      for (const reply of replies) {
        const fork = `g-${crypto.randomUUID()}`;
        success(await fixture.send("/api/turn", { threadId: fork, text: scenario.opener }));
        const answered = success(await fixture.send("/api/turn", { threadId: fork, text: reply }));
        const criteria = answered.criteria;
        if (scenario.filled === "where") assert.ok(criteria?.where, reply);
        else if (scenario.filled === "guests") assert.ok(criteria?.guests, reply);
        else if (scenario.filled === "when") assert.ok(criteria?.when?.checkIn, reply);
        else assert.ok(criteria?.when?.nights, reply);
        assert.doesNotMatch(answered.messages.join(" "), scenario.asks, `${reply} answered the question`);
      }
    }
    // Failure paths: a search result and a limit refusal ask nothing, so they offer no quick replies.
    const searched = success(await fixture.send("/api/turn", { text: "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people" }));
    assert.equal(searched.quickReplies, undefined);
    const refused = success(await fixture.send("/api/turn", { threadId: `g-${crypto.randomUUID()}`, text: "Lagos, 2 guests, from 10 Sept for 20 nights" }));
    assert.match(refused.messages.join(" "), /at most 14 nights/);
    assert.equal(refused.quickReplies, undefined);
  } finally { await fixture.close(); }
});
