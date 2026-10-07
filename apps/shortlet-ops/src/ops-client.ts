/**
 * Slice 11b: the operator CLIs' remote mode. When `SHORTLET_OPS_URL` is set the CLIs call the authenticated
 * `/_ops` routes over HTTPS instead of mutating local files; when it is unset they behave exactly as today.
 *
 * Both authentication layers are sent: the Access service-token headers and the shared secret. A non-`https:`
 * URL is refused before any request is made, unless it is `localhost` (local development).
 */
export interface OpsRemoteConfiguration {
  readonly url: string;
  readonly sharedSecret: string;
  readonly accessClientId: string;
  readonly accessClientSecret: string;
}

export interface OpsRemoteResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** The configured remote, or null when the CLI should use its local path. Throws on a disallowed URL. */
export function remoteOpsConfiguration(source: NodeJS.ProcessEnv = process.env): OpsRemoteConfiguration | null {
  const url = source.SHORTLET_OPS_URL?.trim() ?? "";
  if (url === "") return null;
  assertOpsUrlAllowed(url);
  return {
    url,
    sharedSecret: source.SHORTLET_OPS_SECRET?.trim() ?? "",
    accessClientId: source.CF_ACCESS_CLIENT_ID?.trim() ?? "",
    accessClientSecret: source.CF_ACCESS_CLIENT_SECRET?.trim() ?? "",
  };
}

/** Refuses anything but `https:`, with `http:` allowed only for a loopback host. */
export function assertOpsUrlAllowed(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SHORTLET_OPS_URL must be an absolute URL");
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("SHORTLET_OPS_URL must use https (http is allowed only for localhost)");
  }
  return parsed;
}

export async function opsRequest(
  configuration: OpsRemoteConfiguration,
  path: string,
  init: { readonly method: string; readonly body?: string; readonly contentType?: string } ,
): Promise<OpsRemoteResponse> {
  const response = await fetch(new URL(path, configuration.url), {
    method: init.method,
    body: init.body,
    headers: {
      ...(init.contentType === undefined ? {} : { "content-type": init.contentType }),
      "x-shortlet-ops-secret": configuration.sharedSecret,
      "cf-access-client-id": configuration.accessClientId,
      "cf-access-client-secret": configuration.accessClientSecret,
    },
  });
  const text = await response.text();
  const body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  return { status: response.status, body };
}

/** Throws with the route's message when the ops call was refused or failed. */
export function assertOpsOk(response: OpsRemoteResponse): Record<string, unknown> {
  if (response.status >= 200 && response.status < 300) return response.body;
  const message = typeof response.body.message === "string" ? response.body.message : `Ops request failed with ${response.status}`;
  throw new Error(message);
}

/** Reads `--flag value` from CLI arguments, the same shape the local operator commands accept. */
export function flagValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${flag} is required`);
  return value;
}
