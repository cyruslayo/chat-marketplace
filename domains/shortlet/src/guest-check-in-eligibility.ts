import type { SqliteGuestAccountLinks } from "../../../packages/platform-core/src/accounts/links.js";
import { currentAssuranceForAccount, isCurrentGovernmentIdAssurance, type SqliteGuestIdentityAssurance } from "./guest-identity-assurance.js";
import type { AccountAssuranceStateReader } from "../../../packages/platform-core/src/accounts/assurance-state.js";

/**
 * Check-In Eligibility for identity assurance (ADR 0085, ADR 0094, issue 09). Reservation -> Primary Guest -> Linked Principal ->
 * Guest Account -> current Identity Assurance. This is the only consumer of the assurance store. Discovery, Request to Book, offer
 * acceptance and payment never import it (ADR 0085), and it grants no door code, lockbox code or other physical-access authority.
 * It has no UI and is not wired into any route yet.
 */

/** The reason is returned for a fail-closed result only. It names no evidence, method, reference or score. */
export type CheckInIdentityEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: "no_account" | "not_verified" | "expired" };

export interface IdentityEligibilityReservation {
  readonly reservationId: string;
  readonly tenantId: string;
  readonly primaryGuestId: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export class GuestCheckInIdentityEligibility {
  readonly #links: Pick<SqliteGuestAccountLinks, "accountForPrincipal">;
  readonly #assurance: Pick<SqliteGuestIdentityAssurance, "currentAssurance">;
  readonly #clock: () => Date;
  readonly #accountState: AccountAssuranceStateReader;

  constructor({
    links,
    assurance,
    clock,
    accountState,
  }: {
    links: Pick<SqliteGuestAccountLinks, "accountForPrincipal">;
    assurance: Pick<SqliteGuestIdentityAssurance, "currentAssurance" | "readAccountAssuranceState">;
    clock: () => Date;
    accountState?: AccountAssuranceStateReader;
  }) {
    this.#links = links;
    this.#assurance = assurance;
    this.#clock = clock;
    this.#accountState = accountState ?? assurance;
  }

  /** Evaluated lazily against the clock at call time (AGENTS anti-pattern 2). Every path that is not verified is not eligible. */
  async evaluate(reservation: IdentityEligibilityReservation): Promise<CheckInIdentityEligibility> {
    if (!nonEmpty(reservation?.reservationId) || !nonEmpty(reservation.tenantId) || !nonEmpty(reservation.primaryGuestId)) {
      throw new Error("Reservation, tenant and Primary Guest are required for Check-In identity eligibility");
    }
    const link = this.#links.accountForPrincipal(reservation.primaryGuestId);
    if (link === null || link.tenantId !== reservation.tenantId) return { eligible: false, reason: "no_account" };
    const current = await currentAssuranceForAccount(this.#assurance, this.#accountState, link.accountGuestId, reservation.tenantId, this.#clock());
    if (current === null) return { eligible: false, reason: "not_verified" };
    if (current.status === "expired") return { eligible: false, reason: "expired" };
    if (!isCurrentGovernmentIdAssurance(current)) return { eligible: false, reason: "not_verified" };
    return { eligible: true };
  }
}
