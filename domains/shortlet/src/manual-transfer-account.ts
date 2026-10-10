/** ADR 0090: the one fixed business account. Configuration, never code. */
export interface ManualTransferAccount {
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
}
