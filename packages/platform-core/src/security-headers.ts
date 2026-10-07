/**
 * Slice 13: the security headers the handlers send, in one place so the Node server and the Worker cannot drift.
 * ADR 0078 (accessible launch profile) and ADR 0075 (no restricted data leaves through headers).
 */

/** Sent with every Guest HTML page. */
export const GUEST_HTML_SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  // Issue 06c: "same-origin" (not "no-referrer") so a same-origin form post carries a real Origin for
  // browserOriginAccepted; cross-origin requests still send no referrer.
  "Referrer-Policy": "same-origin",
} as const;

/** Sent with a streamed manual-transfer receipt (images inline, PDFs as an attachment). */
export const RECEIPT_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
} as const;
