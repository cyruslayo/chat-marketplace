import assert from "node:assert/strict";
import test from "node:test";
import { withStagePage } from "./helpers/guest-stage-pages.js";
import { confirmationContent, confirmationSteps } from "../apps/web-agent/src/confirmation-presentation.js";
import { visibleText } from "./helpers/guest-payment-page.js";

test("AC1: confirmed Reservation, Unit, dates, party, verified amounts, and reference appear in canonical order; unverified payment cannot render confirmation", async () => {
  await withStagePage({ label: "confirmed", stage: "confirmed" }, async ({ fixture, path }) => {
    const html = await (await fetch(fixture.base + path, { headers: { cookie: fixture.cookie } })).text();
    let previous = -1;
    for (const fact of ["Reservation confirmed", "Luxury 2-Bedroom Apartment in Old Ikoyi", 'datetime="2026-09-10"', 'datetime="2026-09-13"', "3 nights · 2 guests", "All-In Stay Total", "Refundable Security Deposit collected:", "Stay payment paid:", 'class="confirmation-reference"']) {
      const index = html.indexOf(fact, previous + 1);
      assert.ok(index > previous, fact);
      previous = index;
    }
    assert.ok(html.indexOf("Stay payment paid:") < html.indexOf('class="confirmation-reference"'));
    assert.match(html, /class="confirmation-reference"[\s\S]*Booking reference/);
    const details = /<details[^>]*class="[^"]*booking-details[\s\S]*?<\/details>/.exec(html)?.[0];
    assert.ok(details);
    assert.doesNotMatch(details, /Stay payment paid:|All-In Stay Total|Booking confirmed for/);
  });
  await withStagePage({ label: "not verified", stage: "payment-ready" }, async ({ fixture, path }) => {
    const state = await fixture.state(); assert.equal(state.ok, true);
    assert.equal(state.surfaces.some(surface => surface.surfaceId.includes(":booking:")), false);
    const guessed = await fetch(`${fixture.base}/booking-contracts/${encodeURIComponent(path.split("/").at(-1)!)}`, { headers: { cookie: fixture.cookie } });
    assert.equal(guessed.status, 404); assert.doesNotMatch(await guessed.text(), /class="confirmed-screen"/);
  });
});

test("AC2: arrival information and support precede accessible contract details without repeating the receipt", async () => {
  await withStagePage({ label: "confirmed", stage: "confirmed" }, async ({ fixture, path, threadId }) => {
    const artifact = fixture.environment.contractApp.getArtifact(path.split("/").at(-1)!, fixture.environment.guestPrincipal());
    const content = confirmationContent(artifact, threadId, path, "Booking confirmed for duplicate receipt. Stay payment paid: duplicate");
    const html = await (await fetch(fixture.base + path, { headers: { cookie: fixture.cookie } })).text();
    assert.match(html, /Ask about arrival/);
    assert.match(html, /<summary[^>]*>Full contract terms<\/summary>/);
    assert.ok(html.indexOf("Before you arrive") < html.indexOf('id="booking-details"'));
    assert.doesNotMatch(JSON.stringify(content.details), /duplicate receipt|Stay payment paid/);
    assert.match(JSON.stringify(content.details), /Cancellation|cancellation/);
    assert.match(JSON.stringify(content.details), /Guest conduct|House rules/);
  });
});

test("AC3: a confirmed Reservation does not claim access authority when access references are missing", async () => {
  await withStagePage({ label: "confirmed", stage: "confirmed" }, async ({ fixture, path }) => {
    const artifact = fixture.environment.contractApp.getArtifact(path.split("/").at(-1)!, fixture.environment.guestPrincipal());
    const { accessReferenceId: _access, ...facts } = artifact.facts;
    const missing = confirmationSteps({ ...facts, accessAvailability: "available" }).join(" ");
    assert.match(missing, /does not itself grant physical access/);
    assert.doesNotMatch(missing, /Your access details are in secure booking details/);
    assert.match(missing, /Access information is available/);
    const locked = confirmationSteps({ ...facts, accessAvailability: "locked", accessReferenceId: "opaque-reference" }).join(" ");
    assert.match(locked, /Check-in details will be shared when they are ready/);
    assert.doesNotMatch(locked, /Access information is available|opaque-reference/);
    assert.match(visibleText(await (await fetch(fixture.base + path, { headers: { cookie: fixture.cookie } })).text()), /does not itself grant physical access/);
  });
});
