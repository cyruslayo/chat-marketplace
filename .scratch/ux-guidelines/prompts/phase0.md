# Phase 0 agent prompts (issues 01 to 04)

Written 11 Nov 2026 for the guideline re-baseline. Each prompt is self-contained. Paste one per agent session.

**Order:**
- 01 and 02 can run together; 02 waits for 01's captures only for the rows it verifies from screenshots.
- 03 runs after 01's capture sweep finishes, because only one sweep or browser suite may run at a time.
- 04 runs in Lagos daytime (start 8:00 AM to about 6:30 PM WAT) with the owner on hand for the Paystack step. It uses the built-in browser against staging, not a test suite, so it can overlap 01 to 03.
- 05 starts when 01 to 04 are reviewed.

**Evidence files.** So that parallel agents never write one file, each issue writes its rows to `.scratch/ux-guidelines/evidence/NN-rows.md`, with the column header of `evidence-matrix.md`. Issue 05 merges them into `evidence-matrix.md`.

---

## Common preamble (put at the top of every prompt)

```text
You are working in the chat-marketplace repo (Windows, Git Bash). Read CLAUDE.md and AGENTS.md first; they are hard rules.

Setup:
- Work only in your own worktree: git worktree add C:\AI2026\chat-marketplace-p0-<NN> docs/ux-phase0 --detach
  (docs/ux-phase0 is main c6a7961 plus the 11 Nov decisions). Junction node_modules and apps/cloudflare/node_modules
  from C:\AI2026\chat-marketplace the way AGENTS.md describes. Never touch another worktree.
- Never open C:\Users\Cyrus\staging-secrets.env, never print the environment, and prefix every command with env -u LLM_API_KEY.

Scope:
- This is Phase 0 research. Change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- The standard is docs/design/shortlet-ux-guidelines.md. The effort map is .scratch/ux-guidelines/map.md. Read both.
- Phases 1 to 4 (issues 06 to 28) shipped on 11 Nov 2026. Any hypothesis written on 10 Nov is out of date: check it on the current tree.
- Write your rows to .scratch/ux-guidelines/evidence/<NN>-rows.md, using the column header and value lists in
  .scratch/ux-guidelines/evidence-matrix.md. One row per observation. Keep what you saw (Observed) separate from what it
  means (Guideline rule, Priority). Give a provisional P0 to P3 from guideline §14; 05 confirms it.
- Save captures under .scratch/ux-guidelines/screenshots/<NN>/.
- Run only one capture sweep or browser suite at a time on this machine. If another agent's sweep is running, wait.
- Delete any walkthrough log you create.

Finish:
- Fill the issue's ## Comments with what you ran (exact commands), what you could not reach and why, and a short summary.
- Do not commit and do not change the issue Status. The orchestrator reviews and commits.
- Do not hand back early. Stay in the foreground until every acceptance criterion is met or you have recorded why it
  cannot be. Your final message lists each acceptance criterion with done / not done and the file that proves it.
```

---

## Prompt 01: guest screen re-baseline

```text
<common preamble, NN = 01>

Issue: .scratch/ux-guidelines/issues/01-guest-screen-rebaseline.md. Read it in full.

Steps:
1. Run .scratch/guest-ui-consistency/capture-11-all.sh. Run each screen group in its own process; two fixtures in one
   process break the shell load. Light and dark, at 320, 390, 768 and 1280. Copy the outputs and findings-*.txt into
   .scratch/ux-guidelines/screenshots/01/.
2. For each guest surface in guideline §5 (Landing through Expired/declined, plus the Extended Stay schedule), compare the
   capture with its screen contract: visible hierarchy, one primary action, essential recovery. Compare it with the
   renders in .scratch/guest-ui-consistency/design/ as well.
3. For each surface that exists in both chat and a standard route, record whether both show the same facts and command
   (ADR 0080).
4. If the walkthrough cannot reach a surface, write a row saying so, with the reason.
```

## Prompt 02: audit reclassification

