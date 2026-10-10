# Cloudflare configuration loader

Status: resolved
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

## Answer

Implemented in `a3fdb15` on `infra/cf-10a-config`. Shared non-file validation now lives in `apps/pilot/src/pilot-config-core.ts`; the Node wrapper retains its signature, exports, file/repository checks and original error ordering. Cloudflare uses explicit env values, inherits all shared vars/secrets and types the four service bindings. Extracted the unchanged `ManualTransferAccount` interface into its own module so configuration type-checking does not pull the receipt implementation into the Worker source check; existing domain imports remain compatible through the type re-export.

`cloudflareProvisioningState` reads the existing SQLite repositories, validates tenant matching and unit/operator associations, and re-evaluates after imports. Empty data reports `provisioned: false`, with no demo fallback. Malformed or inconsistent records fail closed. This does not certify publication eligibility or impose new booking rules. HTTP 503 enforcement and authenticated provisioning availability remain assembly work in 10b/11a/11b, not implemented routes in this slice. The approved production cap of 32 is recorded for 04c/10b, not silently added to Node defaults.

Validation on the committed code: `npm run check` passes all four compiler projects; `npm run test:workers` passes 16 tests (14 existing + two configuration/readiness workerd checks); full serial `npm test` exits 0 with **1,317 non-browser and 165 browser tests passed, zero failures, one expected browser skip**. Focused configuration, production composition, guardrail and notification tests also pass. The new Node suite initially failed because the Cloudflare loader did not exist (`C:/AI2026/cf-10a-red.log`). Evidence: `C:/AI2026/cf-10a-{focused,check,workers,full}.log`, `cf-10a-full.exit` (0). The full run unsets the previously documented `PI_REASONING_LEVEL` test-environment variable. Workers reports only the existing Gemini missing-source sourcemap warning. Active LSP probes report no errors but are inconclusive; successful explicit compiler runs supply the verification gate.

No deployable Cloudflare configuration exists yet (10b), so this slice validates real workerd imports/runtime rather than claiming a production `cf build`, dry-run or deployment. No push, hosted PR, staging or production release.

### Definition of Done — explicit self-review

1. Dedicated named AC1–AC5 `test()` blocks in `test/cloudflare-config.test.ts`; separate SQLite first-boot/readiness test and two workerd runtime checks.
2. Shared invalid-input table exercises refusal paths through both loaders; callback mismatch, staging/live refusal, conflicting process environment, Node path refusals, empty data, tenant mismatch and missing Operator are asserted. Success paths also pass.
3. Relevant ADRs listed/read and mapped above; implementation commit cites the constraints. Rechecked the table: callback/environment/transfer/receipt checks retained, SQLite authoritative, no credential logging or demo fallback, launch gates unchanged.
4. No unused constructor dependency introduced. The readiness function uses its database and configuration; service bindings are env declarations for later assembly, not injected class dependencies.
5. No invented domain policy or changed validation rule. The two user-approved decisions are recorded with their downstream wiring scope; existing operational defaults remain unchanged.
6. No bearer credentials, restricted identity material or request bodies added to audit/logs. All checks use synthetic local data.
7. Compiler, full Node/browser suite and workerd tests pass as recorded above. Whitespace checks pass.
