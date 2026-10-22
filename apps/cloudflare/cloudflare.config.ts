import { bindings, defineConfig, defineWorker, exports } from "cf/config";
import * as entrypoint from "./src/worker.ts" with { type: "cf-worker" };

/**
 * Typed Cloudflare configuration for the Shortlet pilot (slice 10b).
 *
 * One Worker fronting one SQLite-backed Durable Object per tenant, plus the private `RECEIPTS`/`EXPORTS` R2 buckets
 * and the Static Assets that serve the browser bundles and CSS (09a/09b). `--mode staging` and `--mode production`
 * are complete, separate deployments: different Worker, bucket and Durable Object names.
 *
 * Secrets (Paystack, Gemini, Resend) are declared with `bindings.secret()` and never carry a value here; supply them
 * through the `cf` secret workflow or a local, git-ignored `.dev.vars` (see `.dev.vars.example`).
 */

type PilotEnvironment = "development" | "staging" | "production";

/** The public origin each deployment serves (the Paystack callback origin must equal this, ADR 0087). */
const PUBLIC_ORIGIN: Record<PilotEnvironment, string> = {
  development: "https://localhost:5173",
  staging: "https://staging.shortlet.ng",
  production: "https://pilot.shortlet.example",
};

/** The tenant whose inventory and operators this deployment owns. */
const TENANT_ID: Record<PilotEnvironment, string> = {
  development: "tenant-local-development",
  staging: "tenant-staging",
  production: "tenant-production",
};

/** A local-only invite code for the development beta gate. */
const DEVELOPMENT_INVITE_CODE = "local-development-invite";

/** Deployment inputs the operator supplies at deploy time; omitted means notifications stay off, as in Node. */
function optionalText(name: string) {
  const value = process.env[name]?.trim() ?? "";
  return value === "" ? {} : { [name]: bindings.text(value) };
}

function resolveEnvironment(mode: string | undefined): PilotEnvironment {
  if (mode === undefined || mode === "" || mode === "development") return "development";
  if (mode === "staging" || mode === "production") return mode;
  throw new Error(`Unknown Cloudflare mode "${mode}"; use development, staging or production`);
}

function workerFor(environment: PilotEnvironment) {
  const name = `shortlet-pilot-${environment}`;
  const staging = environment !== "production";
  return defineWorker({
    name,
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    // Static Assets are checked first: they serve the bundles and CSS without waking the Durable Object (09a/09b).
    assets: {},
    // 13: Workers Logs (ADR 0075). The handlers log nothing about requests; the Durable Object emits only redacted
    // telemetry and alarm-failure records. Invocation logs are off so no request metadata is recorded.
    observability: { enabled: true, logs: { enabled: true, invocationLogs: false } },
    exports: {
      ShortletPilot: exports.durableObject({ storage: "sqlite" }),
      PlatformDO: exports.durableObject({ storage: "sqlite" }),
      CommerceMarket: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      SHORTLET: bindings.durableObject({ worker: name, exportName: "ShortletPilot" }),
      PLATFORM: bindings.durableObject({ worker: name, exportName: "PlatformDO" }),
      COMMERCE: bindings.durableObject({ worker: name, exportName: "CommerceMarket" }),
      RECEIPTS: bindings.r2({ name: `${name}-receipts` }),
      EXPORTS: bindings.r2({ name: `${name}-exports` }),
      ASSETS: bindings.assets(),
      SHORTLET_PUBLIC_ORIGIN: bindings.text(PUBLIC_ORIGIN[environment]),
      SHORTLET_TENANT_ID: bindings.text(TENANT_ID[environment]),
      SHORTLET_DEPLOYMENT: bindings.text(staging ? "staging" : "production"),
      // The beta gate code: a local constant for development, an operator-supplied value for staging.
      ...(environment === "development"
        ? { SHORTLET_BETA_INVITE_CODE: bindings.text(DEVELOPMENT_INVITE_CODE) }
        : environment === "staging"
          ? optionalText("SHORTLET_BETA_INVITE_CODE")
          : {}),
      // ADR 0087: production takes live Paystack; staging and the local development run take test keys.
      PAYSTACK_ENVIRONMENT: bindings.text(staging ? "test" : "live"),
      // The guest runtime also reads the callback base from Workers process.env (declared bindings only); it must equal the public origin (ADR 0087).
      PAYSTACK_CALLBACK_BASE_URL: bindings.text(PUBLIC_ORIGIN[environment]),
      // ADR 0088/0090: transfers and manual bank transfer stay off until explicitly certified and configured.
      SHORTLET_PAYSTACK_TRANSFERS: bindings.text("disabled"),
      CONCIERGE_MODE: bindings.text(process.env.CONCIERGE_MODE?.trim() || "deterministic"),
      ...optionalText("LLM_BASE_URL"),
      ...optionalText("LLM_MODEL"),
      ...optionalText("LLM_PROVIDER_LABEL"),
      ...optionalText("CONCIERGE_DAILY_MODEL_CALL_CAP"),
      // ADR 0105: the staging-only public demo switch; the shared loader refuses it when SHORTLET_DEPLOYMENT is production.
      ...optionalText("SHORTLET_DEMO"),
      ...optionalText("SHORTLET_DEMO_ACCEPT_DELAY_SECONDS"),
      // Non-secret notification settings the operator supplies at deploy time.
      ...optionalText("SHORTLET_NOTIFICATION_FROM"),
      ...optionalText("SHORTLET_OPERATOR_ALERT_EMAILS"),
      ...optionalText("SHORTLET_NOTIFICATION_SWEEP_SECONDS"),
      // 11a: the Cloudflare Access application the `/_ops` routes sit behind.
      ...optionalText("CF_ACCESS_TEAM_DOMAIN"),
      ...optionalText("CF_ACCESS_AUD"),
      // 12a: export retention and the orphaned-receipt grace period (defaults are the approved values).
      ...optionalText("SHORTLET_EXPORT_RETENTION_DAYS"),
      ...optionalText("SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS"),
      // Secrets: names declared here, values never committed (cf secret workflow or .dev.vars).
      PAYSTACK_SECRET_KEY: bindings.secret(),
      GEMINI_API_KEY: bindings.secret(),
      LLM_API_KEY: bindings.secret(),
      RESEND_API_KEY: bindings.secret(),
      SHORTLET_GUEST_CODE_HASHING_KEY: bindings.secret(),
      OPS_SHARED_SECRET: bindings.secret(),
      // Issue 24 (user decision 18 Oct 2026, ADR 0075): the keyed payment reference secret; the id is a plain var, so rotation is a new id.
      COMMERCE_REFERENCE_HMAC_KEY: bindings.secret(),
      COMMERCE_REFERENCE_HMAC_KEY_ID: bindings.text("k1"),
    },
  });
}

export default defineConfig(({ mode }) => ({ worker: workerFor(resolveEnvironment(mode)) }));
