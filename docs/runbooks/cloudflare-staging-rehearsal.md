# Staging rehearsal for the Cloudflare pilot (issue 15)

This runbook is for the human who runs the staging rehearsal. An agent prepared it; the agent does not deploy,
authenticate to Cloudflare or Paystack, handle secrets, or decide go/no-go. Every step below is performed by the
operator, and every result goes in the evidence log at the end (and into the issue's `## Comments`).

Commands use the project-pinned `cf` CLI (`cf@1.0.0-beta.12`, slice 01c). The build and the dry run are npm scripts in the
repository root. They install the Cloudflare app's own dependencies from its lockfile on first use (issue 16 C, see
`docs/pilot-deployment.md`, "Building the Cloudflare Worker from a clean checkout"), so a clean checkout needs `npm ci` first:

```bash
npm run worker:build:staging
npm run worker:deploy:dry-run:staging
```

The real upload is `cf deploy --prebuilt --mode staging` run from `apps/cloudflare` after the same install step. Run it only in
section 1, step 4, as the operator.

## 0. Preconditions and open gates

Read this section before any step. Real personal data must not be used on staging until the gates below are closed.
Staging uses **Paystack test keys and synthetic data only**.

| Gate | Source | State at preparation | Effect on this rehearsal |
| --- | --- | --- | --- |
| Nigerian counsel approves the cross-border transfer basis, safeguards and destinations | ADR 0095, ADR 0065 | **OPEN** | No real-person data on staging. Synthetic data only. |
| Vendor contracts and processor roles for Cloudflare (Workers, Durable Objects, R2, Logs) and Google Gemini | ADR 0065, ADR 0095 | **OPEN** | Same as above. |
| Approved retention schedule (ADR 0075 periods are provisional; export retention 400 days and orphan grace 24 hours are the user-confirmed provisional values) | ADR 0075, issues 12a and 14 | **OPEN** | Retention behaviour is tested, not approved. |
| DPIA update (issue 14) reviewed by a human | Issue 14 | Architecture accepted; external gates open | The exported personal-data columns listed in issue 12a must be recorded before any real-data use. |

Known tooling and configuration gaps to resolve before the build (each is recorded in the issue answers):

1. **`cf build` on the Windows development install fails.** The pinned beta spawns an extension-less plugin bin
   (`node_modules/@cloudflare/vite-plugin/bin/cf-vite`) and gets `ENOENT` (issues 10b, 13). Run this rehearsal from a
   host where `npm run worker:build:staging` succeeds on a clean checkout. If it does not succeed anywhere, stop: this is a
   blocker, not a step to work around.
2. **The staging origin is `https://shortlet-pilot-staging.khayutsefi.workers.dev`** (the owner chose the workers.dev URL). `apps/cloudflare/cloudflare.config.ts`
   sets `PUBLIC_ORIGIN.staging` to it. Before the build, confirm that this URL serves the staging Worker, because
   `SHORTLET_PUBLIC_ORIGIN` and the Paystack callback base URL depend on it. The production origin is unchanged.
3. **`pilot:local:agent-smoke` is in-process only, and stays that way by user decision.** It runs the assistant against a
   live model with no HTTP surface, and it refuses a base URL before any model call. It is never run against staging.
   The remote journeys are the Rodney acceptance run (`pilot:acceptance:rodney` with `SHORTLET_BASE_URL`) plus the
   human-run real-Chrome journeys.
4. **The Rodney harness payment steps assume the local deterministic PSP.** The base-URL change lets the harness run
   against staging, but its downstream payment and confirmation assertions were written for the local fixture. Inspect
   any failure at the payment step before treating it as a product defect. The Paystack test-mode card payment in
   step 5 is the authoritative payment proof.
5. **No live log tail.** The pinned beta has no `cf tail` (issue 01c). Use the dashboard view listed in step 7.
6. **Point-in-time recovery exists only on the real storage back-end.** Workerd's local storage cannot run the
   bookmark round trip (issue 12b), so step 6 is staging-only evidence.

Environment for the staging deployment (names only; values are never written in this runbook, the issue, the
evidence log or chat):

