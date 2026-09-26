import test from "node:test";
import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@weaver/core";
import { discoveryArtifactToA2UI, type DiscoveryArtifactProjection } from "../apps/web-agent/src/index.js";
import { extractStayRequestFacts } from "../apps/local-guest/src/concierge.js";
import { CRITERIA_EDIT_EVENT, CRITERIA_UNDO_EVENT, criteriaSurfaceId, type GuestSurfacePayload, type GuestTurnResult } from "../apps/local-guest/src/guest-server.js";
import { restartFixture } from "./helpers/guest-restart.js";

type Fixture = Awaited<ReturnType<typeof restartFixture>>;
const IKOYI = "unit-lagos-ikoyi-001"; // All-In Stay Total ₦370,000, deposit ₦20,000 (10–13 Sept, 2 guests)
const LEKKI = "unit-lagos-lekki-002"; // All-In Stay Total ₦200,000, deposit ₦10,000
const LAGOS = "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people";

function success(result: GuestTurnResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function texts(messages: readonly A2UIServerMessage[]): { readonly id: string; readonly text: string }[] {
  const update = messages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  return ((update?.updateComponents.components ?? []) as readonly { id: string; text?: string }[])
    .filter((component) => typeof component.text === "string").map((component) => ({ id: component.id, text: component.text! }));
}

function unitIds(surface: GuestSurfacePayload): string[] {
  return [...new Set([...JSON.stringify(surface.a2uiMessages).matchAll(/"unitId":"([^"]+)"/g)].map((match) => match[1]!))];
}

function note(surface: GuestSurfacePayload, unitId: string): string | undefined {
  return texts(surface.a2uiMessages).find((component) => component.id === `unit-${unitId}-budget`)?.text;
}

async function search(fixture: Fixture, text: string) {
  return success(await fixture.send("/api/turn", { text }));
}

test("AC6: Budget filtering compares the All-In Stay Total and excludes the Refundable Security Deposit", async () => {
  const fixture = await restartFixture();
  try {
    // ₦370,000 equals Ikoyi's All-In Stay Total; with its deposit the cash needed is ₦390,000.
    const exact = await search(fixture, `${LAGOS}, budget ₦370,000`);
    assert.deepEqual(unitIds(exact.surfaces[0]!), [LEKKI, IKOYI], "listed, and ranked by All-In Stay Total");
    assert.match(exact.messages[0]!, /within your ₦370,000 budget \(All-In Stay Total\)/);

    // Failure path: one naira under the total excludes it; the deposit never counts towards the budget.
    const under = await search(fixture, "budget ₦369,999");
    assert.deepEqual(unitIds(under.surfaces[0]!), [LEKKI]);
    const none = await search(fixture, "budget ₦199,999");
    assert.deepEqual(unitIds(none.surfaces[0]!), []);

    // The domain query agrees and still refuses a price filter without a quote (ADR-0015).
    const domain = fixture.environment.discoveryQuery.search({ location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2, maxPriceKobo: 37_000_000 });
    assert.deepEqual(domain.facts.results.map((unit) => unit.id), [LEKKI, IKOYI]);
    assert.throws(() => fixture.environment.discoveryQuery.search({ location: "Lagos", maxPriceKobo: 37_000_000 }), /require dates and partySize/);
  } finally { await fixture.close(); }
});

test("AC7: A nightly budget is converted to a stay total using the current nights and shown back as a total", async () => {
  const fixture = await restartFixture();
  try {
    const nightly = await search(fixture, `${LAGOS}, around ₦70k a night`);
    assert.equal(nightly.criteria?.budget?.label, "₦210,000 total for 3 nights, all fees included");
    assert.equal(nightly.criteria?.budget?.per, "night");
    assert.match(nightly.surfaces[0]!.conventionalRoute ?? "", /maxPriceKobo=21000000/);
    assert.deepEqual(unitIds(nightly.surfaces[0]!), [LEKKI]);

    // Changing the nights re-converts the same nightly budget.
    const key = nightly.criteria!.key;
    const shorter = success(await fixture.send("/api/event", { name: CRITERIA_EDIT_EVENT, surfaceId: criteriaSurfaceId(fixture.threadId), sourceComponentId: "t", timestamp: new Date().toISOString(), context: { field: "when", checkIn: "2026-09-10", nights: 2, basedOn: key } }));
    assert.equal(shorter.criteria?.budget?.label, "₦140,000 total for 2 nights, all fees included");
    assert.match(shorter.surfaces[0]!.conventionalRoute ?? "", /maxPriceKobo=14000000/);

    // The conventional route carries the same budget.
    const page = await fetch(`${fixture.base}${shorter.surfaces[0]!.conventionalRoute}`);
    assert.equal(page.status, 200);

    // Failure path: counts of nights or guests are never read as money.
    assert.equal(extractStayRequestFacts("under 3 nights, max 4 guests").budget, undefined);
    assert.deepEqual(extractStayRequestFacts("budget of 500k naira").budget, { kobo: 50_000_000, per: "stay" });
    assert.deepEqual(extractStayRequestFacts("₦60,000 per night please").budget, { kobo: 6_000_000, per: "night" });
    assert.equal(extractStayRequestFacts("my budget is ₦500k").unsupportedPreferences, undefined, "a stated amount is not an unsupported preference");
  } finally { await fixture.close(); }
});

test("AC8: Without dates or party size, no result is described as within budget", async () => {
  const fixture = await restartFixture();
  try {
    const noDates = await search(fixture, "I'm looking for a stay in Lagos, budget ₦400k");
    assert.equal(noDates.surfaces.length, 0, "no search runs without dates and party size");
    assert.equal(noDates.criteria?.budget?.label, "About ₦400,000 total, all fees included");
    assert.doesNotMatch(noDates.messages.join(" "), /within/i);
    assert.match(noDates.messages.join(" "), /budget about ₦400,000 total, all fees included/);

    const nightly = await search(fixture, "actually ₦60k a night");
    assert.equal(nightly.criteria?.budget?.label, "About ₦60,000 a night");
    const withNights = await search(fixture, "3 nights");
    assert.equal(withNights.criteria?.budget?.label, "About ₦180,000 total for 3 nights, all fees included", "still qualified without party size and dates");
    assert.equal(withNights.surfaces.length, 0);
  } finally { await fixture.close(); }
});

test("AC9: An apartment within budget only before its deposit is still listed, with the deposit shown separately", async () => {
  const fixture = await restartFixture();
  try {
    const result = await search(fixture, `${LAGOS}, budget ₦380,000`);
    const surface = result.surfaces[0]!;
    assert.deepEqual(unitIds(surface), [LEKKI, IKOYI]);
    assert.equal(note(surface, IKOYI), "Within your ₦380,000 budget (All-In Stay Total). The Refundable Security Deposit is paid separately, so the total to complete booking is ₦390,000.");
    assert.ok(texts(surface.a2uiMessages).some((component) => component.id === `unit-${IKOYI}-deposit` && component.text === "Refundable Security Deposit: ₦20,000"));
    // Failure path: a unit whose deposit stays inside the budget gets no deposit warning.
    assert.equal(note(surface, LEKKI), "Within your ₦380,000 budget (All-In Stay Total).");
  } finally { await fixture.close(); }
});

test("AC10: A unit without an All-In Stay Total is never described as within budget", () => {
  const unit = {
    id: "unit-x", title: "Indicative flat", location: { city: "Lagos", neighbourhood: "Lekki Phase 1" }, capacity: 2, bathrooms: 1, description: "", amenities: [], photoUrls: [],
    price: { nightlyKobo: 1_000_000, allInStayTotalKobo: null, mandatoryFeesKobo: 0, refundableSecurityDepositKobo: 0, amountDueNowKobo: null, currency: "NGN" as const, pricingVersion: "v1" },
    trust: { inspection: { status: "current", inspectedAt: "2026-01-01", expiresAt: "2027-01-01", scope: [] }, managementAuthority: { status: "current", verifiedAt: "2026-01-01" }, occupancyModel: "entire-place" },
  };
  const artifact: DiscoveryArtifactProjection = {
    id: "search-x", kind: "shortlet.discovery-results", schemaVersion: "v1", projectionVersion: 1, domainReferences: [], policyVersions: {}, disclosures: [],
    facts: { filters: { location: "Lagos", maxPriceKobo: 50_000_000 }, results: [unit] }, amounts: [], actions: [], acknowledgements: [], sensitivity: "public",
  };
  const all = texts(discoveryArtifactToA2UI({ artifact, surfaceId: "s" })).map((component) => component.text).join(" ");
  assert.doesNotMatch(all, /within your/i);
  assert.match(all, /Indicative nightly rate/);
});

test("The Budget chip edits, clears and undoes like the other chips; the conventional form accepts a budget", async () => {
  const fixture = await restartFixture();
  try {
    const first = await search(fixture, LAGOS);
    assert.equal(first.criteria?.budget, undefined);
    const edit = (context: Record<string, unknown>) => fixture.send("/api/event", { name: CRITERIA_EDIT_EVENT, surfaceId: criteriaSurfaceId(fixture.threadId), sourceComponentId: "t", timestamp: new Date().toISOString(), context });
    const set = success(await edit({ field: "budget", naira: 250_000, per: "stay", basedOn: first.criteria!.key }));
    assert.equal(set.criteria?.budget?.label, "₦250,000 total for 3 nights, all fees included");
    assert.deepEqual(unitIds(set.surfaces[0]!), [LEKKI]);
    // Failure paths: a fractional or negative amount, or an unknown basis, fails closed.
    for (const bad of [{ naira: 1.5, per: "stay" }, { naira: -5, per: "stay" }, { naira: 100, per: "week" }]) {
      const rejected = await edit({ field: "budget", ...bad, basedOn: set.criteria!.key });
      assert.equal(!rejected.ok && rejected.code, "INVALID_CRITERIA", JSON.stringify(bad));
    }
    const cleared = success(await edit({ field: "budget", clear: true, basedOn: set.criteria!.key }));
    assert.equal(cleared.criteria?.budget, undefined);
    assert.deepEqual(unitIds(cleared.surfaces[0]!), [IKOYI, LEKKI]);
    const undone = success(await fixture.send("/api/event", { name: CRITERIA_UNDO_EVENT, surfaceId: criteriaSurfaceId(fixture.threadId), sourceComponentId: "t", timestamp: new Date().toISOString(), context: { basedOn: cleared.criteria!.key } }));
    assert.equal(undone.criteria?.budget?.label, "₦250,000 total for 3 nights, all fees included");

    // ADR-0080: the conventional form's optional budget.
    const withBudget = await fetch(`${fixture.base}/stays/search?area=lagos&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2&budget=250000`);
    const html = await withBudget.text();
    assert.equal(withBudget.status, 200);
    assert.match(html, /data-unit-id="unit-lagos-lekki-002"/);
    assert.doesNotMatch(html, /data-unit-id="unit-lagos-ikoyi-001"/);
    assert.match(html, /name="budget" type="number"[^>]*value="250000"/);
    assert.equal((await fetch(`${fixture.base}/stays/search?area=lagos&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2&budget=`)).status, 200, "an empty optional budget means none");
    assert.equal((await fetch(`${fixture.base}/stays/search?area=lagos&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2&budget=abc`)).status, 400);
  } finally { await fixture.close(); }
});
