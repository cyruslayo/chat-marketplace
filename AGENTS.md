## Agent skills

### Tech Stack & Tooling

- **Language**: TypeScript (`tsconfig.json`, target `ES2022`, module resolution `NodeNext`).
- **Type Checking**: Run `npm run check` (`tsc --noEmit`) regularly to ensure zero type errors.
- **Testing**: Run `npm test` (`node scripts/run-tests.mjs`) to execute the full unit suite. It runs `tsx --test` on the non-browser files concurrently, then on the real-Chrome files one at a time. It is the pre-merge gate, not a per-issue step (see Test scope).
- **Coding standards**: See `docs/agents/coding-standards.md`. These rules are a hard gate — no `any` in domain types, no invented policy strings, no bearer credentials in logs, search before inventing a new pattern.

### Test scope

- **Per issue**: run `npm run check` plus only the test files the issue adds or touches, and the tests that cover the code it changes, e.g. `npx tsx --test test/<file>.test.ts` (several files in one command is fine), or narrow with `--test-name-pattern`.
- **Workers**: for Cloudflare Worker code the issue changes, run only the matching `apps/cloudflare/test/*.spec.ts` with `npm run test:workers -- <spec path>` (the extra arguments reach the `vitest run` step). If that filter does not work, run `npm run test:workers` instead.
- **Real Chrome**: run a real-Chrome test file only when the issue changes that screen or that test, one at a time, never two at once.
- **Record**: write the exact commands and pass counts in the issue's `## Comments`.
- **Pre-merge (once per batch)**: after every issue in the batch is resolved, run `npm run check`, `npm run test:workers` and the full `npm test` once. Run `npm test` in the background with a long timeout. Fix any failures before merging to main.

### Issue tracker

Issues and PRDs are tracked as local Markdown under `.scratch/shortlet-concierge-launch/issues/`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md` for conventions and the **Definition of Done** checklist that must be satisfied before any issue is marked `resolved`.

### Triage labels

Use the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` states. See `docs/agents/triage-labels.md`.

### Domain docs & ADR Compliance

This repository uses a multi-context layout rooted at `CONTEXT-MAP.md`, with bounded contexts under `domains/` and `packages/`.

**CRITICAL: Architectural Decision Records (ADRs)**
System-wide architectural decisions are recorded in `docs/adr/`. Agents frequently fail by assuming domain logic instead of checking ADR constraints. To guarantee ADR compliance, agents MUST follow these steps for every implementation task:
1. **Discover:** List the contents of `docs/adr/` and read every ADR whose title or subject intersects with your domain. Do not skip this step.
2. **Acknowledge:** In your implementation plan, produce an explicit table: for each relevant ADR, state which constraint it imposes and which acceptance criterion or code path it affects.
3. **Map:** Before writing any code for an acceptance criterion, confirm which ADRs govern it. Write the ADR number in a comment at the callsite if the constraint is non-obvious.
4. **Verify:** After implementation, re-read the ADR table and confirm every constraint is reflected in the code. Never silently override an ADR.

See `docs/agents/domain.md` for the no-invented-logic rule, vocabulary standards, and ADR conflict guidance.

### Common Agent Anti-Patterns (Do NOT do these)

Code reviewers frequently catch agents making the following mistakes. Prevent them proactively:
1. **Loose Negative Validation (Fail-Open):** When verifying identity or authorization, do not use loose truthy checks (e.g., `if (payload.id && payload.id !== expected)`). If a field is missing, it must **fail closed** (e.g., `if (!payload.id || payload.id !== expected)`).
2. **Static Projections for Time-Bound State:** If a domain entity has an expiry or deadline, its projection methods (`projectState`) MUST lazily evaluate that expiry against the current clock. Do not assume the entity will magically transition to "expired" in memory without a background cron or a lazy check.
3. **Hardcoding Policies:** Never hardcode thresholds (e.g., `riskScore < 50`) as magic numbers inside domain logic. Accept them as configurable constructor options (e.g., `options.riskScoreThreshold ?? 50`) or derive them from explicit policy documents.
4. **Duplicating Test Fixtures:** Do not copy-paste complex `createEnvelope` or `createMock` functions across multiple test files. Extract them into shared test utility modules.
5. **Silencing with `any`:** `any` casts in the domain layer are strictly forbidden. Use `unknown` with narrowing guards or define explicit interfaces (e.g., `interface UnitRecord`) when dealing with loosely-typed repository returns.

