# 34 · Offer terms in plain language, behind a disclosure

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 2 (follow-up from Phase 0; owner approved 12 Nov 2026)
Applicable ADRs: 0059 (guest conduct rules), 0085 (identity verification timing), 0080 (parity), 0078; guideline §5 Offer, §9 plain language, §10 trust hierarchy

## What to build

Matrix rows 45 and 46.

- On the Offer (chat and standard route) and the confirmed booking page, present house rules and guest conduct as a list behind a disclosure (native `<details>`, which the kit already uses for "Full contract terms"), below the stay facts and the decision. Every term stays available; nothing is removed.
- Today the house rules are one semicolon-joined line, and about 60 lines of terms sit between the facts and the action. Split them into list items.
- Plain language: give each rule a short guest-facing line where the policy summary reads as legal text (for example "absent genuine legal requirement"). The meaning must not change. The identity lines stay, because they are policy-backed: ADR 0059 (`domains/shortlet/src/guest-conduct.ts:80`) and ADR 0085 (`apps/web-agent/src/guest-content.ts:366`). If a rewrite could change the meaning, keep the policy text and record the question for the owner. Never invent policy.

## Acceptance criteria

1. On the Offer, the decision and its action come before the full terms, and the terms sit behind a disclosure in both chat and the standard route
2. House rules and conduct render as list items, not one joined line
3. Every rule from the policy source is still present (a test compares the rendered rules with `guest-conduct.ts`)
4. Rewritten lines keep the policy meaning; any line not rewritten is recorded in Comments with the reason

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- UI change: end with captures at 320, 390, 768 and 1280 and the overflow and 44px checks, saved under `screenshots/34/`.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.

## Comments
