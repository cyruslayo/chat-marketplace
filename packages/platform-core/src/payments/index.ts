/**
 * Platform Payments (ADR 0099 rule 2): one deep module owning the provider adapter, transfer-account
 * issuance, server-side verification, the signed webhook and receipt storage. Packs depend on the
 * provider-neutral contracts in `provider.ts` and react to the outcomes; they never see a provider secret.
 */
export * from "./provider.js";
export * from "./paystack.js";
export * from "./receipt-blob-store.js";
export * from "./payments.js";
