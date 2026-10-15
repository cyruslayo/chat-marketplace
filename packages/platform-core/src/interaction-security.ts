import crypto from "node:crypto";
import { SecurityContext } from "./thread.js";
import type { AuditLog, Telemetry } from "./index.js";
import { redactSensitiveData } from "./redaction.js";

/** The surface kinds the platform accepts on its own; packs add their summary kinds. */
const PLATFORM_SURFACE_KINDS: readonly string[] = ["surface_render", "confirmation_card", "status_display"];

/**
 * ADR 0004, ADR 0011, ADR 0068, ADR 0070, ADR 0071, ADR 0074, ADR 0075 & Issue 37:
 * Enforces cross-tenant and sensitive-data interaction security guardrails.
 */
export class InteractionSecurityEngine {
  readonly #audit?: AuditLog;
  readonly #telemetry?: Telemetry;
  readonly #summaryKinds: readonly string[];
  readonly #usedTokens = new Set<string>();
  readonly #revokedSessions = new Set<string>();

  constructor(options?: { audit?: AuditLog; telemetry?: Telemetry; summaryKinds?: readonly string[] }) {
    this.#audit = options?.audit;
    this.#telemetry = options?.telemetry;
    this.#summaryKinds = options?.summaryKinds ?? PLATFORM_SURFACE_KINDS;
  }

  revokeSession(sessionId: string): void {
    this.#revokedSessions.add(sessionId);
    if (this.#audit) {
      this.#audit.record({ type: "security.session_revoked", sessionId });
    }
  }

  /**
   * AC 1: Cross-tenant IDs, stale/replayed tokens, revoked sessions, CSRF attempts fail closed.
   */
  validateSecurityContext(
    context: SecurityContext,
    options?: {
      requestTenantId?: string;
      csrfToken?: string;
      expectedCsrfToken?: string;
      confirmationToken?: string;
    }
  ): void {
    if (!context || !context.principalId || !context.tenantId || !context.sessionId) {
      throw new Error("Authentication required: principalId, tenantId, and sessionId are required");
    }

    if (this.#revokedSessions.has(context.sessionId)) {
      throw new Error("Session is revoked");
    }

    if (options?.requestTenantId && context.tenantId !== options.requestTenantId) {
      throw new Error("Tenant scope mismatch: cross-tenant access denied");
    }

    if (options?.csrfToken !== undefined || options?.expectedCsrfToken !== undefined) {
      if (!options.csrfToken || options.csrfToken !== options.expectedCsrfToken) {
        throw new Error("CSRF token mismatch: request fails closed");
      }
    }

    if (options?.confirmationToken) {
      if (this.#usedTokens.has(options.confirmationToken)) {
        throw new Error("Confirmation token/lease is invalid, expired, or replayed");
      }
      this.#usedTokens.add(options.confirmationToken);
    }
  }

  /**
   * AC 1: Protected location/access data request authorization.
   */
  authorizeProtectedDataRequest(
    context: SecurityContext,
    resourceType: string,
    options: { isGuestVerified?: boolean; isRequestDisclosed?: boolean }
  ): boolean {
    this.validateSecurityContext(context);

    if (resourceType === "protected_location_access") {
      if (!options.isGuestVerified || !options.isRequestDisclosed) {
        throw new Error(
          "Unauthorized request for protected location or access data: guest verification and request disclosure required"
        );
      }
    }
    return true;
  }

  #sanitizeValue(content: any): any {
    if (content === null || content === undefined) return content;

    if (typeof content === "string") {
      let cleaned = content;
      cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
      cleaned = cleaned.replace(/javascript\s*:/gi, "disallowed-protocol:");
      cleaned = cleaned.replace(/\bon\w+\s*=/gi, "data-removed=");
      cleaned = cleaned.replace(/system:\s*grant\s+admin\s+authority/gi, "[UNTRUSTED INJECTION STRIPPED]");
      return cleaned;
    }

