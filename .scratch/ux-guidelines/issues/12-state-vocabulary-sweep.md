# 12 · Remaining state vocabulary findings

Status: needs-triage
Type: task
Blocked by: 05
Phase: 1 (Batch A)
Applicable ADRs: guideline §9, §10 booking state hierarchy

## What to build

Fix the label and state-wording findings that issue 05 assigns here, for example draft, sent, offer, payment required, processing and confirmed being told apart on every channel. Issue 05 confirms the scope and writes the exact list into Comments before this becomes ready-for-agent.

## Acceptance criteria

1. Every matrix row assigned to 12 is fixed or re-assigned, with its evidence
2. Chat and standard routes show the same state label for each booking state

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
