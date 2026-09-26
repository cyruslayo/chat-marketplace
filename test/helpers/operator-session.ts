import { LocalApartmentOwnerEnvironment, startLocalOwnerServer, type LocalOwnerFixtureConfig } from "../../apps/local-owner/src/index.js";
import type { OperatorRepresentativeGrant } from "../../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope } from "../../packages/platform-core/src/index.js";

/** Same name as `OPERATOR_SESSION_COOKIE` in `local-owner-server.ts` (not exported there). */
const OPERATOR_SESSION_COOKIE = "shortlet_operator_session";

/** An `Origin` that is never the server's public origin, for the cross-origin failure path. */
export const FOREIGN_ORIGIN = "https://attacker.example";

/** Anything the operator routes can be reached at. Pilot servers pass `{ base }` directly. */
export interface OperatorTarget { readonly base: string }
/** A target plus the signed-in cookie header. `""` means no session. */
export interface OperatorSession extends OperatorTarget { readonly cookie: string }

export interface OperatorServer extends OperatorTarget {
  readonly environment: LocalApartmentOwnerEnvironment;
  readonly port: number;
  /** Closes the server and its environment. */
  close(): Promise<void>;
}

/** Starts `startLocalOwnerServer` over a fresh environment. Pass `clock` to test deadlines and session expiry. */
export async function startOperatorServer(config: Partial<LocalOwnerFixtureConfig> & { readonly databasePath: string }): Promise<OperatorServer> {
  const environment = new LocalApartmentOwnerEnvironment(config);
  const server = startLocalOwnerServer({ port: 0, environment });
  const port = await server.listen();
  return { environment, port, base: `http://localhost:${port}`, close: () => server.close() };
}

/** POSTs a token to `/operator/login` and returns the raw response (302 on success). */
export function postOperatorLogin(target: OperatorTarget, token: string, options: { readonly origin?: string; readonly signal?: AbortSignal } = {}): Promise<Response> {
  return fetch(`${target.base}/operator/login`, { method: "POST", headers: options.origin === undefined ? {} : { origin: options.origin }, body: new URLSearchParams({ token }), redirect: "manual", ...(options.signal === undefined ? {} : { signal: options.signal }) });
}

/** The `cookie` request header a browser would send back after a login response. */
export function operatorCookieFrom(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]!.trim()).join("; ");
}

/** Provisions a fresh token for the fixture representative, signs in and returns the cookie header. Throws unless sign-in succeeds. */
export async function signInOperator(server: OperatorServer): Promise<string> {
  const response = await postOperatorLogin(server, server.environment.provisionOperatorAccessToken());
  const cookie = operatorCookieFrom(response);
  if (response.status !== 302 || !cookie) throw new Error(`Operator sign-in failed with ${response.status}`);
  return cookie;
}

function cookieHeaders(cookie: string, headers: Readonly<Record<string, string>>): Record<string, string> {
  return cookie ? { cookie, ...headers } : { ...headers };
}

/** GET as the signed-in operator. Pass `cookie: ""` to send no session. */
export function operatorGet(session: OperatorSession, path: string, cookie = session.cookie, headers: Readonly<Record<string, string>> = {}): Promise<Response> {
  return fetch(`${session.base}${path}`, { headers: cookieHeaders(cookie, headers) });
}

/** POST as the signed-in operator, without following redirects. Pass `cookie: ""` to send no session. */
export function operatorPost(session: OperatorSession, path: string, cookie = session.cookie, headers: Readonly<Record<string, string>> = {}): Promise<Response> {
  return fetch(`${session.base}${path}`, { method: "POST", headers: cookieHeaders(cookie, headers), redirect: "manual" });
}

/** POST with a valid session but a foreign `Origin` header. */
export function crossOriginPost(session: OperatorSession, path: string): Promise<Response> {
  return operatorPost(session, path, session.cookie, { origin: FOREIGN_ORIGIN });
}

/** Signs out through `/operator/logout`, as the browser would. */
export function signOutOperator(session: OperatorSession): Promise<Response> {
  return operatorPost(session, "/operator/logout");
}

/** Revokes the session behind `cookie` server-side (ADR 0086), as another tab's logout would, without clearing the cookie. */
export function revokeOperatorSession(environment: LocalApartmentOwnerEnvironment, cookie: string): void {
  const pair = cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${OPERATOR_SESSION_COOKIE}=`));
  if (!pair) throw new Error("Cookie carries no Operator session");
  environment.sessionAuthority.revokeSession(decodeURIComponent(pair.slice(OPERATOR_SESSION_COOKIE.length + 1)));
}

/** Revokes every active representative grant of the fixture representative for the fixture owner (ADR 0082), as the platform admin. */
export function revokeRepresentativeGrant(environment: LocalApartmentOwnerEnvironment): OperatorRepresentativeGrant[] {
  const { adminId, tenantId, operatorId, representativePersonId } = environment.config;
  const active = environment.grantStore.listGrants().filter((grant) => grant.actorId === representativePersonId && grant.operatorId === operatorId && !grant.revokedAtIso);
  if (active.length === 0) throw new Error("No active representative grant to revoke");
  return active.map((grant) => environment.grantStore.revokeGrant(createPlatformCommandEnvelope({ commandName: "operator_representative.revoke", principal: { id: adminId, role: "admin", tenantId }, payload: { grantId: grant.grantId } })));
}