```text
<common preamble, NN = 02>

Issue: .scratch/ux-guidelines/issues/02-audit-reclassification.md. Read it in full.

Steps:
1. List design-audit findings A1 to A18 (docs/design/shortlet-ui-ux-audit.md, the table near lines 77 to 94) and
   browser-audit findings 01 to 17 (docs/design/guest-browser-audit-2026-11-03.md, recorded as B01 to B17).
2. For each one, reproduce it on the current tree with the walkthrough
   (node .scratch/guest-ui-consistency/start-walkthrough.mjs, ports 3021+). Use issue 01's captures in
   .scratch/ux-guidelines/screenshots/01/ where they exist. Mark it fixed, current, partial or unverified, with an evidence
   path. Use code only when a screen cannot be reached, and then mark the row "unverified (code only)".
3. The hypotheses in the issue date from 10 Nov, before issues 06 to 28 shipped. For example, A6 (Operator ISO dates) and
   A7 ("disclosed") were addressed by issues 26 and 06. Confirm each on the current tree; never copy a hypothesis as a result.
4. Every finding still current or partial cites the guideline rule it breaks.
5. A17 is a tooling note: record it as "not a product finding".
```

## Prompt 03: Operator re-baseline

```text
<common preamble, NN = 03>

Issue: .scratch/ux-guidelines/issues/03-operator-rebaseline.md. Read it in full.
Start only after issue 01's capture sweep has finished.

Steps:
1. Reach the inbox and request detail with the helpers behind test/back-office-request-inbox.test.ts and
   test/back-office-confirm-decline.test.ts. Code: apps/local-owner/src/local-owner-server.ts. Line numbers in the issue
   are from 10 Nov and may have moved; search for the functions instead.
2. Capture both screens at 320, 390, 768 and 1280.
3. Record rows for the guideline §5 Operator contract: inbox scan order, readable Unit and Guest context, response deadline
   in WAT, decision effect, and duplicate-decision prevention. Issue 26 added a client guard that disables the decision
   button while it submits, while the server still refuses a duplicate. Check both.
4. Record whether the legacy renderOwnerDashboardHtml is still reachable, and from which route or caller (search the
   whole repo, including apps/cloudflare).
```

## Prompt 04: staging live journey and accessibility audit

This one needs the built-in browser, so run it in a Claude desktop session (the orchestrator session can run it directly).

```text
<common preamble, NN = 04; skip the worktree setup, since this issue only uses the browser>

Issue: .scratch/ux-guidelines/issues/04-staging-live-journey-audit.md. Read it in full, and AGENTS.md "Live verification
in the browser" and "Staging deployment".

Target: the staging workers.dev origin, which runs main c6a7961 (deployed 11 Nov 2026). The owner gives you the origin.

Timing: start between 8:00 AM and about 6:30 PM WAT. A Booking Request can be submitted only from 8:00 AM to 7:30 PM WAT,
and the 20-minute Payment Window runs from Accept Offer.

Journey (chat workspace at /, in this order): search, View apartment, Review request, phone (+234 801 234 5678, saved
before Submit), Submit, the Operator confirms (the back office needs Cloudflare Access; if you cannot reach it, ask the
owner to confirm the request), Accept Offer, Continue to stay payment (asks for an email first; use a
synthetic address the owner gives you), hosted checkout.

Owner handoff: at the Paystack hosted checkout, stop. Enter no card data. Tell the owner the payment page is open and wait
until they say they have paid. Then check the confirmation screen, and ask the owner to confirm in the Paystack dashboard
that charge.success was delivered with a 200.

On the same journey, record:
- the accessible name of every primary action (read_page), and where focus lands after each workspace change
- a keyboard-only pass, and 200% zoom at 390 width
- what the guest sees while a turn is slow (the "still working" copy and the Cancel control)
- new since 11 Nov, so check it: the skip link, sentence-case Operator labels, the "in your stay details" copy, and that
  the comparison sits side by side on desktop

On any defect, record the exact /api/event or /api/turn response body, the failing step, and the expected behaviour.
Synthetic data only. The only allowed cf call is a read-only log query, and only when the owner asks.
```
