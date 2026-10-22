import assert from "node:assert/strict";
import test from "node:test";
import type { BookingContractArtifact } from "../apps/web/src/booking-contract-artifact.js";
import { confirmationContent } from "../apps/web-agent/src/confirmation-presentation.js";
import { confirmationScreenHtml } from "../apps/local-guest/src/guest-kit.js";

function artifact(extended: boolean): BookingContractArtifact {
  return {
    facts: {
      offerId: "offer/with space", reservationId: "res-1", occupants: [], accommodationProvider: { id: "op-1" },
      accessAvailability: "locked", guestConductRules: [], ...(extended ? { noticeToEndTerms: "Demo terms" } : {}),
    },
  } as unknown as BookingContractArtifact;
}

// Demo-launch issue 12 AC4: chat and the page share one confirmation helper, so the schedule link reaches both.
test("AC4: A confirmed Extended Stay links to its Billing Period schedule in the shared confirmation screen", () => {
  const content = confirmationContent(artifact(true), "thread-1", "/booking-contracts/c1", "");
  assert.equal(content.scheduleHref, "/bookings/periods/offer%2Fwith%20space");
  const html = confirmationScreenHtml(content, "", "");
  assert.match(html, /href="\/bookings\/periods\/offer%2Fwith%20space"[^>]*>View payment schedule</);
});

test("AC4: A confirmed Short Stay shows no schedule link", () => {
  const content = confirmationContent(artifact(false), "thread-1", "/booking-contracts/c1", "");
  assert.equal(content.scheduleHref, undefined);
  assert.doesNotMatch(confirmationScreenHtml(content, "", ""), /payment schedule/i);
});
