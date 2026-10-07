/**
 * Cloudflare Access service-token validation (slice 11a).
 *
 * Verifies the `Cf-Access-Jwt-Assertion` JWT (RS256) against the team's published certs, checking the signing key,
 * the audience and the validity window. Everything fails closed: a missing, malformed or unverifiable token is
 * refused, never treated as authenticated. The team domain, audience and (for local/test) a JWKS come from
 * configuration; production fetches `https://<team-domain>/cdn-cgi/access/certs` and caches it per Durable Object.
 */
export interface AccessJwks {
  readonly keys: readonly (JsonWebKey & { readonly kid?: string })[];
}

export interface AccessVerifier {
  verify(token: string): Promise<boolean>;
}

export interface AccessJwtOptions {
  /** The Access team domain, e.g. `shortlet.cloudflareaccess.com` (no scheme). */
  readonly teamDomain: string;
  /** The Access application's audience tag. */
  readonly audience: string;
  /** Local/test override so workerd tests do not fetch the public certs. */
  readonly jwks?: AccessJwks;
  readonly fetcher?: (url: string) => Promise<Response>;
  readonly clock?: () => Date;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T;
}

export function createAccessJwtVerifier(options: AccessJwtOptions): AccessVerifier {
  let cached: AccessJwks | null = options.jwks ?? null;
  const load = async (): Promise<AccessJwks> => {
    if (cached !== null) return cached;
    const fetcher = options.fetcher ?? ((url: string) => fetch(url));
    const response = await fetcher(`https://${options.teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error("Access certs are unavailable");
    cached = (await response.json()) as AccessJwks;
    return cached;
  };
  return {
    async verify(token: string): Promise<boolean> {
      try {
        const [headerPart, payloadPart, signaturePart] = token.split(".");
        if (!headerPart || !payloadPart || !signaturePart) return false;
        const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
        if (header.alg !== "RS256") return false;
        const payload = decodeJson<{ aud?: string | string[]; exp?: number; nbf?: number }>(payloadPart);
        const nowSeconds = Math.floor((options.clock?.() ?? new Date()).getTime() / 1000);
        if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return false;
        if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) return false;
        const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud === undefined ? [] : [payload.aud];
        if (!audiences.includes(options.audience)) return false;
        const jwks = await load();
        const jwk = jwks.keys.find((candidate) => header.kid === undefined || candidate.kid === header.kid);
        if (!jwk) return false;
        const key = await crypto.subtle.importKey(
          "jwk",
          jwk as JsonWebKey,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
        const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
        return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlToBytes(signaturePart), signed);
      } catch {
        return false;
      }
    },
  };
}
