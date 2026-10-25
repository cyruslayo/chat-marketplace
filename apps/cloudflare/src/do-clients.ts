import type { CloudflareEnv } from "./cloudflare-config.js";
import type { Request as WorkerRequest, RequestInit as WorkerRequestInit, Response as WorkerResponse } from "@cloudflare/workers-types";
import type { AsyncGuestRequestContactIndex, BookingRequestContactMatch } from "../../../packages/platform-core/src/accounts/links.js";
import type { AccountAssuranceState, AccountAssuranceStateReader } from "../../../packages/platform-core/src/accounts/assurance-state.js";
import { COMMERCE_OWNED_TABLES, PLATFORM_OWNED_TABLES } from "./do-export.js";
import type { RemoteGuestAccounts } from "../../../packages/platform-core/src/accounts/remote-port.js";
import type { GuestDataPort } from "../../local-guest/src/guest-data-port.js";
import { GuestAccountAuthorityError, type GuestAccountAuthorityErrorCode } from "../../../packages/platform-core/src/accounts/authority.js";
import type { ModelRequestQuotaPort, ModelRequestQuotaReservation } from "../../../packages/platform-core/src/model-request-quota.js";

const INTERNAL_PREFIX = "/_internal/";

async function postJson(stub: { fetch(input: string | URL | WorkerRequest, init?: WorkerRequestInit): Promise<WorkerResponse> }, path: string, body: unknown): Promise<unknown> {
  const response = await stub.fetch(`https://do.internal${INTERNAL_PREFIX}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Internal Durable Object call failed");
  return await response.json() as unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Internal Durable Object response is malformed");
  return value as Record<string, unknown>;
}

/** Calls ShortletPilot only through the tenant-derived namespace stub; Worker ingress denies this internal path. */
export function shortletDomainClient(env: CloudflareEnv, tenantId: string): AsyncGuestRequestContactIndex & {
  invalidateGuestIdentityAssurance(input: { readonly tenantId: string; readonly accountGuestId: string }): Promise<void>;
} {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured Shortlet tenant");
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(normalizedTenant), { locationHint: "afr" });
  return {
    async findBookingRequestIdsByContactEmail(contactEmail, requestedTenant): Promise<readonly BookingRequestContactMatch[]> {
      if (requestedTenant !== normalizedTenant || !contactEmail.trim()) throw new Error("Invalid Shortlet contact lookup scope");
      const raw = object(await postJson(stub, "guest-request-contact-matches", { tenantId: normalizedTenant, contactEmail }));
      if (!Array.isArray(raw.matches)) throw new Error("Shortlet contact lookup response is malformed");
      return raw.matches.map((match: unknown) => {
        const row = object(match);
        if (typeof row.requestId !== "string" || !row.requestId.trim() || typeof row.primaryGuestId !== "string" || !row.primaryGuestId.trim() || row.tenantId !== normalizedTenant) {
          throw new Error("Shortlet contact lookup response is malformed");
        }
        return { requestId: row.requestId, primaryGuestId: row.primaryGuestId, tenantId: normalizedTenant };
      });
    },
    async invalidateGuestIdentityAssurance(input): Promise<void> {
      if (input.tenantId !== normalizedTenant || !input.accountGuestId.trim()) throw new Error("Invalid assurance invalidation scope");
      const raw = object(await postJson(stub, "guest-identity-assurance/invalidate", input));
      if (raw.ok !== true) throw new Error("Shortlet assurance invalidation failed");
    },
  };
}

/** Calls PlatformDO for minimal active/closed/missing account state; no email or credential crosses this seam. */
export function platformAccountStateReader(env: CloudflareEnv, tenantId: string): AccountAssuranceStateReader {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured platform tenant");
  const stub = env.PLATFORM.get(env.PLATFORM.idFromName(normalizedTenant), { locationHint: "afr" });
  return {
    async readAccountAssuranceState(input): Promise<AccountAssuranceState> {
      if (input.tenantId !== normalizedTenant || !input.accountGuestId.trim()) throw new Error("Invalid platform account state scope");
      const raw = object(await postJson(stub, "account-assurance-state", input));
      if (raw.status === "missing" || raw.status === "closed") return { status: raw.status };
      if (raw.status !== "active" || !Number.isSafeInteger(raw.emailRevision) || Number(raw.emailRevision) < 0) throw new Error("Platform account state response is malformed");
      return { status: "active", emailRevision: Number(raw.emailRevision) };
    },
  };
}

/** Durable shared quota authority for domain objects in one platform tenant (ADR 0101). */
export function platformModelRequestQuota(env: CloudflareEnv, tenantId: string): ModelRequestQuotaPort {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured platform tenant");
  const stub = env.PLATFORM.get(env.PLATFORM.idFromName(normalizedTenant), { locationHint: "afr" });
  return {
    async reserve(input): Promise<ModelRequestQuotaReservation> {
      if (input.tenantId !== normalizedTenant || !input.guestId.trim() || input.guestId.length > 200) throw new Error("Invalid model quota scope");
      const raw = object(await postJson(stub, "model-quota/reserve", { tenantId: normalizedTenant, guestId: input.guestId }));
      if (raw.ok !== true || typeof raw.reserved !== "boolean") throw new Error("Platform model quota response is malformed");
      if (raw.reserved) {
        if (Object.keys(raw).some((key) => !["ok", "reserved"].includes(key))) throw new Error("Platform model quota response is malformed");
        return { reserved: true };
      }
      if (raw.reason !== "tenant_day_limit" && raw.reason !== "guest_hour_limit") throw new Error("Platform model quota response is malformed");
      if (Object.keys(raw).some((key) => !["ok", "reserved", "reason"].includes(key))) throw new Error("Platform model quota response is malformed");
      return { reserved: false, reason: raw.reason };
    },
  };
}

/** Async RPC adapter used by Shortlet's guest runtime; account rows and credentials remain in PLATFORM. */
export function platformGuestAccounts(env: CloudflareEnv, tenantId: string): RemoteGuestAccounts {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured platform tenant");
  const stub = env.PLATFORM.get(env.PLATFORM.idFromName(normalizedTenant), { locationHint: "afr" });
  async function call<T>(operation: string, args: unknown): Promise<T> {
    const raw = object(await postJson(stub, `accounts/${operation}`, { tenantId: normalizedTenant, args }));
    if (raw.ok !== true) {
      const codes: ReadonlySet<string> = new Set(["invalid_input", "code_invalid", "code_expired", "code_consumed", "code_attempts_exhausted", "rate_limited", "session_invalid", "account_conflict", "action_proof_invalid"]);
      const code = typeof raw.code === "string" && codes.has(raw.code) ? raw.code as GuestAccountAuthorityErrorCode : "invalid_input";
      throw new GuestAccountAuthorityError(code, "Platform account operation failed", Number.isSafeInteger(raw.retryAfterSeconds) ? Number(raw.retryAfterSeconds) : undefined);
    }
    return raw.result as T;
  }
  return {
    requestCode: (args) => call("requestCode", args),
    verifyCode: (args) => call("verifyCode", args) as Promise<Awaited<ReturnType<RemoteGuestAccounts["verifyCode"]>>>,
    findAccount: (accountGuestId, requestedTenant) => requestedTenant === normalizedTenant ? call("findAccount", { accountGuestId, tenantId: requestedTenant }) : Promise.reject(new Error("Invalid account scope")),
    resolveSession: (sessionId, sessionSecret) => call("resolveSession", { sessionId, sessionSecret }),
    revokeSession: (sessionId, requestedTenant) => requestedTenant === normalizedTenant ? call("revokeSession", { sessionId, tenantId: requestedTenant }) : Promise.reject(new Error("Invalid account scope")),
    revokeAllSessions: (accountGuestId, requestedTenant) => requestedTenant === normalizedTenant ? call("revokeAllSessions", { accountGuestId, tenantId: requestedTenant }) : Promise.reject(new Error("Invalid account scope")),
    markEmailChangeAssuranceCleanupComplete: (args) => call("markEmailChangeAssuranceCleanupComplete", args),
    changeEmail: (args) => call("changeEmail", args),
    replayEmailChange: (args) => call("replayEmailChange", args),
    linkSignedInPrincipal: (args) => call("linkSignedInPrincipalWithLookup", args),
    linkSignedInPrincipalWithLookup: (args) => call("linkSignedInPrincipalWithLookup", args),
    accountForPrincipal: (principalId) => call("accountForPrincipal", { principalId }),
    linkedPrincipals: (accountGuestId, requestedTenant) => requestedTenant === normalizedTenant ? call("linkedPrincipals", { accountGuestId, tenantId: requestedTenant }) : Promise.reject(new Error("Invalid account scope")),
    claimedRequestIds: (accountGuestId, requestedTenant) => requestedTenant === normalizedTenant ? call("claimedRequestIds", { accountGuestId, tenantId: requestedTenant }) : Promise.reject(new Error("Invalid account scope")),
  };
}

export function platformGuestData(env: CloudflareEnv, tenantId: string): GuestDataPort {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured platform tenant");
  const stub = env.PLATFORM.get(env.PLATFORM.idFromName(normalizedTenant), { locationHint: "afr" });
  async function call<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    const response = object(await postJson(stub, `guest-data/${operation}`, { tenantId: normalizedTenant, ...args }));
    return response.result as T;
  }
  return {
    saveSessionBinding: (binding) => call("saveSessionBinding", binding as unknown as Record<string, unknown>),
    findSessionBinding: (sessionId) => call("findSessionBinding", { sessionId }),
    deleteSessionBinding: (sessionId) => call("deleteSessionBinding", { sessionId }),
    deleteSessionBindingsForPrincipals: (principalIds, requestedTenant) => requestedTenant === normalizedTenant
      ? call("deleteSessionBindingsForPrincipals", { principalIds }) : Promise.reject(new Error("Invalid guest session scope")),
    saveThread: (thread) => thread.tenantId === normalizedTenant ? call("saveThread", thread as unknown as Record<string, unknown>) : Promise.reject(new Error("Invalid thread scope")),
    findThread: (threadId) => call("findThread", { threadId }),
    findThreadsForPrincipal: (principalId, requestedTenant) => requestedTenant === normalizedTenant
      ? call("findThreadsForPrincipal", { principalId }) : Promise.reject(new Error("Invalid thread scope")),
    findThreadsForPrincipals: (principalIds, requestedTenant) => requestedTenant === normalizedTenant
      ? call("findThreadsForPrincipals", { principalIds }) : Promise.reject(new Error("Invalid thread scope")),
    findContact: (guestId, requestedTenant) => requestedTenant === normalizedTenant
      ? call("findContact", { guestId }) : Promise.reject(new Error("Invalid contact scope")),
    savePhone: (input) => input.tenantId === normalizedTenant ? call("savePhone", input as unknown as Record<string, unknown>) : Promise.reject(new Error("Invalid contact scope")),
    saveEmail: (input) => input.tenantId === normalizedTenant ? call("saveEmail", input as unknown as Record<string, unknown>) : Promise.reject(new Error("Invalid contact scope")),
  };
}

/** Dependencies to spread into the existing guestAccounts composition when assembling Shortlet's guest server. */
export function platformGuestAccountDependencies(env: CloudflareEnv, tenantId: string) {
  const domain = shortletDomainClient(env, tenantId);
  return {
    remoteAccounts: platformGuestAccounts(env, tenantId),
    remoteAccountState: platformAccountStateReader(env, tenantId),
    remoteAssuranceInvalidator: { invalidateGuestIdentityAssurance: (input: { readonly tenantId: string; readonly accountGuestId: string }) => domain.invalidateGuestIdentityAssurance(input) },
  };
}

/** Typed namespace seam for the ops gateway: only PLATFORM-owned tables are accepted for data operations. */
export function platformMigrationClient(env: CloudflareEnv, tenantId: string): {
  request<T>(operation: "import" | "export" | "verify" | "status" | "cutover", input?: Readonly<Record<string, unknown>>): Promise<T>;
} {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured platform tenant");
  const stub = env.PLATFORM.get(env.PLATFORM.idFromName(normalizedTenant), { locationHint: "afr" });
  return {
    async request<T>(operation: "import" | "export" | "verify" | "status" | "cutover", input: Readonly<Record<string, unknown>> = {}): Promise<T> {
      if (operation === "import" || operation === "export") {
        const table = input.table;
        if (typeof table !== "string" || !PLATFORM_OWNED_TABLES.has(table)) throw new Error("Table is not owned by PLATFORM");
      }
      const raw = await postJson(stub, `ops/${operation}`, { tenantId: normalizedTenant, ...input });
      return raw as T;
    },
  };
}

/**
 * The only path that reaches the internal checkout route (no public Worker route does). Non-2xx answers are returned, not
 * thrown: 409 payment_unavailable and 400 refusals are expected outcomes the caller maps to a customer response.
 */
export function commerceCheckoutClient(env: CloudflareEnv, tenantId: string): {
  checkout(input: Readonly<Record<string, unknown>>): Promise<{ readonly status: number; readonly body: unknown }>;
} {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured commerce tenant");
  const stub = env.COMMERCE.get(env.COMMERCE.idFromName(normalizedTenant), { locationHint: "afr" });
  return {
    async checkout(input) {
      const response = await stub.fetch(`https://do.internal${INTERNAL_PREFIX}checkout`, {
        // The configured tenant is spread last, so a caller-supplied tenantId can never reach the DO.
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, tenantId: normalizedTenant }),
      });
      return { status: response.status, body: await response.json().catch(() => null) as unknown };
    },
  };
}