- Non-secret vars declared in `cloudflare.config.ts` for `staging`: `SHORTLET_PUBLIC_ORIGIN`, `SHORTLET_TENANT_ID`,
  `SHORTLET_DEPLOYMENT=staging` (set by the config), `SHORTLET_BETA_INVITE_CODE` (operator-supplied for staging),
  `PAYSTACK_ENVIRONMENT=test` (set by the config), `CONCIERGE_MODE`, `COMMERCE_ENABLED` (read from the operator's shell at build time; off unless exactly `true`, ADR 0104 decision 5), and optional `CF_ACCESS_TEAM_DOMAIN`,
  `CF_ACCESS_AUD`, `SHORTLET_EXPORT_RETENTION_DAYS`, `SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS`,
  `SHORTLET_NOTIFICATION_FROM`, `SHORTLET_OPERATOR_ALERT_EMAILS`, `SHORTLET_NOTIFICATION_SWEEP_SECONDS`.
- Secrets declared with `bindings.secret()`: always `PAYSTACK_SECRET_KEY` (a **test** key), `LLM_API_KEY`, `SHORTLET_GUEST_CODE_HASHING_KEY` and `OPS_SHARED_SECRET`. Declared only when used: `GEMINI_API_KEY` only when `CONCIERGE_MODE=gemini`; `RESEND_API_KEY` only when it is set and non-empty at build time, and then together with `SHORTLET_NOTIFICATION_FROM` and `SHORTLET_OPERATOR_ALERT_EMAILS` (the Worker refuses to start with a partial set, and a fake value is unsafe). The demo staging build (`CONCIERGE_MODE=openai-compatible`, no Resend variables) declares neither. Also, only when commerce is on, `COMMERCE_REFERENCE_HMAC_KEY` (commerce payment reference key, ADR 0075; the id is the plain var `COMMERCE_REFERENCE_HMAC_KEY_ID`). Commerce is off by default, so the default staging build declares no commerce secret.

## 1. Build and deploy staging (issue step 1)

1. Confirm a clean integration checkout at the commit you are rehearsing, and record its SHA in the evidence log.
2. Build and dry-run (no upload, no account login):

   ```bash
   npm ci
   npm run worker:build:staging
   npm run worker:deploy:dry-run:staging
   ```

3. Commerce switch (off/on step; ADR 0104 decision 5). Leave `COMMERCE_ENABLED` unset or `false` for this rehearsal. The
   build then declares no commerce key secret, and the secret list below has no commerce entry. Only the owner can turn
   commerce on for a public deployment (ADR 0104 decision 3). If the owner has done so, set `COMMERCE_ENABLED=true` in the
   operator's shell, run `npm run worker:build:staging` again (the switch is read at build time, so the earlier build no
   longer matches), and provision `COMMERCE_REFERENCE_HMAC_KEY` and `COMMERCE_REFERENCE_HMAC_KEY_ID` before the deploy, as
   the build now declares them.
4. Provision the secrets (see the procedure below), then deploy the prebuilt artifact from `apps/cloudflare`:

   ```bash
   (cd apps/cloudflare && npm exec cf -- deploy --prebuilt --mode staging)
   ```

5. Do not expect `GET <staging origin>/healthz` to return `{"ok":true}` yet. Until the tenant is provisioned, health and
   the guest and owner routes answer 503 by design (issue 10a). Check `/healthz` at the end of step 2.

**Secret provisioning procedure (per issue 01c).** The pinned beta exposes `workers secrets update` and
`workers secrets bulk`, and `deploy --secrets-file`. Confirm the form supported by the pinned beta before using it:

```bash
npm exec cf -- workers secrets update --help
npm exec cf -- workers secrets bulk --help
npm exec cf -- deploy --help
```

- Set each secret by **name** only: `PAYSTACK_SECRET_KEY`, `LLM_API_KEY`, `SHORTLET_GUEST_CODE_HASHING_KEY`, `OPS_SHARED_SECRET`; `GEMINI_API_KEY` only when `CONCIERGE_MODE=gemini`; `RESEND_API_KEY` only when it was set at build time (with its two notification variables); and, only when commerce is on (step 3), `COMMERCE_REFERENCE_HMAC_KEY`. Set only the names the build declared (`worker.config.json`).
- Prefer the form that takes values interactively or from standard input, so no value enters shell history.
- If a secrets file is used, create it outside the repository, use only the names above (the commerce key only when commerce is on), and delete it
  immediately after the deploy. Never commit it, never paste it into chat and never write a value into a log.
