/** Minimal PLATFORM account state used to bind SHORTLET identity assurance to the current account revision. */
export type AccountAssuranceState =
  | { readonly status: "active"; readonly emailRevision: number }
  | { readonly status: "closed" | "missing" };

export interface AccountAssuranceStateReader {
  readAccountAssuranceState(input: { readonly tenantId: string; readonly accountGuestId: string }): Promise<AccountAssuranceState>;
}
