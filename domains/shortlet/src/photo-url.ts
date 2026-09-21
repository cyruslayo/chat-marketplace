import { isIP } from "node:net";

export const MAX_UNIT_PHOTOS = 12;

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets as [number, number, number, number];
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0)
    || (first === 198 && second >= 18 && second <= 19)
    || first >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc")
    || normalized.startsWith("fd") || normalized.startsWith("fe8")
    || normalized.startsWith("fe9") || normalized.startsWith("fea")
    || normalized.startsWith("feb") || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:192.168.")
    || normalized.startsWith("::ffff:172.16.") || normalized.startsWith("::ffff:172.17.")
    || normalized.startsWith("::ffff:172.18.") || normalized.startsWith("::ffff:172.19.")
    || normalized.startsWith("::ffff:172.2") || normalized.startsWith("::ffff:172.3");
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")
    || normalized === "localhost.localdomain" || normalized.endsWith(".local")
    || normalized.endsWith(".internal") || normalized.endsWith(".lan")) return true;
  const ipVersion = isIP(normalized);
  return ipVersion === 4 ? isPrivateIpv4(normalized) : ipVersion === 6 ? isPrivateIpv6(normalized) : false;
}

/** Normalize and validate a pilot-hosted photo URL without making a request. */
export function normalizePhotoUrl(value: string, index?: number): string {
  const label = index === undefined ? "photo URL" : `photo URL ${index + 1}`;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is malformed`);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} is malformed`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (parsed.username !== "" || parsed.password !== "" || parsed.hostname === "" || isBlockedHostname(parsed.hostname)) {
    throw new Error(`${label} must use a public HTTPS host`);
  }
  return parsed.href;
}

export function normalizePhotoUrls(values: readonly string[] | undefined): string[] {
  const source = values ?? [];
  if (source.length > MAX_UNIT_PHOTOS) throw new Error(`photo_urls may contain at most ${MAX_UNIT_PHOTOS} photo URLs`);
  const normalized = source.map((value, index) => normalizePhotoUrl(value, index));
  if (new Set(normalized).size !== normalized.length) throw new Error("photo_urls contains duplicate photo URL");
  return normalized;
}