/**
 * Typed RPC to CommerceMarket; commerce ops never address another owner's SQL database. Lazy (issue 24 review 6): building the
 * client touches no binding and cannot throw, so a missing COMMERCE binding or a failing commerce object is seen only by the
 * call that needs commerce. The tenant check and the stub lookup both run per request.
 */
export function commerceMigrationClient(env: CloudflareEnv, tenantId: string): {
  request<T>(operation: "import" | "export" | "verify" | "status" | "cutover" | "rows", input?: Readonly<Record<string, unknown>>): Promise<T>;
} {
  const normalizedTenant = tenantId.trim();
  return {
    async request<T>(operation: "import" | "export" | "verify" | "status" | "cutover" | "rows", input: Readonly<Record<string, unknown>> = {}): Promise<T> {
      if (!normalizedTenant || normalizedTenant !== env.SHORTLET_TENANT_ID?.trim()) throw new Error("Tenant does not match the configured commerce tenant");
      const stub = env.COMMERCE.get(env.COMMERCE.idFromName(normalizedTenant), { locationHint: "afr" });
      if (operation === "import" || operation === "export") {
        if (typeof input.table !== "string" || !COMMERCE_OWNED_TABLES.has(input.table)) throw new Error("Table is not owned by COMMERCE");
      }
      return await postJson(stub, `ops/${operation}`, { tenantId: normalizedTenant, ...input }) as T;
    },
  };
}