### Implementation protocol

Follow this sequence for every issue. Do not skip steps.

1. Read the issue, its "What to build" section, and every acceptance criterion.
2. List `docs/adr/` and read all ADRs that touch the domain. Record which apply and what they require.
3. Read the relevant `CONTEXT.md` and confirm all terms used in the issue are defined there.
4. Write failing tests — one `test()` per acceptance criterion, named to mirror the criterion text, covering both success and all named failure paths.
5. Implement until the issue's own and affected tests pass and `npm run check` is clean. "All tests" here means those tests, not the full suite (see Test scope).
6. Before resolving: self-review against the Definition of Done in `docs/agents/issue-tracker.md`. Check every item on that list explicitly.
7. Commit, then mark the issue `resolved`.

### Concierge assistant path (ADR 0092, 0093, 0106)

Read ADR 0106 in full (and 0092, 0093 for dates and guest accounts) before touching `apps/local-guest/src/assistant/` or the shell/runtime sync in `apps/local-guest/src/shortlet-app.ts`. Bugs found live on staging all came from the same place, so test for it:

- **Every Worker request is a cold restore.** The shell (`thread.*`, `#syncAssistantPersistence`, `#rebuildAssistantDiscovery`) and the assistant runtime hold separate state, and the Worker rebuilds both on each request. Any id the guest holds (discovery surface and artifact id, unit-detail artifact id, contact-details surface id) must be persisted and re-keyed on restore, never re-minted. Guards stay fail closed: forged, superseded or unknown ids must still return `STALE_SURFACE` / `ARTIFACT_MISMATCH`.
- **Tests must run with the assistant runtime enabled and a cold restore (new `LocalGuestApp` over the same store) before every event**, on a fresh thread, with a staging-like clock (2026-10-27) and a staging-like guest (no seeded phone or email). Tests that only use the non-assistant path hid every one of these defects. `test/assistant-cold-journey.test.ts` is the model: search, View, Request to Book, phone, submit, offer, accept, email, payment handoff.
- **Date authority is fail closed.** A model-proposed `checkIn` needs guest-authored text (ISO token or English day-month literal), prior guest text, or structured guest input (chip edit). Chip dates, nights and party size are structured guest input and must reach `thread.assistantContext` and the runtime facts. A planner `search_stays` missing nights or party size is a rejected tool call (`tool_denial`), never a thrown error (a thrown error becomes `CONCIERGE_UNAVAILABLE`).
- **No deterministic in-scope fast path.** Do not add keyword shortcuts around the model or classifier to hide a flaky live turn; diagnose from the closed diagnostics (`assistant.control.outcome.v1`).
- The criteria strip (`criteria` projection) must come back on assistant responses too, not only on `getState`.

### Staging deployment (Cloudflare, workers.dev)

