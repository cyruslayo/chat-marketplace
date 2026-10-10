/**
 * Slice 15 (shared with slice 11b): the HTTPS-or-loopback rule for remote operator and pilot URLs. `https:` is
 * always allowed; `http:` is allowed only for a loopback host (local development). The error text names the
 * setting the caller passes as `label`, and never echoes the value, so a URL that carries a credential is not logged.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertHttpsOrLoopbackUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(`${label} must use https (http is allowed only for localhost)`);
  }
  return parsed;
}
