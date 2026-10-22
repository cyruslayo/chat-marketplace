/**
 * ADR 0105: the staging demo's synthetic operator. It is not a real person, a verified Operator or a real verification
 * claim. The acceptance itself is the owner environment's real command path: the grant check (ADR 0082), the
 * confirmation (ADR 0072, at the version the operator saw) and the Conditional Booking Offer issue (ADR 0005), each with
 * its audit record. Nothing here bypasses those checks.
 */
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { LocalApartmentOwnerEnvironment } from "./local-owner-environment.js";

export const DEMO_OPERATOR_ACTOR_ID = "demo-operator-actor";

/** A synthetic verification claim for the demo grant (ADR 0105: synthetic operator and verification claims). */
const DEMO_VERIFICATION_REFERENCE = "demo-verification-claim";
/** The validity dates of the owner environment's seeded grant (local-owner-environment.ts); the demo grant copies them. */
const DEMO_GRANT_EXPIRES_AT = "2027-01-01T00:00:00Z";
const DEMO_RESPONSIBLE_PERSON_VERIFIED_AT = "2026-08-01T00:00:00Z";

/** Grants the synthetic demo operator the same representative authority a seeded operator has, if it has none yet. */
function ensureDemoOperatorGrant(owner: LocalApartmentOwnerEnvironment): void {
  const { tenantId, operatorId, adminId } = owner.config;
  if (owner.grantStore.canActForOperator({ actorId: DEMO_OPERATOR_ACTOR_ID, operatorId, tenantId })) return;
  owner.grantStore.createGrant(
    createPlatformCommandEnvelope({
      commandName: "operator_representative.grant",
      principal: { id: adminId, role: "admin", tenantId },
      payload: {
        actorId: DEMO_OPERATOR_ACTOR_ID,
        operatorId,
        expiresAtIso: DEMO_GRANT_EXPIRES_AT,
        responsiblePersonVerifiedAtIso: DEMO_RESPONSIBLE_PERSON_VERIFIED_AT,
        verificationReference: DEMO_VERIFICATION_REFERENCE,
      },
      idempotencyKey: `demo-grant-${DEMO_OPERATOR_ACTOR_ID}`,
    }),
  );
}

/**
 * Builds the demo acceptor over one owner environment. The staging Durable Object and the Node pilot call this only when
 * the demo is on (ADR 0105); the guest environment accepts through it and nowhere else.
 */
export function createDemoRequestAcceptor(owner: LocalApartmentOwnerEnvironment, delaySeconds: number): { readonly delaySeconds: number; accept(requestId: string): void } {
  ensureDemoOperatorGrant(owner);
  const principal: CommandPrincipal = { id: DEMO_OPERATOR_ACTOR_ID, role: "operator", tenantId: owner.config.tenantId };
  return {
    delaySeconds,
    accept(requestId: string): void {
      const artifact = owner.operatorRequestDetail(requestId, principal);
      owner.confirmOperatorRequest(requestId, principal, { attested: true, basedOnVersion: artifact.projectionVersion });
    },
  };
}