- **The owner runs every Cloudflare command** (`cf deploy`, `cf auth`, `cf zero-trust`, secrets, wrangler). Agents prepare the build, verify it, and give the exact command. Never deploy, push or change remote settings without explicit approval.
- **Secrets.** Never open `staging-secrets.env` (home folder; the owner deletes it after deploy). Never print the environment (`export`, `env`, `set`, `printenv` leak `LLM_API_KEY`); prefix commands with `env -u LLM_API_KEY`. If a key is ever printed, tell the owner to rotate it. Never type secret values.
- **Build from a clean, detached worktree at the exact commit you gated** (for example `git worktree add C:\AI2026\chat-marketplace-staging <sha> --detach`), never from the main checkout, which carries uncommitted edits and build output. Junction `node_modules` and `apps/cloudflare/node_modules` from an existing worktree the way `chat-marketplace-merge` does. Run `npm run build` at the repo root first: it writes the git-ignored `apps/cloudflare/public/*` and `apps/local-guest/dist/*` (landing assets; without it `landing-assets.spec.ts` returns 404). The build only rewrites line endings in tracked `_headers` and `dist/*.js`; never commit them.
- **Build** (from `apps/cloudflare`, no trailing dot; use `node ../../node_modules/@cloudflare/vite-plugin/bin/cf-vite build --mode staging` when `apps/cloudflare/node_modules` is a junction or missing). Required env: `SHORTLET_DEMO=enabled CONCIERGE_MODE=openai-compatible LLM_BASE_URL=https://openrouter.ai/api/v1 LLM_MODEL=openai/gpt-6-luna LLM_PROVIDER_LABEL=openrouter CONCIERGE_DAILY_MODEL_CALL_CAP=1500 CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com CF_ACCESS_AUD=<aud tag>`, with `LLM_API_KEY`, `COMMERCE_ENABLED`, `RESEND_API_KEY`, `GEMINI_API_KEY` unset.
- **Verify the built descriptor** (`apps/cloudflare/.cloudflare/output/v0/workers/default/worker.config.json`) without printing values: worker `shortlet-pilot-staging`, exactly four secret bindings (`PAYSTACK_SECRET_KEY`, `LLM_API_KEY`, `SHORTLET_GUEST_CODE_HASHING_KEY`, `OPS_SHARED_SECRET`), `COMMERCE_ENABLED` false, workers.dev origin, cap 1500, Access vars present. No repo script loads a prebuilt bundle into local workerd, so only the static guard covers startup errors; the first live request is the real load test (do not invent a script, add one as an issue). Run `npm run check` in the staging worktree before handing over: a check that passes in the main checkout can fail on the committed tree (a test helper left uncommitted broke `tsc` once). Worker modules must not use `import.meta.url` at module scope (`scripts/check-worker-bundle.mjs`).
- **Deploy command the owner runs:** `cd <worktree>\apps\cloudflare && npm exec cf -- deploy --prebuilt --mode staging --secrets-file C:\Users\Cyrus\staging-secrets.env`.
- **Access.** `/_ops/*` needs both the Cloudflare Access JWT and `x-shortlet-ops-secret`; guest pages are public. `demo:provision` needs the Access service token (client secret kept in the owner's password manager, expires 27 Oct 2027).
- **Demo data.** Staging units come only from `apps/cloudflare/demo/inventory.csv` (trust fields expire 2027-12-31, which blocks offers from about 19 Sep 2027 under the 104-day rule: refresh before then). The TypeScript fixture seeds (`DEMO_TRUST_EXPIRES_ON` in `domains/shortlet/src/browse.ts`) are local only. Do not change the 104-day rule to make a demo pass.
- **Operator Active Hours** (ADR 0041, 0042): a Booking Request can only be submitted 8:00 AM to 7:30 PM WAT (UTC+1), and by 10:55 AM WAT on the check-in date. A refused submit outside that window is policy, not a bug; test submits in daytime Lagos hours and tell demo testers.
- **Paystack** test webhook: `<origin>/webhooks/paystack`, subscribe only to `charge.success` (the Transactions group); the code ignores every other event. The Worker needs only the Paystack **secret** key (`PAYSTACK_SECRET_KEY`, test key `sk_test_...`, no stray whitespace); the public key is not used because checkout is server-initialized and hosted. After a deploy, confirm in the Paystack dashboard that `charge.success` was delivered with a 200 (the Worker logs no line for it).
- **Payment failures are diagnosed from closed log lines**, never from guesses. The Worker writes `{"event":"payment_continuation_rejected","reason":...,"statusClass"?}` (standalone link) and `{"event":"card_checkout_failed","reason":...,"statusClass"?}` (chat). `statusClass` is one of `auth_failed` (Paystack 401/403: the secret key is wrong or malformed), `invalid_request`, `not_found`, `rate_limited`, `server_error`, `unsuccessful_body`, `other`. Lines carry no ids, URLs, tokens or provider text (ADR 0075). The owner authorised read-only log queries with the CF CLI: `cd <worktree>/apps/cloudflare && env -u LLM_API_KEY npm exec cf -- observability telemetry query --body '{"queryId":"x","timeframe":{"from":<ms>,"to":<ms>},"view":"events","limit":100,"parameters":{"datasets":["cloudflare-workers"],"filters":[],"calculations":[]}}'`. Timestamps are UTC (WAT = UTC+1). Write the output to a file and filter it with node; do not print it. This is the only `cf` command an agent runs, and only when the owner asked for logs.
- **Payment references** are `psp-ref-<alnum>-<ms>` (period payments `psp-ref-period-<index>-<token>`): Paystack accepts only `[A-Za-z0-9.=-]`, and the adapter refuses other characters before fetch. Bank-transfer references (`exp_trf_<hex>`) still contain an underscore; that is an open ADR 0047 decision.
- **Payment Window** is 20 minutes after Accept Offer. The Paystack start call is bounded at 20 s (`PAYSTACK_CHECKOUT_PROVIDER_TIMEOUT_MS`) and reports `provider_unreachable`. Known gap (ADR 0046): a late `charge.success` on a superseded or reminted reference is ignored, with nothing recorded or refunded.
- **Conditional Offer confirmation tokens** are stored only as SHA-256 digests (`confirmationTokenDigests`, max 16, single use; ADR 0086). A legacy row with a raw token fails closed once.

### Live verification in the browser

- Use the built-in browser against the staging origin, with synthetic data only (placeholder phone `+234 801 234 5678`). Drive the chat workspace at `/` (the `/conversation` page is the no-JS fallback). The criteria strip chips live under "Edit search".
- Stop before any card entry on a third-party payment page (Paystack): the owner pays with the published test card. After payment, check the confirmation screen and that the webhook arrived.
- Browser pane habits: refs go stale after a form re-render (re-read, fill and click at once, or click by exact button text through `javascript_tool`); the pane may report a 0x0 viewport (call `resize_window` with preset `desktop` and `tabs_select`); prefer `get_page_text` over screenshots, which time out. The chat input only accepts a real input event. Do the journey in this order: search, View apartment, Review request, phone (saved before Submit), Submit, Accept Offer, Continue to stay payment (asks for email first), hosted checkout, owner pays, confirmation. Allow for the Operator Active Hours and the 20-minute Payment Window before starting.
- A live defect goes to an agent as: the exact `/api/event` or `/api/turn` response body, the failing step, and the expected behaviour. Fix offline, tests first, rebuild, then retest.

### Orchestrating agents

- Branches: as of 2026-10-29 `main` contains `integration/concierge-controls` and the staging-checkout fixes (origin/main at ef8ad75). Branch new work from `main`. Another session may still write to `C:\AI2026\chat-marketplace-integration`; never touch that worktree from a different session. Merge in a dedicated worktree (for example `chat-marketplace-merge`), and gate there; the main checkout holds uncommitted owner edits, so a merge into it can be blocked by overlapping edits or untracked files. Do not stash or discard: commit the owner's overlapping edits with explicit paths if the owner approves, or back up untracked files outside the repo, and tell the owner what you did. Commit helpers that committed tests import, or `tsc` passes locally and fails on the committed tree.
- Explicit-path commits only, no reset, clean, stash or force, never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. One writer per worktree at a time.
- Agents often hand back partial reports. Verify with `git log` and `git status`, not the report, and resume the same agent with a narrow "finish these, foreground, do not hand back early" instruction. Address `SendMessage` to the right agent id; a stray message resumes a finished agent.
- Treat agent claims as unverified: one report said offers were blocked on staging by seed dates when staging uses the CSV, not the seeds.
- Pre-merge gates (check, `test:workers`, full `npm test`) run once on the final commit, before any merge to main. Known accepted failures: two commerce real-browser files (`commerce-store-pages.real-browser`, `commerce-surfaces-chromium`) while commerce is not shipping; load flakes that pass solo: `back-office-manual-transfers`, `back-office-owner-overpayment`, `guest-cross-tab-concurrency`, `model-quota-host-recovery`, `mobile-guest-journey-chromium` (900 s timeout under load), `pilot-local` AC4 and the 5-second Worker specs `data-migration.spec.ts` D2. Triage a red file by running it solo before touching code. `apps/cloudflare/test/daily-export.spec.ts` D3 also fails solo (5.7 s against a 5 s limit); raise its timeout rather than treating it as a regression. Pushing to origin shows a "required status check `verify`" notice; the push still lands.
- Windows/Git Bash: `git show <branch>:<path>` is mangled by path conversion; use `MSYS_NO_PATHCONV=1 git cat-file -p <sha>:<path>`. Strip CR from `git diff --name-only` output before looping over it. A CRLF warning on commit is harmless.

### Guest UI work (kit, walkthrough and captures)

Any change to a guest screen (chat workspace or standalone page) follows the guest UI consistency effort in `.scratch/guest-ui-consistency/` (`PRD.md`, `map.md`, `design/`, canvas <https://claude.ai/artifact/TKQCWTF4SWNscKrjLkN1zX>).

- **Use the kit, don't invent components.** The component list is in `docs/design/shortlet-design-system-direction.md` ("Guest UI kit"). CSS is the "Guest UI kit" block of `apps/web/src/shortlet-foundations.css`, server markup helpers are in `apps/local-guest/src/guest-kit.ts`, and copy/labels come from `apps/web-agent/src/guest-content.ts` (`GUEST_FACT_LABELS`). Chat and the standalone page must render the same content from the same helper. Use semantic tokens only (no hex, no page-level `style:` strings); dark mode comes from the tokens. Keep the committed CSS formatting: the foundation tests match it with regexes, so do not run a formatter over `shortlet-foundations.css`.
- **Run the app to see it.** `npx tsx .scratch/guest-ui-consistency/walkthrough.ts` serves one local guest per booking stage on fixed ports 3021+ (local test data only); `node .scratch/guest-ui-consistency/start-walkthrough.mjs` starts it detached and logs to `walkthrough-06.log` (delete the log afterwards). Prefer `withStagePage` / `withRequestScreen` in `test/helpers/` for tests.
- **Capture and check screens.** Every UI issue ends with screenshots at 320, 390, 768 and 1280 plus a check for horizontal overflow and controls under 44px (ADR 0078):
  - `capture.ts name=url ...`: quick light-theme captures of any URLs.
  - `capture-07.ts`, `capture-08.ts`, `capture-09.ts`, `capture-10.ts`: the request, offer, payment and confirmation/system screens (page and chat), asserting reflow and targets. Copy one as the starting point for a new screen group.
  - `capture-11-all.sh` (runs `capture-11.ts` once per screen group): the full sweep of every design screen, light and dark, into `screenshots/final/`, with `findings-*.txt`. Run groups in separate processes; two fixtures in one process break the shell load. Re-run it after any shared CSS or shell change.
  - Save new captures under `screenshots/<issue number>/`. Hidden native radio inputs report as 1x1; their labels are the 44px targets.
- **Desktop split and clean-up rules.** At 64rem+ an open workspace sits beside a ~460px conversation (workspace 560px, discovery 760px); `.waiting-panel`, `.stay-result` and page-level payment style strings are retired (`test/guest-retired-classes.test.ts`). `.stay-card` and `.stay-grid` remain only as client hooks.
- **Browser phase of `npm test` takes about 12 minutes.** It runs once, in the pre-merge gate (see Test scope). Run it in the background with a long timeout, and never run two browser suites or capture sweeps at once.
