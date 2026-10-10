# Wave 5 handoff — Cloudflare deployment (slice 10b done; 11a–13 remain)

Written 7 Oct 2026. This document is a pointer sheet, not a duplicate of the plan. The
authoritative material lives in the repository; read it there.

## Objective

Implement **delivery wave 5** of the Cloudflare deployment effort: slices **10b, 11a, 11b, 12a,
12b, 13**. Wave 5 is only **partially complete** — 10b is done; 11a–13 are untouched.

## Where the work is

- **Worktree:** `C:/AI2026/chat-marketplace-cloudflare` (checked out on `infra/cloudflare-deployment`
  at its base `3b40d73`). All wave-5 work happens here, never in `C:/AI2026/chat-marketplace`.
- **Slice branch:** `infra/cf-10b-worker-do` — commits `4d48d1e`, `47e033f`. **Not yet merged into
  `infra/cloudflare-deployment`** (pending the user's decision; merging it unblocks 11a).
- `C:/AI2026/chat-marketplace` (session cwd, branch `main`) carries ~121 uncommitted source files
  plus untracked saved-stays/favourites work. **Do not disturb it** — that is why the Cloudflare
  work is in a separate worktree.
- Evidence logs from this session: `C:/AI2026/chat-marketplace-cloudflare/.scratch/cf-*-10b.log`
  (untracked; not committed).

## Everything you need to read (do not re-derive)

| What | Path |
| --- | --- |
| Wave/slice map, delivery waves, user-owned values, context pointers, wave-5 status note | `.scratch/cloudflare-deployment/map.md` |
| The PRD and the 17 workstreams | `.scratch/cloudflare-deployment/PRD.md` |
| **10b answer (what landed, evidence, gaps)** | `.scratch/cloudflare-deployment/issues/10b-worker-and-durable-object-scaffold.md` |
| Next slices | `issues/11a-ops-auth-and-operator-routes.md`, `11b-inventory-import-and-remote-cli.md`, `12a-daily-export-and-orphan-sweep.md`, `12b-restore-runbook.md`, `13-observability-and-edge-security.md` |
| ADRs that govern wave 5 | `docs/adr/0095-host-the-pilot-on-cloudflare.md` (0004, 0075, 0079, 0082, 0086, 0087, 0088, 0090) |
| Process gates | `AGENTS.md`, `docs/agents/issue-tracker.md` (Definition of Done), `docs/agents/coding-standards.md`, `docs/agents/domain.md` |

The 10b issue's `## Answer` has the full implementation/verification detail — read it before
touching 11a.

## State of 10b (summary only; details in the issue)

Landed: `apps/cloudflare/cloudflare.config.ts`, `src/worker.ts`, `src/shortlet-pilot-do.ts`
(`ShortletPilot`), `src/do-alarm.ts`, `src/pilot-assets.ts`, `src/node-sqlite-stub.ts`, a Vite alias
+ `scripts/check-worker-bundle.mjs` guard, `scripts/check-worker-bundle.d.mts`,
`test/cloudflare-worker-bundle.test.ts`, `apps/cloudflare/test/pilot-worker.spec.ts`, the cf project
manifest, and a small additive `telemetrySink` dependency on both composition roots.

Green in this session: `npm run check`; `npm run test:workers` (31/31, incl. the new 10b spec); the
Vite build (320 modules, 0 real `node:sqlite` imports).

## Known blockers / environment caveats (do not fight these blind)

1. **`cf build` / `cf dev` / `cf deploy --dry-run` are unusable on this Windows install.** The pinned
   beta spawns the extension-less `node_modules/@cloudflare/vite-plugin/bin/cf-vite`, which fails
   with `ENOENT`. Validate the build with `npx vite build` run from `apps/cloudflare` instead (it is
   the same Vite build `cf build` delegates to), and note the gap rather than inventing a command.
2. **`npm test` needs ambient pilot env.** The pilot/browser suites call the untouched
   `createGuestRequestHandler` → `loadPaystackConfiguration()`, which throws without
   `PAYSTACK_SECRET_KEY` / `PAYSTACK_ENVIRONMENT` / `PAYSTACK_CALLBACK_BASE_URL` exported. This
   session's shell lacked them (316/348 failures were that one error). Export the pilot env before
   claiming a full-suite gate.
3. **`cf` project detection** needs `apps/cloudflare/package.json` (committed) **and** a project-local
   `node_modules` junction to the repo root (local-only, gitignored) for the plugin to be "installed".
4. The `apps/cloudflare` Worker-source tsconfig imports Workers types *as a module*
   (`src/cloudflare-workers.d.ts`, `src/env.d.ts`) rather than loading the workers-types global
   script, because that script's globals clash with the repo's Node/DOM globals (`Buffer`, `Request`,
   `Response`, `HTMLElement`). `node:sqlite` is kept out of the Worker by the alias + bundle guard,
   not by the type program.

## Immediate next steps

1. Ask the user whether to merge `infra/cf-10b-worker-do` into `infra/cloudflare-deployment`.
2. Then take **11a** (unblocked by 10b). Its user-owned decision is already answered: shared-secret
   header `X-Shortlet-Ops-Secret`, provisioned as secret `OPS_SHARED_SECRET`; Cloudflare Access JWT
   layer = `Cf-Access-Jwt-Assertion` verified against the team certs. The `/_ops` seam is already
   present in `shortlet-pilot-do.ts` (`#handleOps`, currently 404) and runs **before** the
   provisioning gate.
3. For 11b/12a/13 use the values recorded in `map.md` ("Wave 5 session" note). Follow the AGENTS.md
   implementation protocol: one failing `test()` per acceptance criterion, ADR table, DoD checklist,
   then resolve the issue and update `map.md`.

## Constraints to respect

- Keep the Node pilot and `npm test` green; stay inside each slice's "Out of scope" list.
- Do not invent policy values or `cf` subcommands — ask.
- No secrets in code, logs, audit or telemetry (ADRs 0075/0086); never commit `.dev.vars`.
- Do not run a formatter over `apps/local-guest/src/shortlet-foundations.css` (AGENTS.md).

## Suggested skills

Invoke in this order for the next session:

1. **`issue-tracker`** — the Definition of Done and issue conventions this repo requires
   (`docs/agents/issue-tracker.md`).
2. **`tdd`** — the failing-test-per-acceptance-criterion protocol AGENTS.md mandates.
3. **`code-review`** — before resolving 11a, to self-review the fail-closed auth layering
   (AGENTS.md anti-pattern 1).
4. **`domain`** — the no-invented-logic / ADR-compliance workflow for the `/_ops` and export slices.
5. **`diagnose`** — if the `PAYSTACK_*` or `cf`-spawn environment issues resurface.

## Redaction

No credentials are recorded here. Paystack/Gemini/Resend/ops secrets are declared as bindings only
(`bindings.secret()`) and must be supplied via `.dev.vars` (gitignored, template at
`apps/cloudflare/.dev.vars.example`) or the deploy secret workflow.