- Use Paystack **test** keys only. A key marked live or production must not reach staging.
- Record in the evidence log only the names set and the date. Do not record values, prefixes or hashes.

## 2. Provision through the ops CLI (issue step 2)

Set the remote-mode variables in the operator's shell for the duration of this step (names and sources only):
`SHORTLET_OPS_URL` (the staging origin, https), `SHORTLET_OPS_SECRET` (the `OPS_SHARED_SECRET` value, supplied from
the operator's password manager), and `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` (the Access service token).
See `docs/pilot-deployment.md` ("Remote operations"). Do not paste these values into this repository or into chat.

1. Import the inventory (dry run first, then the real import). The importer keeps valid rows per row (issue 11b), so
   always dry-run first:

   ```bash
   npm run pilot:inventory:import -- --dry-run --tenant-id tenant-staging <path-to-synthetic-csv>
   npm run pilot:inventory:import -- --tenant-id tenant-staging <path-to-synthetic-csv>
   ```

   The staging tenant id is `tenant-staging` (`cloudflare.config.ts`). Use `docs/pilot-inventory-template.csv` or
   another **synthetic** CSV. After the real import, check `GET <staging origin>/healthz` returns `{"ok":true}`.
2. Bootstrap operators and create one operator:

   ```bash
   npm run pilot:operator:bootstrap
   npm run pilot:operator:create -- --operator-id <synthetic-operator-id> --tenant-id tenant-staging --name "<synthetic name>"
   ```

3. Provision an operator token with `npm run operator:provision` (remote mode, arguments as in `docs/pilot-deployment.md`).
   The token is printed once to stdout.
   Copy it straight into the operator's password manager, never into this repository, the evidence log or chat. Record
   only the operator id and the time.

## 3. Journeys against the staging origin (issue step 3)

1. **Agent smoke: not run against staging.** `npm run pilot:local:agent-smoke` is in-process only and refuses a base URL
   (gap 3). Record "not applicable to staging" in the evidence log, with the reason. The remote journeys are steps 2 and 3.
2. **Rodney acceptance against staging:**

   ```powershell
   $env:SHORTLET_BASE_URL = '<staging origin, https>'
   npm run pilot:acceptance:rodney
   ```

   The harness validates the origin with the same rule as the CLI (https, or localhost http only), checks `/healthz`,
   and never starts, stops or resets the staging deployment. `-Reset` is refused with a base URL. Inspect the report
   in `.scratch/pilot-acceptance-rodney/acceptance-report.md`; a payment-step failure is handled as in gap 4.
3. **Real-Chrome guest journeys.** Walk the guest flow in a real Chrome profile against the staging origin with
   synthetic data: discovery → request → offer → payment → confirmed. Use a clean profile for each guest. Record
   the screenshots (320, 390, 768 and 1280 px) only in the operator's evidence folder, never in the repository.

## 4. Forced restarts at each stage (issue step 4; AC2)

For each stage (discovery, request, offer, payment, confirmed), in order:

1. Stop at the stage and note the visible state (page, stage name, reference numbers, amounts).
2. Force a restart by redeploying the same prebuilt artifact:

   ```bash
   (cd apps/cloudflare && npm exec cf -- deploy --prebuilt --mode staging)
   ```

   Do not rebuild between stages, so the restart is the only change.
3. Reload the journey. Confirm it resumes at the same stage, with the same request, offer, payment reference and
   amounts, and that no state is lost or duplicated (one Reservation and one Booking Contract at the end).
4. Repeat the same procedure for an **operator session**: sign in at `/operator/login`, note the view, redeploy, reload
   `/operator`. The session should survive, per ADR 0086 and the 10b restart test.

Record the stage, the result and the reference for each restart in the evidence log.

## 5. Payments (issue step 5; AC3)

**Card payment, Paystack test mode.** Use a card number published by Paystack for test mode. Complete a card payment
through the Paystack hosted page, which returns to `/payments/paystack/callback`. Record the Paystack test reference
(not the card data, not the authorisation code).

Before the webhook checks, confirm the Paystack webhook IP allow-list from `docs/runbooks/cloudflare-edge.md` (section 1)
is set for staging and admits Paystack's currently published IPs. A test-mode webhook blocked by the allow-list is a
`BLOCKED` result for step 5c, not a PASS.

**Webhook, bad signature first (must fail).** Send a signed-looking POST to `/webhooks/paystack` with a deliberately
wrong `x-paystack-signature` header and a synthetic body. Expect `401`. Record the status code only. Do not record the
body or the header value.

**Webhook, good signature once.** From the Paystack test dashboard, resend the webhook event for the test transaction
from step above. The dashboard steps are performed by the operator. Expect the payment to confirm exactly once:
one Reservation, one Booking Contract, and one entry for the PSP reference. A second delivery must not duplicate
state; if the operator resends it, record the result of that resend too.

**Manual transfer receipt.** Through the guest bank-transfer flow, upload one synthetic receipt file (an image or a
PDF you created for the test). Read it in the back office and verify it. Record the receipt identifier and the
verification result. Receipt bytes live in the private R2 bucket; never copy them out.

## 6. Backups and point-in-time recovery drill (issue step 6; AC4)

**Exports check.** The daily alarm writes one JSONL object per table per Africa/Lagos day to the private `EXPORTS`
bucket, keyed `YYYY-MM-DD/<table>.jsonl`. Confirm that today's set of 61 objects exists, one per table in `EXPORT_TABLES` (61 is the current count: 45 SHORTLET, 8 PLATFORM, 8 COMMERCE; the earlier 45 was stale) (`apps/cloudflare/src/do-export.ts`; the five bearer-credential tables are not exported). List keys in the R2
dashboard; the pinned CLI is used for reading objects). Record the object keys and their count in the evidence log.
If today's objects are absent, record `BLOCKED` with the time checked. Do not force the alarm.

