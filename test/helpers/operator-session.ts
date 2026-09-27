import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** A signed-in operator over a fresh temporary database, with a clock the test moves forward. */
export interface SignedInOperator {
  readonly server: OperatorServer;
  readonly session: OperatorSession;
  /** Moves the shared server clock forward (deadlines, reminders, session expiry). */
  advance(ms: number): void;
  now(): Date;
  /** Closes the server and removes the database. */
  close(): Promise<void>;
}

/** Starts a server on a temp database with a controlled clock and signs the fixture representative in. */
export async function startSignedInOperator(options: { readonly start?: string; readonly config?: Partial<LocalOwnerFixtureConfig> } = {}): Promise<SignedInOperator> {
  const dir = await mkdtemp(join(tmpdir(), "operator-"));
  let current = new Date(options.start ?? "2026-09-03T10:00:00Z");
  const server = await startOperatorServer({ ...options.config, databasePath: join(dir, "operator.sqlite"), clock: () => current });
  const session: OperatorSession = { base: server.base, cookie: await signInOperator(server) };
  return {
    server,
    session,
    advance(ms) { current = new Date(current.getTime() + ms); },
    now: () => current,
    async close() { await server.close(); await rm(dir, { recursive: true, force: true }); },
  };
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

/** GET as the signed-in operator, without following redirects (so a sign-in redirect is visible). Pass `cookie: ""` to send no session. */
export function operatorGet(session: OperatorSession, path: string, cookie = session.cookie, headers: Readonly<Record<string, string>> = {}): Promise<Response> {
  return fetch(`${session.base}${path}`, { headers: cookieHeaders(cookie, headers), redirect: "manual" });
}

/** POST as the signed-in operator, without following redirects. Pass `cookie: ""` to send no session, and `form` for a urlencoded body. */
export function operatorPost(session: OperatorSession, path: string, cookie = session.cookie, headers: Readonly<Record<string, string>> = {}, form?: Readonly<Record<string, string>>): Promise<Response> {
  return fetch(`${session.base}${path}`, { method: "POST", headers: cookieHeaders(cookie, headers), redirect: "manual", ...(form === undefined ? {} : { body: new URLSearchParams(form) }) });
}

/** The decline reason codes the back office accepts (decision D1). */
export type TestDeclineReason = "dates_not_available" | "other_reason";

/** Reads the version a request's decision forms were rendered from (B3 AC4). Throws if the page has no decision form. */
export async function renderedDecisionVersion(session: OperatorSession, requestId: string): Promise<string> {
  const html = await (await operatorGet(session, `/operator/requests/${encodeURIComponent(requestId)}`)).text();
  const version = html.match(/name="basedOnVersion" value="(\d+)"/)?.[1];
  if (!version) throw new Error("Request page has no decision form");
  return version;
}

/**
 * Submits the confirm or decline form as a browser would: attested, with a reason, at the rendered version.
 * Override any field (or pass `basedOnVersion`) to exercise refusals.
 */
export async function decideRequest(session: OperatorSession, requestId: string, decision: "confirm" | "decline", options: { readonly reason?: TestDeclineReason; readonly basedOnVersion?: string; readonly form?: Readonly<Record<string, string>>; readonly cookie?: string } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? await renderedDecisionVersion(session, requestId).catch(() => "0");
  const form = { basedOnVersion, ...(decision === "confirm" ? { attest: "yes" } : { reason: options.reason ?? "dates_not_available" }), ...options.form };
  return operatorPost(session, `/operator/requests/${encodeURIComponent(requestId)}/${decision}`, options.cookie ?? session.cookie, {}, form);
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
