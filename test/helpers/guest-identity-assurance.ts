import {
  AccountBackedGuestIdentityVerificationResultSource,
  GuestCheckInIdentityEligibility,
  SqliteGuestIdentityAssurance,
  type GuestAccountSession,
  type IdentityAssuranceOutcome,
} from "../../domains/shortlet/src/index.js";
import { createGuestLinkingFixture, LINKING_TENANT, type GuestLinkingFixture } from "./guest-account-linking.js";
import { guestEmailChange } from "./guest-account-authority.js";
import { LOCAL_FIXTURE_IDENTITY_METHOD } from "../../apps/local-guest/src/identity-assurance-fixture.js";

export const ASSURANCE_TENANT = LINKING_TENANT;
export const VERIFIED_AT = "2026-10-10T09:00:00.000Z";
/** An explicit authoritative expiry carried by the outcome (ADR 0094). No default duration is applied anywhere. */
export const EXPIRES_AT = "2026-11-10T09:00:00.000Z";

export function verifiedOutcome(accountGuestId: string, overrides: Partial<IdentityAssuranceOutcome> = {}): IdentityAssuranceOutcome {
  return {
    tenantId: ASSURANCE_TENANT,
    accountGuestId,
    level: "government-ID-verified",
    method: LOCAL_FIXTURE_IDENTITY_METHOD,
    status: "verified",
    verifiedAt: VERIFIED_AT,
    expiresAt: EXPIRES_AT,
    providerReference: null,
    ...overrides,
  };
}

export function reservationFor(primaryGuestId: string, tenantId = ASSURANCE_TENANT) {
  return { reservationId: "reservation-a", tenantId, primaryGuestId };
}

export interface GuestIdentityAssuranceFixture extends GuestLinkingFixture {
  readonly assurance: SqliteGuestIdentityAssurance;
  readonly source: AccountBackedGuestIdentityVerificationResultSource;
  readonly eligibility: GuestCheckInIdentityEligibility;
  /** Moves the clock that the source and the eligibility helper read. The store takes its instant explicitly. */
  setNow(instant: string): void;
  now(): Date;
  /** Changes the account email through the authority's action-proof path, as the account page will (issue 07). */
  changeAccountEmail(session: GuestAccountSession, email: string): void;
}

/** The linking fixture (one shared database, the authority, the links and the resolver) plus the assurance port and helpers. */
export async function createGuestIdentityAssuranceFixture(): Promise<GuestIdentityAssuranceFixture> {
  const base = await createGuestLinkingFixture();
  let instant = new Date(VERIFIED_AT);
  const clock = () => instant;
  const assurance = new SqliteGuestIdentityAssurance(base.database);
  const source = new AccountBackedGuestIdentityVerificationResultSource({ links: base.links, assurance, clock });
  const eligibility = new GuestCheckInIdentityEligibility({ links: base.links, assurance, clock });
  return {
    ...base,
    assurance,
    source,
    eligibility,
    setNow(value) {
      instant = new Date(value);
    },
    now() {
      return instant;
    },
    changeAccountEmail(session, email) {
      const change = guestEmailChange(base.authority, session, email);
      base.authority.changeEmail({ command: change.command, proof: change.proof, sessionSecret: change.sessionSecret });
    },
  };
}