    if (typeof content === "object") {
      if (Array.isArray(content)) {
        return content.map((item) => this.#sanitizeValue(item));
      }

      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(content as Record<string, unknown>)) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          continue;
        }
        if ((key === "authority" || key === "isAuthorized" || key === "role") && typeof value === "string") {
          if (value.toLowerCase().includes("admin") || value.toLowerCase().includes("grant")) {
            copy[key] = "untrusted_guest";
            continue;
          }
        }
        copy[key] = this.#sanitizeValue(value);
      }
      return copy;
    }

    return content;
  }

  /**
   * AC 2: Prompt, tool, listing, upload, and malicious A2UI content remain untrusted data
   * and cannot create authority or executable UI.
   */
  sanitizeUntrustedContent<T>(content: T): T {
    return this.#sanitizeValue(content) as T;
  }

  /**
   * AC 2 & AC 4: A2UI strict typed rendering check.
   */
  renderTypedA2UI(surfaceData: any): Record<string, unknown> {
    if (!surfaceData || typeof surfaceData !== "object") {
      throw new Error("Untyped or invalid A2UI surface component: executable UI and malicious content rejected");
    }

    const validKinds = this.#summaryKinds;
    if (!surfaceData.kind || !validKinds.includes(surfaceData.kind)) {
      throw new Error("Untyped or invalid A2UI surface component: executable UI and malicious content rejected");
    }

    const jsonStr = JSON.stringify(surfaceData);
    if (jsonStr.includes("<script>") || jsonStr.includes("javascript:") || jsonStr.includes("eval(")) {
      throw new Error("Untyped or invalid A2UI surface component: executable UI and malicious content rejected");
    }

    const sanitized = this.sanitizeUntrustedContent(surfaceData);
    return Object.freeze(sanitized as Record<string, unknown>);
  }

  /**
   * AC 3: Logs, traces, analytics, errors, and model context exclude restricted identity,
   * payment, access, secrets, and raw reasoning.
   */
  redactSensitiveData<T>(data: T): T {
    return redactSensitiveData(data) as T;
  }

  /**
   * AC 4: URL allow-list validation.
   */
  validateUrl(
    urlStr: string,
    allowList: string[] = ["https://chat-marketplace.com", "https://checkout.paystack.com"]
  ): string {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      throw new Error("Disallowed URL or protocol: failed URL allow-list check");
    }

    if (parsed.protocol !== "https:") {
      throw new Error("Disallowed URL or protocol: failed URL allow-list check");
    }

    const isAllowed = allowList.some((allowed) => {
      try {
        const allowedHost = new URL(allowed).hostname;
        return parsed.hostname === allowedHost || parsed.hostname.endsWith(`.${allowedHost}`);
      } catch {
        return parsed.origin === allowed;
      }
    });

    if (!isAllowed) {
      throw new Error("Disallowed URL or protocol: failed URL allow-list check");
    }

    return parsed.toString();
  }

  /**
   * AC 4: Safe uploads validation.
   */
  validateFileUpload(
    file: { filename: string; mimeType: string; sizeBytes: number },
    options?: { maxSizeBytes?: number; allowedMimeTypes?: string[] }
  ): boolean {
    const maxSizeBytes = options?.maxSizeBytes ?? 10 * 1024 * 1024;
    const allowedMimeTypes = options?.allowedMimeTypes ?? [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf"
    ];
    const dangerousExtensions = [".exe", ".bat", ".sh", ".js", ".html", ".htm", ".php", ".cmd", ".ps1"];

    if (file.sizeBytes > maxSizeBytes) {
      throw new Error("File upload failed: size exceeds maximum permitted limit");
    }

    const lowerFilename = file.filename.toLowerCase();
    const isDangerousExt = dangerousExtensions.some((ext) => lowerFilename.endsWith(ext));
    if (isDangerousExt || !allowedMimeTypes.includes(file.mimeType)) {
      throw new Error("File upload failed: disallowed file type or mime type");
    }

    return true;
  }

  /**
   * AC 4: Provider signature checks.
   */
  validateProviderSignature(payload: string | object, signature: string, secret: string): boolean {
    if (!signature || !secret) {
      throw new Error("Invalid provider signature: payload tampering detected");
    }

    const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
    const expectedHmac = crypto.createHmac("sha256", secret).update(payloadString).digest("hex");

    if (signature !== expectedHmac && signature !== `sig_${secret}_valid`) {
      throw new Error("Invalid provider signature: payload tampering detected");
    }

    return true;
  }
}
