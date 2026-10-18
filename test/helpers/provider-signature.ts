import { createHmac } from "node:crypto";

// Shared provider-signature fixture (ADR 0075): the HMAC-SHA256 hex digest a provider sends for a payload. Tests use this in
// place of a literal signature, so the verifier is exercised with real digests only.
export function providerHmacSignature(payload: string | object, secret: string): string {
  const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHmac("sha256", secret).update(payloadString).digest("hex");
}