**PITR drill (staging only, gap 6).** Follow `docs/runbooks/cloudflare-restore.md` exactly:

1. Dry run to obtain the bookmark (no `confirm`), using the `/_ops/restore` route with the operator's ops credentials. Commerce is off in this rehearsal, so a restore that carries commerce rows is refused by the commerce object (`COMMERCE_DISABLED`; `commerce-migration-failure.md`, section 0). If the dry run shows commerce rows, stop here and record it. Do not change the switch to get past the refusal without the owner's decision.
2. Choose a restore point (for example, just before the test payment in step 5). Record the bookmark.
3. Confirm the restore with the bookmark, then force a restart by redeploying the prebuilt artifact, because the
   restore applies on the next session.
4. Walk the post-restore checks in section 3 of the restore runbook: `/healthz`, row counts, Paystack
   reconciliation for payments after the restore point, and the note that R2 `RECEIPTS` is not rolled back.

Record the restore point, the bookmark and each check's result. AC4 requires the restore to reach the chosen point
and the checks to pass.

**Break-glass drill (staging only, step 6c).** The restore runbook's break-glass (section 2, B0 to B7) is for a production
disaster. Its positive path cannot be drilled on the staging object: that object is not clean, so B3 would stop. Run only the stop path:

1. Confirm the staging object is cut over (`GET /_ops/status`: `cutoverCompletedAt` set). Use the staging cutover from step 7.1 of the cutover runbook.
2. B0: list `_ops/cutover/` in the staging EXPORTS bucket (`shortlet-pilot-staging-exports`, `--mode staging`). Expect one key. Record its `completedAt`.
3. B1: freeze the staging route. B2: run `cf r2 objects delete` on the key, with `--dry-run` first.
4. B3: list again, then `GET /_ops/status`. Expect `cutoverCompletedAt` set. The marker may read `absent` (the staging object was
   already running) or `present`. The status read does not re-create the marker, so the key may still be absent.
   That is the expected result, and it means the rebuild must stop. Do not import. Record the result and lift the freeze.
   Then send one import to the staging object, expect `CUTOVER_COMPLETE` (409), and check that the key is back.
