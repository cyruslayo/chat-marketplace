# Cloudflare configuration loader

Status: claimed
Type: task
Blocked by: 05b
Branch: `infra/cf-10a-config`
Requested: 2 Oct 2026
Unlocks: 10b

## Why

`loadPilotConfiguration` (`apps/pilot/src/pilot-config.ts:216`) reads `process.env`, requires file paths (`SHORTLET_DB_PATH`, `SHORTLET_INVENTORY_PATH`, `SHORTLET_OPERATORS_PATH`), and loads units and operators from JSON. On Cloudflare:
- configuration comes from the Worker `env` (vars and secrets);
- there are no files;
- inventory and operators live in SQLite (05b).

Every safety check must carry over **exactly**.

## What to build

- Export `publicOrigin` (`pilot-config.ts:155`, currently not exported).
- Split `loadPilotConfiguration` into two parts:
  - a pure core that validates everything that is not a file path, from an explicit `source`;
  - the Node wrapper that adds the path, file and JSON checks.
  `loadPilotConfiguration` keeps its signature and behaviour.
- `apps/cloudflare/src/cloudflare-config.ts`: `loadCloudflareConfiguration(env: CloudflareEnv)` calls the shared core with `env` as the source. It reuses the core's validation of:
  - `pilotDeployment`, `betaInviteCode`, `publicOrigin`, `paystackTransfersEnabled`, `manualTransferAccount`, `receiptMaxBytes`, `pilotLimits` and `notificationConfiguration`;
  - `loadPaystackConfiguration` **with an explicit source**, not the `process.env` default at `paystack.ts:32–35`;
  - the staging rule that test keys are required;
  - the rule that the callback origin equals the public origin (ADR 0087).
- `CloudflareEnv` is a typed interface, with no `any`. It lists every var and secret the core reads, plus the bindings `SHORTLET`, `RECEIPTS`, `EXPORTS` and `ASSETS`.
- **The tenant and operator check.** Node requires the operators file to be non-empty and `SHORTLET_TENANT_ID` to match it (:95–96). On Cloudflare, the operators are in SQLite and may be empty on first boot, before 11b's import. Keep the tenant check against SQLite when operators exist. **Ask the user** how an empty first boot should behave, for example `/healthz` returning 503 "not provisioned" until inventory is imported, and record the answer.

## Out of scope

- `cloudflare.config.ts` bindings and modes (10b). Changing any validation rule.

## Acceptance criteria

- AC1: `loadCloudflareConfiguration` refuses every invalid input that `loadPilotConfiguration` refuses, apart from the file-path checks. A shared, table-driven test runs the same cases through both loaders.
- AC2: With `PAYSTACK_CALLBACK_BASE_URL` different from `SHORTLET_PUBLIC_ORIGIN`, loading fails (ADR 0087).
- AC3: With `SHORTLET_DEPLOYMENT=staging` and a live Paystack key, loading fails.
- AC4: `process.env` is never read by the Cloudflare loader. Failure path: a test sets a conflicting `process.env` value and asserts the `env` value wins.
- AC5: The existing pilot-config tests pass unchanged. `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0087 | Live client bound to the public origin | callback-origin check kept |
| 0088 | Transfers gated | `paystackTransfersEnabled` reused |
| 0090 | Configured receipt limit | `receiptMaxBytes` reused |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

### Implementation plan and approved decisions

User approved 32 configurable production session runtimes (local/unset remains uncapped) and fail-closed first boot: normal routes and health return 503 “not provisioned” until valid inventory and tenant-matching operators exist; authenticated provisioning remains available. 10a exposes readiness, not routes; 10b/11a/11b wire HTTP enforcement. No demo fallback.

1. Add dedicated failing AC1–AC5 tests plus SQLite readiness tests.
2. Extract the existing non-file validators into a filesystem-free shared core, preserving their rules and Node exports/signature; implement the explicit-env Cloudflare loader and repository readiness check.
3. Run focused unchanged pilot suites, compiler checks, Workers tests and the full serial Node/browser suite. Verify all DoD items before resolving.

| ADR | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004 / 0095 | SQLite authoritative; no filesystem/demo fallback in Workers; synchronous SQL | repository readiness and filesystem-free loader |
| 0087 | Environment-bound Paystack and matching public/callback origin | AC1–AC4, shared validation |
| 0088 | Transfer capability enabled only by explicit valid configuration | AC1, shared switch |
| 0090 | Complete configured manual-transfer account and positive receipt limit | AC1, unchanged validators |
| 0075 | No credentials or restricted data in logs | no logging in loader/readiness |
| 0065 / 0095 | Counsel, vendor and retention gates stay open | local synthetic checks only; no deployment/release claim |
