import { createPlatformCommandEnvelope } from "../../packages/platform-core/src/index.js";
import type { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/index.js";
import { repricedByOwner } from "./owner-terms.js";

/** Shared back-office page fixtures (B7, B8). */

export const SECOND_OWNER = "Adaeze Homes Ltd";
export const SECOND_OWNER_ID = "op-lagos-owner-002";
export const SECOND_UNIT_ID = "unit-lagos-ikoyi-002";
export const SECOND_UNIT_TITLE = "Garden Flat in Old Ikoyi";

/** A page's text as a reader sees it: no scripts, styles or tags, whitespace collapsed. */
export function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

/** A second owner you also hold a grant for (ADR 0082), with its own apartment. */
export function addSecondOwner(env: LocalApartmentOwnerEnvironment): void {
  const unit = env.unitRepository.findById(env.config.unitId)!;
  env.unitRepository.save({
    ...unit,
    id: SECOND_UNIT_ID,
    title: SECOND_UNIT_TITLE,
    operator: { ...unit.operator, id: SECOND_OWNER_ID, name: SECOND_OWNER },
    // ADR 0089: ₦80,000/night agreed at 15%.
    price: repricedByOwner(unit.price, { ownerNightlyKobo: 8_000_000, ownerMandatoryChargesKobo: 0, marginBasisPoints: 1500, version: "price-owner-2" }),
    blockedDates: [],
  });
  env.grantStore.createGrant(createPlatformCommandEnvelope({
    commandName: "operator_representative.grant",
    principal: { id: env.config.adminId, role: "admin", tenantId: env.config.tenantId },
    payload: { actorId: env.config.representativePersonId, operatorId: SECOND_OWNER_ID, expiresAtIso: "2027-01-01T00:00:00Z", responsiblePersonVerifiedAtIso: "2026-08-01T00:00:00Z", verificationReference: "verif-ref-owner-2" },
    idempotencyKey: "grant-owner-2",
  }));
}