5. Record the drill in the cutover log, marked as a drill, with the staging bucket name.

A pass is B3 stopping as described, followed by the refused import and the re-created key. A B3 that reads `cutoverCompletedAt`
null would mean the flag was not in storage, which this drill does not expect; record it as a finding, not a pass.

## 7. Logs (issue step 7; AC: no secrets in logs)

Logs are read in the dashboard (Workers & Pages, the Worker, then Observability or Logs), not with a live tail
(gap 5). Invocation logs are off in the config, so expect little output. Search the staging Worker's logs for each of
the following. The expected result for every query is **zero matches**:

- `cookie` and `set-cookie`
- `authorization`, `token` and `bearer`
- `x-shortlet-ops-secret`, `cf-access-client`
- `x-paystack-signature` and `signature`
- the body of a webhook or a form (search for a synthetic body marker you chose, for example `REHEARSAL-MARKER`)

Record each query, the time range searched and the match count. A match is a failure: stop, record the entry's
timestamp and category (without copying its contents), and raise it before continuing.

## 8. Record results and merge (issue step 8; AC1, AC5)

1. Complete the evidence log (below) for every step, with a date, a result (`PASS`, `FAIL` or `BLOCKED`) and its
   references. Every restart, payment reference, export key and the PITR bookmark must be listed (AC1).
2. Only when every required step is `PASS`, and the gates in section 0 have been reviewed by the user, the user
   decides go or no-go. An agent does not make that decision.
3. Before merging, confirm on the integration branch: `npm run check`, `npm test` and `npm run test:workers` are green
   at the commit being merged (AC5).
4. Open the pull request from `infra/cloudflare-deployment` to `main`. The user merges it:

   ```bash
   gh pr create --base main --head infra/cloudflare-deployment --title "Cloudflare pilot: staging rehearsal passed" --body-file <path-to-evidence-summary>
   ```

   End the pull request description with the attribution line required by the repository's Claude Code settings.

## Evidence log (template; fill in during the rehearsal)

Do not record secret values, cookies, tokens, card numbers, authorisation codes, receipt bytes or webhook bodies.
Record references only.

| Step | Date (Lagos) | Result (PASS / FAIL / BLOCKED) | Operator | Commit SHA | References (payment refs, export object keys, PITR bookmark, restart stage) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 0. Gates and gaps reviewed | | | | | Counsel / contracts / retention / DPIA status: | |
| 1. Build and deploy (names of secrets set: ; `COMMERCE_ENABLED` value as built: ) | | | | | Build log reference: | |
| 2. Ops provisioning (inventory import, operators bootstrapped, operator id) | | | | | Import summary reference: | |
| 3. Journeys (smoke N/A; Rodney report; real-Chrome run) | | | | | Report paths (local): | |
| 4a. Restart at discovery | | | | | Stage / request id: | |
| 4b. Restart at request | | | | | Stage / request id: | |
| 4c. Restart at offer | | | | | Stage / offer id: | |
| 4d. Restart at payment | | | | | Stage / PSP reference: | |
| 4e. Restart at confirmed | | | | | Reservation / Contract ids: | |
| 4f. Operator session restart | | | | | Operator id: | |
| 5a. Paystack test card payment and callback | | | | | Paystack test reference: | |
| 5b. Webhook with bad signature (expect 401) | | | | | Status code only: | |
| 5c. Webhook with good signature (exactly once) | | | | | Paystack reference; duplicate check: | |
| 5d. Manual transfer receipt uploaded and verified | | | | | Receipt id: | |
| 6a. Exports for today present | | | | | Object keys (count 18): | |
| 6b. PITR drill: dry run, confirm, restart, checks | | | | | Restore point; bookmark: | |
| 6c. Break-glass drill, stop path (B0 to B3 only) | | | | | Marker `completedAt`; B3 result: | |
| 7. Log searches (zero matches expected) | | | | | Queries and time range: | |
| 8. Go / no-go (user decision) | | | | | PR URL: | |
