# Work map: what the human does, and what is ready for agents

**Purpose.** One place to see all open work across every effort under `.scratch/`, so the project owner can see at a glance what **you** must do and what is **ready for AGENTS**, without reading hundreds of issue files.

**Generated 11 Oct 2026** from `origin/main` 37b9c62 **plus PR #108** (`origin/fix-stale-issue-statuses`, not merged yet). **This map assumes PR #108 is merged.** Statuses below are the PR #108 statuses. Exactly two rows on this page depend on PR #108, and each is marked `[PR #108]` in its table: **monthly-stays 10** (PR #108 changes its status from `ready-for-agent` to `needs-info`) and **pilot-launch-readiness 25** (blocked by pilot 21, which PR #108 resolves). Without PR #108, the status counts in section 1 are also wrong: 22 issue files change status in that PR (18 guest-chat-first-ux, shortlet 01 and 35, pilot 21, monthly-stays 10).

**Source of truth is the issue files.** This page is a summary. When the two disagree, the issue file wins and this page must be fixed in the same PR as the change.

> **Warning: statuses can be stale.** Only some groups were reconciled against the code (see the table below). Groups marked "not reconciled" were **not** checked against the code.

| Effort | Reconciled against the code on 11 Oct 2026? |
|---|---|
| guest-chat-first-ux | Yes. All 18 ready-for-agent issues were already built (PRs #50–#67). Statuses fixed by PR #108. |
| guest-accounts | Yes. |
| monthly-stays | Yes (the ready-for-agent issues). |
| weaver-catalogues | Yes. |
| guest-stays-and-favourites | Yes. |
| shortlet-concierge-launch | Yes (the new issues and 01, 03, 35, 51, 53). |
| pilot-launch-readiness | Yes (the ready-for-agent issues). |
| operator-dashboard | Yes (07 only). |
| **Not reconciled:** ready-for-human, needs-info, needs-triage, split and claimed issues in **all** efforts, except the four items moved to human in section 2b (pilot 01, 20, 25; shortlet 53). | No |

**Status legend** (canonical, from `docs/agents/triage-labels.md`):

| Status | Meaning |
|---|---|
| `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | Fully specified and ready for an AFK agent |
| `ready-for-human` | Requires human implementation |
| `wontfix` | Will not be actioned |
| `claimed` (local work-state, from `issue-tracker.md`) | Someone has started it. Not canonical, but used here. |
| `split` (used in this repo) | An epic split into child issues. Read the children. |
| `resolved` | Done. Must meet the Definition of Done in `docs/agents/issue-tracker.md`. |

Non-canonical value found: cloudflare-deployment 13 reads `resolved (agent side; ...)`. It is counted as resolved.

<details>
<summary>How this page was generated (and how to regenerate it)</summary>

Run from the repository root after `git fetch origin main`. The snippet reads every `.scratch/*/issues/*.md` on the ref given, prints the count of files per status and effort, and lists each open issue with its open same-effort blockers. It does **not** check cross-effort blockers (`A-NN` means `guest-accounts` issue NN, and `guest-payments P4`); check those by hand.

```python
# usage: python3 -I regen.py origin/main   (from the repository root)
import re, subprocess, sys, collections
ref = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
git = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True, check=True).stdout
files = [p for p in git("ls-tree", "-r", "--name-only", ref, "--", ".scratch").splitlines()
         if re.fullmatch(r"\.scratch/[^/]+/issues/[^/]+\.md", p)]
rows = []
for p in files:
    lines = git("show", f"{ref}:{p}").splitlines()[:40]
    field = lambda k: next((re.sub(rf"^{k}:\s*", "", l).strip() for l in lines if re.match(rf"{k}:", l)), "")
    m = re.match(r"\.scratch/([^/]+)/issues/([^/]+)\.md", p)
    rows.append(dict(effort=m[1], id=m[2].split("-")[0], status=field("Status"), blocked=field("Blocked by"), title=next((l[2:] for l in lines if l.startswith("# ")), "")))
status = {(r["effort"], r["id"]): r["status"] for r in rows}
counts = collections.defaultdict(collections.Counter)
for r in rows: counts[r["effort"]][r["status"].split(" (")[0]] += 1
print(f"{len(rows)} issue files")
for e in sorted(counts): print(e, dict(counts[e]))
for r in rows:
    if r["status"].split(" (")[0] == "resolved" or not r["status"]: continue
    b = re.sub(r"\(.*?\)", "", r["blocked"]).strip()
    deps = [t.strip() for t in b.split(",") if re.match(r"^\d", t.strip())]
    open_deps = [d for d in deps if not status.get((r["effort"], re.match(r"\d+[a-z]?", d)[0]), "").startswith("resolved")]
    print(f"{r['status']:<18} {r['effort']}/{r['id']} open-blockers={open_deps or '-'} {r['title'][:70]}")
```

Run it on `origin/main` and on `origin/fix-stale-issue-statuses` (PR #108) and compare. The counts in this page must match the output for the ref you used.

</details>

## 1. At a glance

> **New effort, not yet in the counts below:** [`multi-domain-platform`](multi-domain-platform/map.md), added 14 Oct 2026. It adds the commerce domain beside shortlets, one concierge across domains, and a later ChatGPT app for commerce, preceded by a deep-module refactor. 33 issue files: 29 ready-for-agent, 3 ready-for-human, 1 needs-info. Its ADR slices (01, 03, 04, 05) need the owner, and its ADR numbers come after 0097/0098 (decision 3). Fold it into the counts at the next regeneration.

Counts per status per effort, from PR #108. Each row of the lists below is one issue file.

| Effort | ready-for-agent | ready-for-human | needs-info | needs-triage | claimed | split | resolved | Files |
|---|---|---|---|---|---|---|---|---|
| cloudflare-deployment | 0 | 3 | 0 | 0 | 0 | 0 | 36 | 39 |
| guest-accounts | 4 | 4 | 1 | 0 | 0 | 0 | 6 | 15 |
| guest-chat-first-ux | 0 | 0 | 0 | 0 | 0 | 4 | 18 | 22 |
| guest-gallery | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| guest-payments | 0 | 1 | 0 | 0 | 0 | 0 | 4 | 5 |
| guest-stays-and-favourites | 12 | 0 | 0 | 0 | 1 | 0 | 1 | 14 |
| guest-ui-consistency | 0 | 0 | 0 | 0 | 0 | 0 | 12 | 12 |
| monthly-stays | 8 | 5 | 2 | 0 | 0 | 0 | 1 | 16 |
| operator-dashboard | 1 | 0 | 0 | 0 | 0 | 0 | 13 | 14 |
| pilot-launch-readiness | 7 | 10 | 0 | 0 | 0 | 0 | 9 | 26 |
| shortlet-concierge-launch | 3 | 6 | 0 | 2 | 1 | 0 | 43 | 55 |
| test-runner-speed | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 |
| weaver-catalogues | 7 | 0 | 0 | 0 | 1 | 0 | 0 | 8 |
| **Total** | **42** | **29** | **3** | **2** | **4** | **4** | **144** | **228** |

**What to do next (summary):**

1. **Merge PR #108** (status clean-up). Nothing else on this page is correct until it is merged.
2. **Decide the blockers on the human side** (section 2a): guest-accounts 06–08 (waive or keep the screenshot debt), the ADR numbers (0097/0098), the copy approval, and the deployment settings. These unblock most of the account and stay work.
3. **Let agents take the 10 ready-now items** in section 3a, starting with shortlet 51 and pilot 26.
4. **Run the monthly 60-day pilot** (monthly-stays 01) and **engage counsel** (pilot 03, monthly-stays 02). Counsel answers gate the monthly-stays receipts, cancellation and notice values, and the launch legal pack.
5. **Clear the claims**: the `wip/main-snapshot-2026-10-10` branch and the four claimed issues (section 4).

---

## 2. WORK FOR YOU (human)

### 2a. Decisions and chores only the human can do

Each item lists the file to read, what to decide, and what it unblocks. Numbers are used in the notes elsewhere on this page.

1. **Merge PR #108 (status clean-up).** Read the PR. It changes 23 issue files: 18 guest-chat-first-ux issues to `resolved`, shortlet-concierge-launch 01, 35 to `resolved`, pilot-launch-readiness 21 to `resolved`, monthly-stays 10 to `needs-info`. Shortlet 51 is changed in the diff but keeps `ready-for-agent`. **Unblocks:** correct counts on this page and on every issue file. Nothing else here depends on it being merged first, but this page assumes it.

2. **guest-accounts 06, 07, 08: resolve with the screenshot debt waived, or keep them open until issue 11 captures them.** Built and merged (PRs #102, #103, #104). Open only for the 320/390/768/1280 captures, which need Chrome and the agent sandbox has none. Files: [guest-accounts/06](guest-accounts/issues/06-guest-server-sign-in-and-sessions.md), [07](guest-accounts/issues/07-account-page.md), [08](guest-accounts/issues/08-offer-sign-in-after-request.md), [11](guest-accounts/issues/11-captures-for-account-screens.md). **Unblocks:** guest-accounts 07, 08, 13 and 15 (all via 06); guest-accounts 11 (via 07 and 08); guest-stays 04 (via A-06).

3. **ADR numbers and the weaver namespace.** Stays 02 (messaging ADR) and weaver 03 (catalogue ADR) both want **0097**. Reconciliation says 0094 and 0096 are taken, so the second needs **0098**. Choose who takes 0097 and 0098, and confirm the weaver catalogue namespace. Files: [guest-stays-and-favourites/02](guest-stays-and-favourites/issues/02-adr-relayed-stay-messages.md), [weaver-catalogues/03](weaver-catalogues/issues/03-catalogues-and-runtime.md). **Unblocks:** stays 08 (via 02), weaver 04, 05, 06 (via 03).

4. **Approve the guest-account copy.** The `GUEST_ACCOUNT_COPY` strings in `apps/web-agent/src/guest-content.ts`: sign-in, code, account page, refusal page, and the sign-in offer (`offerTitle`, `offerIntro`, `offerButton`). File: [guest-accounts/15](guest-accounts/issues/15-deployment-requirements-for-guest-accounts.md). **Unblocks:** guest-accounts 08 (copy), 14, 15.

5. **Deployment settings for guest accounts.** File: [guest-accounts/15](guest-accounts/issues/15-deployment-requirements-for-guest-accounts.md). Set: `SHORTLET_GUEST_CODE_HASHING_KEY` (at least 32 characters); `RESEND_API_KEY` and `SHORTLET_NOTIFICATION_FROM`; `SHORTLET_TRUST_CF_CONNECTING_IP=true` and `SHORTLET_PUBLIC_ORIGIN` behind Cloudflare; run `npm run build` before serving the committed `apps/local-guest/dist/client.js` on Node; configure the Cloudflare Worker (sign-in is disabled there until configured). **Unblocks:** guest-accounts 15, and sign-in in any deployment.

6. **Legal review of retention (issue 01 answer 6).** File: [guest-accounts/01](guest-accounts/issues/01-settle-account-policy-values.md). **Unblocks:** guest-accounts 10 (needs-info), and stay-message retention in guest-stays.

7. **Privacy review of the `guest_identity_assurance` table and the Smile reference format.** File: [guest-accounts/09](guest-accounts/issues/09-identity-assurance-port.md), `## Comments`. No open issue is recorded as blocked by this in the files.

8. **Delegated decisions awaiting your confirmation** (recorded in the guest-accounts issues and map; search for each term): single-writer contact (the account owns the email); signed-out `/account` redirects instead of a 401; phone display fallback; change-email sends a code to the holder of an already-used address (quota 5 per address per hour); whether code sends write an audit row. File: [guest-accounts/map.md](guest-accounts/map.md), and the Answer sections of issues 04, 06 and 07.

9. **Decisions in filed follow-ups.** Listed in section 2b: shortlet 52 (payment references in audit), 54 (card-number width), 55 (already-redacted audit rows); guest-accounts 12, 13, 14, 15.

10. **Cleanup of remote branches.** (a) Delete `origin/ga-08-main-baseline-probe` yourself. The agent environment cannot delete branches (see [guest-accounts/08](guest-accounts/issues/08-offer-sign-in-after-request.md)). (b) Review `origin/wip/main-snapshot-2026-10-10`: the PC snapshot, "not for merging as-is" ([cloudflare-deployment/CLOUD-HANDOFF.md](cloudflare-deployment/CLOUD-HANDOFF.md)). Decide who owns weaver 01 and stays 11, whose related work is on it. (c) `origin/ga-08-sign-in-offer` also exists and is not mentioned in the brief. Check it before deleting.

11. **Remote branches.** 66 remote-tracking refs are in the local clone (the brief said 65; not re-verified against the server). Several are infra, UX and work-in-progress branches. Decide which are obsolete. Nothing on this page claims anything about a branch without reading it.


### 2b. Issues that need you (ready-for-human, needs-info, needs-triage)

38 rows: 29 ready-for-human, 3 needs-info, 2 needs-triage (from PR #108), and 4 issues that the reconciliation moved to human even though their file says `ready-for-agent`. Blocks lists the open issues waiting on this one.

#### guest-accounts

| Issue | Title | Type | Status | What you must do or decide | Blocks |
|---|---|---|---|---|---|
| [guest-accounts/10](guest-accounts/issues/10-delete-account-and-export.md) | Delete account and download my data | task | needs-info | Get the legal review of retention (issue 01 answer 6) and supply the stay records that are not on `main`; the keep-or-anonymise rules cannot be built before that. | 11, 12 |
| [guest-accounts/12](guest-accounts/issues/12-hide-contact-email-form-for-linked-devices.md) | Hide or replace the /guest/contact email form for linked devices, and decide the closed-account fallback | task | ready-for-human | Decide whether to hide or replace the `/guest/contact` email form for linked devices, and choose the closed-account fallback. | none open |
| [guest-accounts/13](guest-accounts/issues/13-conventional-offer-and-booking-pages-for-linked-devices.md) | Conventional offer and booking pages for linked devices and the offer's own Guest | task | ready-for-human | Read the issue: an authorized owner gets `404 BOOKING_RECORD_NOT_FOUND` on the conventional offer and booking pages. Confirm the fix approach (filed as human work). | none open |
| [guest-accounts/14](guest-accounts/issues/14-concierge-mention-of-account-and-my-account-link.md) | Decide whether the concierge mentions sign-in and links to 'my account' | task | ready-for-human | Decide whether the concierge mentions sign-in and links to 'my account'. Its wording and behaviour are in no acceptance criterion. Copy approval needed (decision 4). | none open |
| [guest-accounts/15](guest-accounts/issues/15-deployment-requirements-for-guest-accounts.md) | Deployment requirements and copy approval for guest accounts | HITL | ready-for-human | Supply the deployment configuration (decision 5) and approve the guest-account copy (decision 4). Nothing deploys from `main` until then. | none open |

#### cloudflare-deployment

| Issue | Title | Type | Status | What you must do or decide | Blocks |
|---|---|---|---|---|---|
| [cloudflare-deployment/15](cloudflare-deployment/issues/15-staging-rehearsal.md) | Staging rehearsal; merge to `main` | task | ready-for-human | Deploy the integration branch to Cloudflare staging, run the rehearsal, do the Paystack dashboard steps, and make the go/no-go call before merging to `main`. | 16 |
| [cloudflare-deployment/16](cloudflare-deployment/issues/16-data-migration-and-cutover.md) | Data migration and cutover | task | ready-for-human | Decide the rollback window, then run the Node-to-Durable-Object data migration and traffic cutover, if the Node pilot holds live data. | 17 |
| [cloudflare-deployment/17](cloudflare-deployment/issues/17-retire-node-production-entry.md) | Retire the Node production entry | task | ready-for-human | After cutover, approve retiring the Node production entry (Node stays for local development and tests). | none open |

#### guest-payments

| Issue | Title | Type | Status | What you must do or decide | Blocks |
|---|---|---|---|---|---|
| [guest-payments/02](guest-payments/issues/02-paystack-transfer-adapter.md) | Paystack transfer adapter and webhook | task | ready-for-human | Reason for human status is not stated in the file. The adapter needs Paystack API access, which shortlet 47 says the owner does not yet have. Read the issue. | none open |

#### monthly-stays

| Issue | Title | Type | Status | What you must do or decide | Blocks |
|---|---|---|---|---|---|
| [monthly-stays/01](monthly-stays/issues/01-manual-monthly-pilot.md) | Run the 60-day manual monthly pilot | task | ready-for-human | Run the 60-day manual pilot: sign 10–15 units (about half Abuja, half Lagos), inspect them, and record the evidence. | 13 |
| [monthly-stays/02](monthly-stays/issues/02-legal-review-licence-and-receipts.md) | Nigerian legal and tax review: licence to occupy vs tenancy, and stay receipts | research | ready-for-human | Get Nigerian legal and tax review: licence to occupy vs tenancy, and stay receipts. ADR 0023 says extended stays need this before launch. | 10 |
| [monthly-stays/10](monthly-stays/issues/10-stay-receipt-per-period.md) | Stay receipt for each Billing Period | task | needs-info [PR #108] | Get counsel's answers (issue 02) and the issue 06 values. Counsel-dependent receipt fields stay off until then. | none open |
| [monthly-stays/13](monthly-stays/issues/13-house-hunt-while-you-stay.md) | Define the "house-hunt while you stay" service (segment 2) | grilling | ready-for-human | Decide the 'house-hunt while you stay' service for segment 2 (a paid, verified viewing service). | none open |
| [monthly-stays/14](monthly-stays/issues/14-seasonal-holiday-offer.md) | Seasonal "Home for the Holidays" offer with optional extras | task | needs-info | Confirm the seasonal 'Home for the Holidays' offer and its optional extras (decided 3 Oct 2026). Needs issues 05 and 11 first. | none open |
| [monthly-stays/15](monthly-stays/issues/15-operator-tier-menu.md) | Decide the operator tier menu for Extended Stay supply | grilling | ready-for-human | Decide the operator tier menu for Extended Stay supply. Runs alongside issue 01. | none open |
| [monthly-stays/16](monthly-stays/issues/16-earnings-projection-model.md) | Build the operator earnings projection and guest value comparison | prototype | ready-for-human | Build the operator earnings projection and guest value comparison as a spreadsheet first, using each operator's own numbers. Any code waits for 05. | none open |

#### pilot-launch-readiness

| Issue | Title | Type | Status | What you must do or decide | Blocks |
|---|---|---|---|---|---|
| [pilot-launch-readiness/01](pilot-launch-readiness/issues/01-merge-business-model-adrs.md) | Merge ADRs 0088–0090 and mark superseded ADRs | task | ready-for-human (reconciled 11 Oct; file says ready-for-agent) | Approve merging ADRs 0088–0090 and the superseded-status headers to `main`. `CONTEXT.md` still has legacy commission terms. Reconciliation moved it to human. | 03, 07, 13, 14 |
| [pilot-launch-readiness/03](pilot-launch-readiness/issues/03-legal-launch-pack.md) | Engage Nigerian counsel for the launch legal pack | task | ready-for-human | Hire a Lagos firm (fixed fee if possible) to confirm the B2B2C model in ADR 0089 and draft the launch legal pack. | 04, 05, 15 |
| [pilot-launch-readiness/04](pilot-launch-readiness/issues/04-paystack-go-live.md) | Paystack live account, certification and transfer access | task | ready-for-human | Get the live Paystack business account approved, with a merchant agreement covering collection for owners, and certify card checkout live. | 15 |
| [pilot-launch-readiness/05](pilot-launch-readiness/issues/05-sign-and-inspect-first-units.md) | Sign and inspect the first 10–20 units | task | ready-for-human | Sign real owners, clustered in two or three neighbourhoods per city, and pass a physical inspection of each unit. | 06, 15 |
| [pilot-launch-readiness/06](pilot-launch-readiness/issues/06-unit-operations-pack.md) | Unit operations pack | task | ready-for-human | Set up each unit's operations pack: named on-site contact with two tested phone routes, check-in checklist, neighbourhood cover. | 15 |
| [pilot-launch-readiness/07](pilot-launch-readiness/issues/07-guest-protection-promise.md) | Fund and state the guest protection promise | grilling | ready-for-human | Decide the guest protection fund seed, per-incident caps and who approves payouts. Counsel approves the one-line promise. | 15 |
| [pilot-launch-readiness/08](pilot-launch-readiness/issues/08-identity-at-check-in-procedure.md) | Write the identity-at-check-in procedure | grilling | ready-for-human | Write the identity-at-check-in procedure (who checks, when, accepted documents, outcome on failure). Access is not granted until it exists. | 15 |
| [pilot-launch-readiness/09](pilot-launch-readiness/issues/09-support-rota-and-playbook.md) | Support rota and incident playbook | task | ready-for-human | Name two people for the ADR 0030 and 0067 windows and write the playbooks (failed access, power or water, and the rest of the list). | 15 |
| [pilot-launch-readiness/12](pilot-launch-readiness/issues/12-target-guests-and-launch-plan.md) | Choose target guests and the December launch plan | grilling | ready-for-human | Choose the target guest segments and the December launch plan, with acquisition channels and a small test budget. | none open |
| [pilot-launch-readiness/14](pilot-launch-readiness/issues/14-record-paused-scope.md) | Record paused scope | grilling | ready-for-human | Confirm or edit the panel's paused-scope list, then mark matching issues `wontfix` for the pilot or add a note. | none open |
| [pilot-launch-readiness/15](pilot-launch-readiness/issues/15-staffed-dry-run.md) | Staffed dry run with one real paid booking | task | ready-for-human | Run a staffed dry run with one real paid booking on production, after the prerequisites (03–10) are done. | none open |
| [pilot-launch-readiness/20](pilot-launch-readiness/issues/20-remove-back-office-stubs.md) | Remove production stubs in the back office | task | ready-for-human (reconciled 11 Oct; file says ready-for-agent) | Decide the two open points: one hard-coded stub conflicts with ADR 0085, and one needs a cold-start policy. Reconciliation moved it to human. | none open |
| [pilot-launch-readiness/25](pilot-launch-readiness/issues/25-backups-wal-and-schema-versioning.md) | Backups, WAL and schema versioning | task | ready-for-human (reconciled 11 Oct; file says ready-for-agent) [PR #108] | Scope decision: ADR 0095 hosts the pilot on Cloudflare, so WAL on Node may be out of scope. Reconciliation moved it to human. | none open |

#### shortlet-concierge-launch

| Issue | Title | Type | Status | What you must do or decide | Blocks |
|---|---|---|---|---|---|
| [shortlet-concierge-launch/06](shortlet-concierge-launch/issues/06-produce-an-all-in-stay-total.md) | Produce an All-In Stay Total and versioned Stay Quote | AFK | ready-for-human | Read the issue. No reason for human status is stated (type AFK). | none open |
| [shortlet-concierge-launch/14](shortlet-concierge-launch/issues/14-qualify-same-day-turnover.md) | Qualify a Unit for Same-Day Turnover | AFK | ready-for-human | Read the issue. No reason for human status is stated (type AFK). | none open |
| [shortlet-concierge-launch/47](shortlet-concierge-launch/issues/47-activate-paystack-pay-with-transfer.md) | Activate Paystack Pay with Transfer before production | HITL | ready-for-human | Keep Pay with Transfer off in production until the adapter is certified against Paystack test mode. Needs Paystack API access. | none open |
| [shortlet-concierge-launch/48](shortlet-concierge-launch/issues/48-align-production-same-day-cutoff-with-adr-0053.md) | Align the production same-day cutoff with ADR 0053 | AFK | needs-triage | Triage: decide whether production implements the ADR 0053 same-day cutoff. Issue 15 is resolved, but the production path does not match. | none open |
| [shortlet-concierge-launch/49](shortlet-concierge-launch/issues/49-review-hardcoded-conditional-offer-signing-key.md) | Review the hardcoded conditional-offer signing key | AFK | needs-triage | Triage: the conditional-offer signing key is a literal in the repository. Decide the reachability finding and key handling. | none open |
| [shortlet-concierge-launch/52](shortlet-concierge-launch/issues/52-decide-masking-of-payment-references-in-audit.md) | Decide how payment references are kept out of audit and telemetry | HITL | ready-for-human | Decide whether payment references are stored as a hash or omitted from audit and telemetry (ADR 0096 export is the only exemption). | none open |
| [shortlet-concierge-launch/53](shortlet-concierge-launch/issues/53-server-generate-guest-thread-ids.md) | Server-generate guest thread ids so the client cannot choose them | AFK | ready-for-human (reconciled 11 Oct; file says ready-for-agent) | Decide how the JS client obtains its guest thread id (spec gap, reconciled as needs-info) before the server-generation change. | none open |
| [shortlet-concierge-launch/54](shortlet-concierge-launch/issues/54-decide-card-number-redaction-width.md) | Decide the card-number redaction width (13-15 and 17-19 digits) | HITL | ready-for-human | Decide the card-number redaction width (13–15 and 17–19 digits). The current behaviour is pinned by tests. | none open |
| [shortlet-concierge-launch/55](shortlet-concierge-launch/issues/55-decide-treatment-of-audit-rows-masked-before-pr-105.md) | Decide what to do with audit and telemetry rows masked before PR #105 | HITL | ready-for-human | Decide what to do with audit and telemetry rows masked before PR #105. They cannot be restored from the audit tables alone. | none open |

---

## 3. WORK FOR AGENTS

Every row here is `ready-for-agent` on PR #108. Section 3a is unblocked after PR #108. Section 3b waits on open issues. Section 3c is built and waits on the human.

### 3a. Ready now (in recommended order)

Unblocked: every blocker is resolved (PR #108). Claimed issues are in section 4.

| # | Issue | Title | Notes |
|---|---|---|---|
| 1 | [shortlet-concierge-launch/51](shortlet-concierge-launch/issues/51-fix-flaky-receipt-object-key-assertion.md) | Fix the flaky receipt object-key assertion | Fix the flaky receipt object-key assertion (about 1 failure in 196 runs, per reconciliation). |
| 2 | [pilot-launch-readiness/26](pilot-launch-readiness/issues/26-tester-feedback-link.md) | Tester feedback link | Add the tester feedback link. |
| 3 | [pilot-launch-readiness/02](pilot-launch-readiness/issues/02-reopen-simulated-hitl-gates.md) | Reopen issues 42–44 as real human work | Docs: reopen issues 42–44 as real human work. |
| 4 | [pilot-launch-readiness/24](pilot-launch-readiness/issues/24-structured-logging.md) | Structured logging and assistant diagnostics | Structured logging. Reconciliation: `onDiagnostic` is never wired. Blocker 18 is resolved. |
| 5 | [shortlet-concierge-launch/03](shortlet-concierge-launch/issues/03-render-and-expire-the-first-generative-surface.md) | Render and safely expire the first Generative Surface | Reconciled PARTIAL: missing the unsupported-version rejection and its test. |
| 6 | [operator-dashboard/07](operator-dashboard/issues/07-owner-payables.md) | What you owe each owner | Reconciled PARTIAL: code and tests exist; walkthrough evidence at 320/375/1280 and no-JS is missing (captures need Chrome). Reconciliation also notes blocker 05 as unchecked. |
| 7 | [guest-stays-and-favourites/02](guest-stays-and-favourites/issues/02-adr-relayed-stay-messages.md) | ADR 0094: Relayed guest–operator stay messages | ADR 0094 is taken, so this needs 0097 or 0098: the human decides (decision 3). |
| 8 | [guest-stays-and-favourites/03](guest-stays-and-favourites/issues/03-completed-stay-and-stay-history-query.md) | Completed Stay projection and Stay History query | Reconciled ready now (blockers 01 and guest-accounts 05 are resolved). |
| 9 | [monthly-stays/04](monthly-stays/issues/04-extended-stay-eligibility.md) | Extended Stay eligibility: length, opt-in and validity through checkout | Reconciled ready now. Counsel-dependent values stay off until counsel answers (issue 02). |
| 10 | [monthly-stays/05](monthly-stays/issues/05-monthly-price-and-utilities.md) | Monthly price: Monthly Agreed Amounts, margin and what's included | Reconciled ready now. Counsel-dependent values stay off until counsel answers (issue 02). |

### 3b. Ready later (blocked, in dependency order)

`Wave` 1 waits only on items in 3a, 3c, claimed issues or section 2b. Wave N waits on wave N-1 in this table. Blocked-by lists the open blockers only.

| Wave | Issue | Title | Blocked by (open) | Notes |
|---|---|---|---|---|
| 1 | [guest-accounts/11](guest-accounts/issues/11-captures-for-account-screens.md) | Walkthrough stages and captures for account screens | guest-accounts 07, guest-accounts 08, guest-accounts 10 | Needs a machine with Chrome for the captures, and issue 10 (needs-info). |
| 1 | [guest-stays-and-favourites/04](guest-stays-and-favourites/issues/04-my-stays-page.md) | "My stays" page | guest-stays-and-favourites 03, guest-accounts 06 | Also waits on guest-accounts 06, which is built but open on status (decision 2). |
| 1 | [guest-stays-and-favourites/05](guest-stays-and-favourites/issues/05-persist-verified-stay-reviews.md) | Persist Verified-Stay Reviews | guest-stays-and-favourites 03 | Reconciled PARTIAL: domain rules are in memory only; persist the reviews. |
| 1 | [guest-stays-and-favourites/08](guest-stays-and-favourites/issues/08-stay-message-thread-domain.md) | Stay Message Thread domain and store | guest-stays-and-favourites 02, guest-stays-and-favourites 03 | Not built (reconciled). |
| 1 | [monthly-stays/06](monthly-stays/issues/06-billing-periods-and-period-payments.md) | Billing Periods and Period Payments | monthly-stays 04, monthly-stays 05 | Not built. Counsel-dependent values stay off until counsel answers (issue 02). |
| 1 | [monthly-stays/11](monthly-stays/issues/11-guest-discovery-for-monthly-stays.md) | Guest discovery for monthly stays: entry points, monthly price and what's included | monthly-stays 04, monthly-stays 05 | Not built. Needs user-confirmed copy. |
| 1 | [pilot-launch-readiness/13](pilot-launch-readiness/issues/13-pilot-metrics.md) | Define and capture pilot metrics | pilot-launch-readiness 01 | Only after the human approves pilot 01 (decision: ADR merge). |
| 1 | [weaver-catalogues/02](weaver-catalogues/issues/02-producer-envelopes.md) | Build A2UI envelopes with `createA2UIV091Producer` | weaver-catalogues 01 | Waits on weaver 01, which is claimed. Order 01, then 02 and 03. |
| 1 | [weaver-catalogues/03](weaver-catalogues/issues/03-catalogues-and-runtime.md) | ADR 0096, `shortlet-*` catalogue definitions and the runtime factory | weaver-catalogues 01 | Waits on weaver 01. ADR number: needs 0097 (decision 3). Catalogue namespace to confirm. Related unmerged work: `wip/main-snapshot-2026-10-10`. |
| 2 | [guest-stays-and-favourites/06](guest-stays-and-favourites/issues/06-guest-leaves-a-review.md) | Guest leaves a review from a past stay | guest-stays-and-favourites 04, guest-stays-and-favourites 05 | Reconciled PARTIAL. |
| 2 | [guest-stays-and-favourites/07](guest-stays-and-favourites/issues/07-operator-responds-to-review.md) | Operator responds to a review | guest-stays-and-favourites 05 | Reconciled PARTIAL. |
| 2 | [guest-stays-and-favourites/09](guest-stays-and-favourites/issues/09-guest-message-screen.md) | Guest message screen on a stay | guest-stays-and-favourites 04, guest-stays-and-favourites 08 | Not built (reconciled). |
| 2 | [guest-stays-and-favourites/10](guest-stays-and-favourites/issues/10-operator-replies-and-message-emails.md) | Operator replies from the inbox, and message emails | guest-stays-and-favourites 08 | Not built (reconciled). |
| 2 | [guest-stays-and-favourites/12](guest-stays-and-favourites/issues/12-favourites-page-and-save-control.md) | Save control and Favourites page with availability check | guest-stays-and-favourites 04, guest-stays-and-favourites 11 | Not built. Also waits on 11, which is claimed. |
| 2 | [monthly-stays/07](monthly-stays/issues/07-period-owner-payable.md) | Period Owner Payable | monthly-stays 06 | Not built. |
| 2 | [monthly-stays/08](monthly-stays/issues/08-cancellation-and-notice-to-end.md) | Cancellation and Notice to End for Extended Stays | monthly-stays 06 | Not built. Cancellation and notice values stay off until counsel answers. |
| 2 | [monthly-stays/09](monthly-stays/issues/09-extend-an-extended-stay.md) | Extend an Extended Stay | monthly-stays 06 | Not built. |
| 2 | [monthly-stays/12](monthly-stays/issues/12-servicing-and-maintenance-requests.md) | Servicing schedule and maintenance requests during an Extended Stay | monthly-stays 05, monthly-stays 06 | Not built. |
| 2 | [weaver-catalogues/04](weaver-catalogues/issues/04-booking-catalogue.md) | `shortlet-booking/v1`: StayTicket and PriceBreakdown | weaver-catalogues 02, weaver-catalogues 03 | Not built (reconciled). |
| 2 | [weaver-catalogues/05](weaver-catalogues/issues/05-unit-detail-catalogue.md) | Unit detail on `shortlet-discovery/v1` | weaver-catalogues 03 | Not built (reconciled). |
| 2 | [weaver-catalogues/06](weaver-catalogues/issues/06-discovery-cards-catalogue.md) | Discovery cards on `shortlet-discovery/v1` | weaver-catalogues 03 | Not built (reconciled). |
| 3 | [guest-stays-and-favourites/13](guest-stays-and-favourites/issues/13-concierge-tools-for-stays-and-favourites.md) | Concierge tools for stays and favourites | guest-stays-and-favourites 04, guest-stays-and-favourites 12 | Not built (reconciled). |
| 3 | [weaver-catalogues/07](weaver-catalogues/issues/07-comparison-catalogue.md) | Comparison on `shortlet-discovery/v1` | weaver-catalogues 06 | Not built (reconciled). |
| 4 | [guest-stays-and-favourites/14](guest-stays-and-favourites/issues/14-walkthrough-and-captures.md) | Walkthrough stages and captures | guest-stays-and-favourites 06, guest-stays-and-favourites 09, guest-stays-and-favourites 12, guest-stays-and-favourites 13 | Walkthrough and captures; needs Chrome. |
| 4 | [weaver-catalogues/08](weaver-catalogues/issues/08-cleanup-and-captures.md) | Clean-up, retirement guard and capture sweep | weaver-catalogues 04, weaver-catalogues 05, weaver-catalogues 06, weaver-catalogues 07 | Not built (reconciled). |

### 3c. Built, waiting on human input

Built and merged, reconciled 11 Oct 2026. Their status is still `ready-for-agent`, and they are not agent work until decision 2 is taken (and copy, decision 4).

| Issue | Title | Blocked by (open) | Notes |
|---|---|---|---|
| [guest-accounts/06](guest-accounts/issues/06-guest-server-sign-in-and-sessions.md) | Guest server: sign-in, sign-out and account session cookie | none | Built and merged (PR #102). Open only for the 320/390/768/1280 captures (no Chrome in the agent sandbox) and decision 2. |
| [guest-accounts/07](guest-accounts/issues/07-account-page.md) | Account page: contact details, sign out everywhere, identity status | guest-accounts 06 | Built and merged (PR #103). Open for the same captures and decision 2. |
| [guest-accounts/08](guest-accounts/issues/08-offer-sign-in-after-request.md) | Offer sign-in after a request and on confirmation | guest-accounts 06 | Built and merged (PR #104). Open for the same captures, decision 2, and copy approval (decision 4). |

---

## 4. Other states

### Claimed

| Issue | Title | Blocked by | Notes |
|---|---|---|---|
| [guest-stays-and-favourites/11](guest-stays-and-favourites/issues/11-saved-stay-domain.md) | Saved Stay domain and store | none | Claimed on main. Related unmerged work on `origin/wip/main-snapshot-2026-10-10` (`domains/shortlet/src/saved-stay.ts`, `test/saved-stay.test.ts`). Reconciliation: unblocked, ready once the claim is cleared. Human decides owner. |
| [shortlet-concierge-launch/46](shortlet-concierge-launch/issues/46-capture-pilot-guest-contact.md) | Capture pilot Guest contact | none | Claimed. The file has no `Type:` line. Not reconciled against the code. |
| [test-runner-speed/01](test-runner-speed/issues/01-selected-runs-and-records.md) | Selected runs, reliable records, and measured concurrency | none | Claimed. Not reconciled against the code. |
| [weaver-catalogues/01](weaver-catalogues/issues/01-weaver-0-2-1-from-npm.md) | Move to `@cylayo/weaver-*` 0.2.1 from npm | none | Claimed on main. `origin/wip/main-snapshot-2026-10-10` holds related unmerged work (the `@cylayo/weaver-*` 0.2.1 pins). Reconciliation: do this first. |

### Split (epics)

| Issue | Title | Notes |
|---|---|---|
| [guest-chat-first-ux/03](guest-chat-first-ux/issues/03-criteria-strip.md) | Editable criteria strip with live re-search | Epic split into children; the children are resolved on PR #108. |
| [guest-chat-first-ux/04](guest-chat-first-ux/issues/04-never-silent.md) | Answer every message after booking starts | Epic split into children; the children are resolved on PR #108. |
| [guest-chat-first-ux/06](guest-chat-first-ux/issues/06-conventional-routes.md) | Serve fallback routes; composer without JavaScript | Epic split into children; the children are resolved on PR #108. |
| [guest-chat-first-ux/13](guest-chat-first-ux/issues/13-thread-control.md) | New conversation, undo, and comparison | Epic split into children; the children are resolved on PR #108. |

### Partial (reconciled; the status is still ready-for-agent)

Their rows are in section 3. These are the ones the reconciliation marked **PARTIAL**: guest-stays 05, 06, 07 (domain rules in memory only; 3b), shortlet-concierge-launch 03 (3a), operator-dashboard 07 (3a).

---

## 5. Done

Counts only. Resolved issues are listed in each effort folder (`.scratch/<effort>/issues/`).

| Effort | Resolved |
|---|---|
| cloudflare-deployment | 36 |
| guest-accounts | 6 |
| guest-chat-first-ux | 18 |
| guest-gallery | 1 |
| guest-payments | 4 |
| guest-stays-and-favourites | 1 |
| guest-ui-consistency | 12 |
| monthly-stays | 1 |
| operator-dashboard | 13 |
| pilot-launch-readiness | 9 |
| shortlet-concierge-launch | 43 |
| test-runner-speed | 0 |
| weaver-catalogues | 0 |
| **Total** | **144** |

---

## 6. Maintenance rules

- **Update in the same PR** as any issue status change. If you change a status, change the row here too.
- **Regenerate** with the snippet in the `How this page was generated` block after each merged batch, and compare the counts in section 1 with its output.
- **Reconcile before trusting.** Statuses on the issue files are not checked against the code unless a reconciliation is recorded in the header. Before an agent starts a row marked "not reconciled", check the code.
- **Do not add a row here without its issue file.** Do not remove a row unless its issue is resolved or `wontfix`.
- **Cross-effort blockers** (`A-NN`, `guest-payments P4`) are not checked by the snippet. Check them by hand.
- Keep this file the only page of its kind. Update it; do not add another summary.

