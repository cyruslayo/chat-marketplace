import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import { Window } from "happy-dom";
import { bookingContractArtifactToA2UI } from "../apps/web-agent/src/booking-contract-a2ui.js";
import { requestDraftArtifactToA2UI } from "../apps/web-agent/src/request-draft-a2ui.js";
import { createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import type { BookingContractArtifact } from "../apps/web/src/booking-contract-artifact.js";
import type { RequestDraftArtifact } from "../apps/web/src/request-draft-artifact.js";
import { priceBreakdown, typedComponents } from "./helpers/booking-components.js";

/**
 * Weaver catalogues issue 04 (ADR 0102, ADR 0074, ADR 0075): the booking builders emit typed StayTicket and PriceBreakdown
 * components on `shortlet-booking/v1`. These mount the surfaces on the guest browser's own runtime in happy-dom.
 */
function mount(messages: readonly A2UIServerMessage[], surfaceId: string) {
  const web = createShortletWebRuntime();
  for (const message of messages) assert.equal(web.runtime.process(message).ok, true, "the booking message is valid");
  const window = new Window();
  const target = window.document.createElement("div");
  window.document.body.append(target);
  assert.equal(web.mount({ surfaceId, target: target as unknown as Element }).ok, true, "the booking surface mounts");
  return { target };
}

const draft: RequestDraftArtifact = {
  id: "request-draft:draft-1", kind: "shortlet.request-draft", schemaVersion: "shortlet.request-draft/v1", projectionVersion: 1,
  domainReferences: [], policyVersions: {}, disclosures: ["Terms will be revalidated before submission."],
  facts: { draftId: "draft-1", unitId: "unit-1", unitTitle: "Garden Stay, Ikoyi", operatorName: "Provider", checkIn: "2026-09-10", checkOut: "2026-09-13", nights: 3, primaryGuestName: "Ada Guest", occupants: ["Ada Guest", "Tunde Guest"], currency: "NGN", allInStayTotalKobo: 20200000, refundableSecurityDepositKobo: 5000000, amountDueNowKobo: 25200000, cancellationPolicy: { type: "standard", version: "v1", summary: "Captured terms" }, inventoryReserved: false },
  actions: [{ type: "review", artifactId: "request-draft:draft-1", draftId: "draft-1", expectedStatus: "draft", projectionVersion: 1 }], acknowledgements: [], sensitivity: "booking-sensitive",
};

const heldContract: BookingContractArtifact = {
  id: "booking-contract:contract-1", kind: "shortlet.booking-contract", schemaVersion: "shortlet.booking-contract/v1", projectionVersion: 1,
  domainReferences: [], policyVersions: {}, disclosures: [],
  facts: { contractId: "contract-1", reservationId: "reservation-1", offerId: "offer-1", unitId: "unit-1", primaryGuest: { id: "guest-1", name: "Ada Guest" }, accommodationProvider: { id: "provider-1", name: "Provider" }, checkIn: "2026-09-24", checkOut: "2026-09-27", nights: 3, occupants: ["Ada Guest", "Tunde Guest"], allInStayTotalKobo: 20200000, refundableSecurityDepositKobo: 5000000, securityDeposit: { policyVersion: "deposit-v1", amountKobo: 5000000, currency: "NGN", collectionId: "collection-1", status: "held" }, amountPaidKobo: 20200000, currency: "NGN", paymentMethod: "fresh_card", guestConductRules: [], contractVersion: 1, addressAvailability: "locked", accessAvailability: "locked" },
  sensitivity: "booking-sensitive",
};

test("AC2: with the check-out date missing from the projection, the chat renders no .ui-ticket, still shows the check-in and stay facts as text, and still shows the .ui-price-breakdown", () => {
  // Copy the real request-draft artifact and remove its check-out date from the projection.
  const { checkOut: _checkOut, ...factsWithoutCheckOut } = draft.facts;
  const artifact = { ...draft, facts: factsWithoutCheckOut } as unknown as RequestDraftArtifact;
  const messages = requestDraftArtifactToA2UI({ artifact, surfaceId: "ac2-no-check-out" });
  assert.deepEqual(typedComponents(messages, "StayTicket"), [], "the builder emits no StayTicket without a check-out date");
  const { target } = mount(messages, "ac2-no-check-out");
  assert.equal(target.querySelector(".ui-ticket"), null, "no half-built ticket is drawn");
  const text = target.textContent ?? "";
  assert.ok(text.includes("Check-in: Thu, 10 Sept 2026"), "the check-in fact stays readable as text");
  assert.ok(text.includes("Stay: 3 nights · 2 guests"), "the stay fact stays readable as text");
  assert.ok(target.querySelector(".ui-price-breakdown"), "the price breakdown still shows");
});

test("AC3: the booking reference and deposit-collected wording come from props; the client no longer reads activePayload.confirmation for them", async () => {
  const client = await readFile(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /confirmation\?\.depositCollected/);
  assert.doesNotMatch(client, /confirmation\.depositCollected/);

  const messages = bookingContractArtifactToA2UI({ artifact: heldContract, surfaceId: "ac3-deposit" });
  assert.equal(priceBreakdown(messages).depositCollected, true, "the deposit-collected flag is a prop of the PriceBreakdown");
  const { target } = mount(messages, "ac3-deposit");
  assert.match(target.textContent ?? "", /Refundable Security Deposit collected:/);
});

test("AC5: HTML in props, such as a unit title, renders as literal text in the ticket", () => {
  const hostile = "Flat <img src=x onerror=alert(1)>";
  const messages = structuredClone(requestDraftArtifactToA2UI({ artifact: draft, surfaceId: "ac5-hostile-title" }));
  let changed = 0;
  for (const message of messages) {
    if (!("updateComponents" in message)) continue;
    for (const component of message.updateComponents.components as unknown as { component: string; title?: string }[]) {
      if (component.component === "StayTicket") {
        component.title = hostile;
        changed += 1;
      }
    }
  }
  assert.equal(changed, 1, "the surface carries one StayTicket to tamper with");
  const { target } = mount(messages, "ac5-hostile-title");
  assert.equal(target.querySelector("[onerror]"), null, "no element carries the injected handler");
  assert.equal(target.querySelector(".ui-ticket img"), null, "the markup is not parsed into an image");
  assert.equal(target.querySelector(".ui-ticket__name")?.textContent, hostile);
});

test("AC6: client.ts no longer defines organizeBookingTicket", async () => {
  const client = await readFile(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /\borganizeBookingTicket\b/);
});
